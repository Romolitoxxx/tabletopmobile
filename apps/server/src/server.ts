import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@tabletop/core';
import { TableRoom } from './room';

/** Messages larger than this are refused (an action is a few hundred bytes). */
const MAX_PAYLOAD = 64 * 1024;

export function createTransport(): WebSocketTransport {
  return new WebSocketTransport({ maxPayload: MAX_PAYLOAD });
}

export function createServer(transport = createTransport()): Server {
  const server = new Server({
    transport,
    gracefullyShutdown: false,
  });
  server.define(ROOM_NAME, TableRoom);
  return server;
}
