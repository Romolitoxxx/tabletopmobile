import { createEndpoint, createRouter, matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@tabletop/core';
import { allowRestore, remainingMs, TableRoom, tableConfig } from './room';
import type { TableStore } from './store';

/** Messages larger than this are refused (an action is a few hundred bytes). */
const MAX_PAYLOAD = 64 * 1024;

/**
 * WebSocket transport that opens its port only after `beforeOpen` (the
 * matchmaker is already running then). Used to reopen the stored tables
 * before the first client arrives: on Fly.io that client is the one that
 * woke the machine up, and must find its table.
 */
export class GatedTransport extends WebSocketTransport {
  beforeOpen: () => Promise<unknown> = async () => {};

  override listen(port: number, hostname?: string, backlog?: number, cb?: () => void): this {
    void this.beforeOpen()
      .catch((e: unknown) => console.error('Startup step failed:', e))
      .then(() => super.listen(port, hostname, backlog, cb));
    return this;
  }
}

export function createTransport(): GatedTransport {
  return new GatedTransport({ maxPayload: MAX_PAYLOAD });
}

export interface ServerOptions {
  transport?: GatedTransport;
  /** Where tables survive restarts (default: memory only). */
  store?: TableStore;
}

export function createServer(options: ServerOptions = {}): Server {
  if (options.store) tableConfig.store = options.store;
  const transport = options.transport ?? createTransport();
  transport.beforeOpen = restoreTables;
  const server = new Server({ transport, gracefullyShutdown: false, greet: false });
  // For the hosting platform's health checks.
  server.router = createRouter({
    health: createEndpoint('/health', { method: 'GET' }, async () => ({ ok: true })),
  });
  server.define(ROOM_NAME, TableRoom);
  return server;
}

/** Reopens the stored tables; expired ones are deleted. Returns how many were reopened. */
export async function restoreTables(): Promise<number> {
  const now = tableConfig.now();
  let restored = 0;
  for (const t of tableConfig.store.list()) {
    if (remainingMs(t, now) === 0) {
      tableConfig.store.delete(t.code);
      continue;
    }
    allowRestore(t.code);
    try {
      await matchMaker.createRoom(ROOM_NAME, { restore: t.code });
      restored++;
    } catch (e) {
      console.error(`Could not restore table ${t.code}:`, e);
    }
  }
  if (restored > 0) console.log(`${restored} table(s) restored`);
  return restored;
}
