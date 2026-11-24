import type { GameError } from '../actions/errors';
import type { Action, ResolvedAction } from '../actions/schema';
import type { GameState, PlayerId, RulesLevel } from '../model/types';
import type { Rng } from '../rng/rng';
import type { JsonValue } from '../util/json';

export type RuleVerdict = { ok: true } | { ok: false; error: GameError };

export interface GameOverInfo {
  winners: PlayerId[];
}

/**
 * Hook through which a module's rules take part in every action.
 *
 * Pipeline: `validate → apply → onAction`. Consequent actions returned by
 * `onAction` run through the same pipeline as the system player.
 * Turns/phases live in `state.turn` (changed with the system action
 * `turn.set`); choices are asked with the system action `prompt.create` and
 * answered by players with `prompt.answer`.
 */
export interface RulesProvider {
  readonly id: string;
  readonly level: RulesLevel;
  /** Builds the initial state from the module state (e.g. shuffles and deals). */
  setup(state: GameState, rng: Rng): GameState;
  /** Called after core id resolution, before randomness and application. */
  validate(state: GameState, action: Action, playerId: PlayerId): RuleVerdict;
  /** Automatic effects of an applied action. */
  onAction(state: GameState, action: ResolvedAction, playerId: PlayerId): Action[];
  /** Available moves, or null when unrestricted (sandbox). Used by `full` rules and bots. */
  legalMoves(state: GameState, playerId: PlayerId): Action[] | null;
  /** The part of `state.rulesData` a player may see. */
  publicData(state: GameState, playerId: PlayerId): JsonValue;
  score(state: GameState): Record<PlayerId, number> | null;
  isGameOver(state: GameState): GameOverInfo | null;
}
