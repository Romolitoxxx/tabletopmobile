import {
  GameSession,
  PLAYER_COLORS,
  type Player,
  type PlayerView,
  type RulesProvider,
  SandboxRules,
  type SavedGame,
  type UndoPolicy,
} from '@tabletop/core';
import type { LoadedModule } from '@tabletop/module-format';

/** solo: one player. hotseat: several players taking turns on the same device. */
export type GameMode = 'solo' | 'hotseat';
/** How the table is played: a local game, or one seat of an online game. */
export type PlayMode = GameMode | 'online';

export const MAX_HOTSEAT_PLAYERS = PLAYER_COLORS.length;

/** A game as stored on the device. */
export interface GameRecord {
  format: 'tabletop-local-game';
  version: 1;
  id: string;
  name: string;
  moduleId: string;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  /** Player currently holding the device (hotseat). */
  activePlayerId: string;
  save: SavedGame;
}

export interface NewGameOptions {
  module: LoadedModule;
  mode: GameMode;
  playerNames: string[];
  name: string;
  /** Secure random source (injected so that tests are deterministic). */
  secret: () => string;
  now: number;
}

/** Undo is free when playing alone; with other people at the table it is strict. */
export function undoPolicyFor(mode: GameMode): UndoPolicy {
  return mode === 'solo' ? 'free' : 'strict';
}

export function rulesFor(_moduleId: string): RulesProvider {
  return SandboxRules;
}

export function createGame(opts: NewGameOptions): { record: GameRecord; session: GameSession } {
  const count =
    opts.mode === 'solo' ? 1 : Math.min(MAX_HOTSEAT_PLAYERS, Math.max(2, opts.playerNames.length));
  const players: Player[] = Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: opts.playerNames[i]?.trim() || `P${i + 1}`,
    color: PLAYER_COLORS[i]!,
    seat: i,
    role: 'player',
  }));
  const session = GameSession.start({
    state: opts.module.createState(players, opts.secret()),
    rules: rulesFor(opts.module.manifest.id),
    seed: opts.secret(),
    undoPolicy: undoPolicyFor(opts.mode),
  });
  const record: GameRecord = {
    format: 'tabletop-local-game',
    version: 1,
    id: opts.secret(),
    name: opts.name,
    moduleId: opts.module.manifest.id,
    mode: opts.mode,
    createdAt: opts.now,
    updatedAt: opts.now,
    activePlayerId: players[0]!.id,
    save: session.save(),
  };
  return { record, session };
}

export function restoreGame(record: GameRecord): GameSession {
  return GameSession.load(record.save, rulesFor(record.moduleId));
}

/** Snapshot of a running game into its record. */
export function updateRecord(
  record: GameRecord,
  session: GameSession,
  activePlayerId: string,
  now: number,
): GameRecord {
  return { ...record, save: session.save(), activePlayerId, updatedAt: now };
}

/**
 * In hotseat mode, the player who should get the device after an update:
 * the player whose turn it is, when it is not the one holding the device.
 */
export function handoffTarget(mode: PlayMode, view: PlayerView, holder: string): string | null {
  if (mode !== 'hotseat') return null;
  const current = view.turn.current;
  if (!current || current === holder) return null;
  return view.players.some((p) => p.id === current && p.role !== 'spectator') ? current : null;
}
