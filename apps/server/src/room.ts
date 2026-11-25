import { randomBytes, randomInt } from 'node:crypto';
import { type Client, Room, ServerError } from '@colyseus/core';
import {
  CreateOptions,
  JoinOptions,
  MAX_ONLINE_PLAYERS,
  type OnlineErrorCode,
  PROTOCOL_VERSION,
  SubmitMessage,
} from '@tabletop/core';
import { BuiltinModuleLoader, type LoadedModule } from '@tabletop/module-format';
import type { z } from 'zod';
import { RateLimiter } from './rate';
import { MemoryTableStore, type StoredTable, type TableStore } from './store';
import { OnlineTable } from './table';

/** Unambiguous characters for table codes (no 0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
/** WebSocket close code for "left on purpose" (Colyseus CloseCode.CONSENTED). */
const CONSENTED = 4000;
/** How long a dropped connection keeps its place before it must rejoin with its token. */
const RECONNECT_SECONDS = 60;
/** Delay before writing a change to the store (several actions share one write). */
const PERSIST_DELAY_MS = 1000;

/** Codes of the tables open in this process. */
const openCodes = new Set<string>();
/** Codes the server itself asked to restore (clients cannot ask for a restore). */
const pendingRestores = new Set<string>();

const secret = (): string => randomBytes(16).toString('hex');

function reject(code: OnlineErrorCode): never {
  throw new ServerError(4400, code);
}

/** Validates untrusted options; an app of another version gets a clear error. */
function parse<T>(schema: z.ZodType<T>, options: unknown): T {
  const version = (options as { protocol?: unknown } | null)?.protocol;
  if (version !== PROTOCOL_VERSION) reject('protocol');
  const parsed = schema.safeParse(options);
  if (!parsed.success) reject('invalid_options');
  return parsed.data;
}

const loader = new BuiltinModuleLoader();

async function loadModule(id: string): Promise<LoadedModule> {
  try {
    return await loader.load(`builtin:${id}`);
  } catch {
    reject('unknown_module');
  }
}

/** Shared settings of every table room (set once by `createServer`). */
export const tableConfig = {
  store: new MemoryTableStore() as TableStore,
  now: (): number => Date.now(),
  /** A lobby nobody is in is closed after this long. */
  lobbyTtlMs: 30 * 60 * 1000,
  /** A game nobody touches is deleted after this long. */
  gameTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Messages per second a client may send (with a burst of twice as many). */
  messagesPerSecond: 15,
};

export function newCode(isTaken: (code: string) => boolean): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!isTaken(code)) return code;
  }
}

/** Remaining life of a stored table, or 0 when it has expired. */
export function remainingMs(t: StoredTable, now: number): number {
  const ttl = t.phase === 'playing' ? tableConfig.gameTtlMs : tableConfig.lobbyTtlMs;
  return Math.max(0, t.lastActive + ttl - now);
}

/** Marks a stored table to be restored by the next room created with `{ restore: code }`. */
export function allowRestore(code: string): void {
  pendingRestores.add(code);
}

/**
 * Colyseus adapter around `OnlineTable`. No Schema state: each client gets
 * its own filtered JSON view as messages. The room id is the table code.
 * Every change is written to the store, so a restart loses nothing.
 */
export class TableRoom extends Room {
  override maxClients = MAX_ONLINE_PLAYERS * 2;
  override autoDispose = false;
  private table!: OnlineTable;
  private lastActive = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private expired = false;
  private readonly limiter = new RateLimiter(tableConfig.messagesPerSecond, () =>
    tableConfig.now(),
  );

  override async onCreate(options: unknown): Promise<void> {
    const restore = (options as { restore?: unknown } | null)?.restore;
    const tableOptions = (code: string, gameName: string, module: LoadedModule) => ({
      code,
      gameName,
      module,
      secret,
      outbox: {
        send: (clientId: string, type: string, message: unknown) =>
          this.clients.getById(clientId)?.send(type, message),
      },
    });
    if (typeof restore === 'string' && pendingRestores.delete(restore)) {
      const stored = tableConfig.store.get(restore);
      if (!stored) throw new Error(`No stored table ${restore}`);
      const module = await loadModule(stored.moduleId);
      this.table = OnlineTable.restore(stored, tableOptions(stored.code, stored.gameName, module));
      this.lastActive = stored.lastActive;
    } else {
      const opts = parse(CreateOptions, options);
      const module = await loadModule(opts.moduleId);
      const code = newCode((c) => openCodes.has(c) || tableConfig.store.get(c) !== null);
      this.table = new OnlineTable(tableOptions(code, opts.gameName, module));
      this.lastActive = tableConfig.now();
    }
    this.roomId = this.table.code;
    openCodes.add(this.table.code);

    this.onMessage('submit', async (client, message) => {
      const parsed = SubmitMessage.safeParse(message);
      if (!parsed.success) return;
      if (!this.limiter.take(client.sessionId)) {
        client.send('result', {
          seq: parsed.data.seq,
          result: { ok: false, error: { code: 'rate_limited', message: 'Too many actions' } },
        });
        return;
      }
      await this.table.submit(client.sessionId, parsed.data);
      this.touch();
    });
    this.onMessage('ready', (client) => this.table.ready(client.sessionId));
    this.onMessage('start', (client) => {
      if (this.table.start(client.sessionId).ok) this.touch();
    });
    this.armIdle();
  }

  override onJoin(client: Client, options: unknown): void {
    const r = this.table.join(client.sessionId, parse(JoinOptions, options));
    if (!r.ok) reject(r.code);
    if (r.replaced !== null) this.clients.getById(r.replaced)?.leave(CONSENTED);
    this.disarmIdle();
    this.touch();
  }

  override async onDrop(client: Client): Promise<void> {
    this.table.drop(client.sessionId);
    this.armIdle();
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onReconnect(client: Client): void {
    this.table.reconnect(client.sessionId);
    this.disarmIdle();
  }

  override onLeave(client: Client, code?: number): void {
    this.table.leave(client.sessionId, code === CONSENTED);
    this.limiter.forget(client.sessionId);
    this.touch();
    this.armIdle();
  }

  override onDispose(): void {
    this.disarmIdle();
    openCodes.delete(this.roomId);
    if (this.expired) {
      if (this.persistTimer !== null) clearTimeout(this.persistTimer);
      tableConfig.store.delete(this.roomId);
    } else {
      // Shutting down: the table must be there after the restart.
      this.persist();
    }
  }

  /** Records activity and schedules a write to the store. */
  private touch(): void {
    this.lastActive = tableConfig.now();
    if (this.persistTimer === null)
      this.persistTimer = setTimeout(() => this.persist(), PERSIST_DELAY_MS);
  }

  private persist(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    tableConfig.store.put({ version: 1, ...this.table.snapshot(), lastActive: this.lastActive });
  }

  private armIdle(): void {
    if (!this.table.empty || this.idleTimer !== null) return;
    const ttl = this.table.started ? tableConfig.gameTtlMs : tableConfig.lobbyTtlMs;
    const left = Math.max(0, this.lastActive + ttl - tableConfig.now());
    this.idleTimer = setTimeout(() => {
      this.expired = true;
      void this.disconnect();
    }, left);
  }

  private disarmIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
