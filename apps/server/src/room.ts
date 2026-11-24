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
import { BuiltinModuleLoader } from '@tabletop/module-format';
import type { z } from 'zod';
import { OnlineTable } from './table';

/** Unambiguous characters for table codes (no 0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
/** WebSocket close code for "left on purpose" (Colyseus CloseCode.CONSENTED). */
const CONSENTED = 4000;
/** How long a dropped connection keeps its place before it must rejoin with its token. */
const RECONNECT_SECONDS = 60;

/** Codes of the tables open in this process. */
const openCodes = new Set<string>();

export function newCode(taken: ReadonlySet<string>): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
}

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

/**
 * Colyseus adapter around `OnlineTable`. No Schema state: each client gets
 * its own filtered JSON view as messages. The room id is the table code.
 */
export class TableRoom extends Room {
  /** Disposal after this long with nobody connected. */
  static idleMs = 30 * 60 * 1000;

  override maxClients = MAX_ONLINE_PLAYERS * 2;
  override autoDispose = false;
  private table!: OnlineTable;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  override async onCreate(options: unknown): Promise<void> {
    const opts = parse(CreateOptions, options);
    let module;
    try {
      module = await loader.load(`builtin:${opts.moduleId}`);
    } catch {
      reject('unknown_module');
    }
    const code = newCode(openCodes);
    openCodes.add(code);
    this.roomId = code;
    this.table = new OnlineTable({
      code,
      gameName: opts.gameName,
      module,
      secret,
      outbox: {
        send: (clientId, type, message) => this.clients.getById(clientId)?.send(type, message),
      },
    });
    this.onMessage('submit', (client, message) => {
      const parsed = SubmitMessage.safeParse(message);
      if (parsed.success) void this.table.submit(client.sessionId, parsed.data);
    });
    this.onMessage('start', (client) => {
      this.table.start(client.sessionId);
    });
    this.armIdle();
  }

  override onJoin(client: Client, options: unknown): void {
    const r = this.table.join(client.sessionId, parse(JoinOptions, options));
    if (!r.ok) reject(r.code);
    if (r.replaced !== null) this.clients.getById(r.replaced)?.leave(CONSENTED);
    this.disarmIdle();
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
    this.armIdle();
  }

  override onDispose(): void {
    this.disarmIdle();
    openCodes.delete(this.roomId);
  }

  private armIdle(): void {
    if (!this.table.empty || this.idleTimer !== null) return;
    this.idleTimer = setTimeout(() => void this.disconnect(), TableRoom.idleMs);
  }

  private disarmIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
