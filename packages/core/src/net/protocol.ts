import { z } from 'zod';
import type { HostSubmitResult, HostUpdate } from '../host/host';

// Messages exchanged between the client and the online server. Pure data:
// the transport (Colyseus) lives in the apps. Everything a client sends is
// untrusted and validated with these schemas.

export const PROTOCOL_VERSION = 2;
export const MAX_ONLINE_PLAYERS = 6;
export const ROOM_NAME = 'table';

const playerName = z.string().trim().min(1).max(24);

/** Options to create a table (the creator also joins it). */
export const CreateOptions = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  moduleId: z.string().min(1).max(64),
  gameName: z.string().trim().min(1).max(60),
  name: playerName,
});
export type CreateOptions = z.infer<typeof CreateOptions>;

/** Options to join a table: a new seat, or back to one's seat with its token. */
export const JoinOptions = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  name: playerName,
  seatToken: z.string().min(1).max(128).optional(),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

/**
 * Client → server messages:
 * - `ready` (no payload): sent once the client listens; only then does the
 *   server send `welcome`, `table` and the current view;
 * - `start` (no payload): the owner deals the game;
 * - `submit`: an action, answered by `result` with the same `seq`.
 */
export const SubmitMessage = z.object({ seq: z.int().min(0), action: z.unknown() });
export type SubmitMessage = z.infer<typeof SubmitMessage>;

export interface Seat {
  playerId: string;
  name: string;
  color: string;
  connected: boolean;
  owner: boolean;
}

/** Public information about the table, sent to everyone on every change. */
export interface TableInfo {
  code: string;
  gameName: string;
  moduleId: string;
  phase: 'lobby' | 'playing';
  seats: Seat[];
}

/** Sent once to a client after it joined: its seat and the secret to get it back. */
export interface Welcome {
  playerId: string;
  /** Secret that gives the seat back after a disconnection. Never shared. */
  seatToken: string;
}

export interface SubmitReply {
  seq: number;
  result: HostSubmitResult;
}

/** Server → client message types and payloads. */
export interface ServerMessages {
  welcome: Welcome;
  table: TableInfo;
  update: HostUpdate;
  result: SubmitReply;
}

/** Close/error codes the client translates. */
export type OnlineErrorCode =
  'protocol' | 'invalid_options' | 'unknown_module' | 'full' | 'started' | 'bad_seat' | 'not_owner';
