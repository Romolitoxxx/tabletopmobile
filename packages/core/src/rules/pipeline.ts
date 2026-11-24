import { applyResolved } from '../actions/apply';
import { ActionError, fail, type GameError } from '../actions/errors';
import type { GameEvent } from '../actions/events';
import {
  type Action,
  ActionSchema,
  type Outcome,
  type ResolvedAction,
  SYSTEM_ONLY_ACTIONS,
} from '../actions/schema';
import type { GameState, PlayerId } from '../model/types';
import { SYSTEM_PLAYER } from '../model/types';
import { resolveRef } from '../model/visibility';
import type { Rng } from '../rng/rng';
import type { RulesProvider } from './types';

/** Maximum number of consequent actions triggered by a single action. */
export const MAX_CASCADE = 200;

export interface ActionContext {
  rules: RulesProvider;
  rng: Rng;
}

/** One applied action, ready to be appended to the log. */
export interface AppliedStep {
  playerId: PlayerId;
  resolved: ResolvedAction;
  /** Index (within the same `applyAction` call) of the step that caused this one. */
  causeIndex: number | null;
}

export type ApplyResult =
  | { ok: true; state: GameState; steps: AppliedStep[]; events: GameEvent[] }
  | { ok: false; error: GameError };

/** Parses untrusted input (network message, script output) into an action. */
export function parseAction(
  input: unknown,
): { ok: true; action: Action } | { ok: false; error: GameError } {
  const r = ActionSchema.safeParse(input);
  if (r.success) return { ok: true, action: r.data };
  return {
    ok: false,
    error: { code: 'invalid_action', message: r.error.issues[0]?.message ?? 'Invalid action' },
  };
}

function checkActor(state: GameState, action: Action, playerId: PlayerId): void {
  if (playerId === SYSTEM_PLAYER) return;
  if (SYSTEM_ONLY_ACTIONS.has(action.type))
    fail('system_only', `${action.type} is reserved to the rules engine`);
  const player = state.players.find((p) => p.id === playerId);
  if (!player) fail('unknown_player', `Unknown player ${playerId}`, { id: playerId });
  if (player.role === 'spectator' && action.type !== 'table.ping')
    fail('spectator', 'Spectators cannot act');
}

/** Rewrites every component reference from the viewer's ids to real ids. */
function resolveRefs(state: GameState, action: Action, playerId: PlayerId): Action {
  if (playerId === SYSTEM_PLAYER) return action;
  const r = (ref: string): string => {
    const id = resolveRef(state, ref, playerId);
    if (id === null) fail('unknown_component', `Unknown component ${ref}`, { id: ref });
    return id;
  };
  switch (action.type) {
    case 'component.move':
      return { ...action, targets: action.targets.map((t) => ({ ...t, id: r(t.id) })) };
    case 'component.rotate':
    case 'component.flip':
    case 'component.lock':
    case 'group.create':
    case 'deck.form':
    case 'die.roll':
    case 'hand.take':
    case 'hand.pass':
      return { ...action, ids: action.ids.map(r) };
    case 'container.insert':
      return { ...action, ids: action.ids.map(r), containerId: r(action.containerId) };
    case 'deck.shuffle':
    case 'deck.draw':
    case 'deck.deal':
    case 'deck.peek':
    case 'deck.search':
    case 'deck.endPeek':
    case 'deck.takeTop':
      return { ...action, deckId: r(action.deckId) };
    case 'deck.take':
      return { ...action, deckId: r(action.deckId), cardId: r(action.cardId) };
    case 'bag.draw':
      return { ...action, bagId: r(action.bagId) };
    case 'die.set':
    case 'counter.add':
    case 'counter.set':
    case 'hand.play':
      return { ...action, id: r(action.id) };
    case 'group.dissolve':
    case 'turn.end':
    case 'table.ping':
    case 'game.undo':
    case 'prompt.answer':
    case 'turn.set':
    case 'prompt.create':
    case 'rules.setData':
      return action;
  }
}

/** The host decides randomness here; the outcome is stored in the log. */
function resolveOutcome(state: GameState, action: Action, rng: Rng): Outcome | null {
  switch (action.type) {
    case 'deck.shuffle': {
      const deck = state.components[action.deckId];
      if (deck?.type !== 'deck') fail('wrong_type', `${action.deckId} is not a deck`);
      return { kind: 'shuffle', order: rng.shuffle(deck.contents) };
    }
    case 'die.roll':
      return {
        kind: 'roll',
        faceIndexes: action.ids.map((id) => {
          const die = state.components[id];
          if (die?.type !== 'die') fail('wrong_type', `${id} is not a die`, { id });
          return rng.int(die.faces.length);
        }),
      };
    case 'bag.draw': {
      const bag = state.components[action.bagId];
      if (bag?.type !== 'bag') fail('wrong_type', `${action.bagId} is not a bag`);
      if (bag.contents.length === 0) fail('empty_container', `${action.bagId} is empty`);
      return { kind: 'bagDraw', index: rng.int(bag.contents.length) };
    }
    default:
      return null;
  }
}

/**
 * The single entry point that changes a game: validates an action for a
 * player, lets the rules intervene, resolves randomness and applies it,
 * then runs the consequent actions. Atomic: on any error nothing changes
 * (the RNG is rolled back too).
 */
export function applyAction(
  state: GameState,
  action: Action,
  playerId: PlayerId,
  ctx: ActionContext,
): ApplyResult {
  const rngBefore = ctx.rng.getState();
  try {
    const steps: AppliedStep[] = [];
    const events: GameEvent[] = [];
    const queue: { action: Action; playerId: PlayerId; causeIndex: number | null }[] = [
      { action, playerId, causeIndex: null },
    ];
    let current = state;
    while (queue.length > 0) {
      if (steps.length > MAX_CASCADE) fail('cascade_limit', 'Too many consequent actions');
      const next = queue.shift()!;
      checkActor(current, next.action, next.playerId);
      const resolvedAction = resolveRefs(current, next.action, next.playerId);
      const verdict = ctx.rules.validate(current, resolvedAction, next.playerId);
      if (!verdict.ok) {
        throw new ActionError(verdict.error.code, verdict.error.message, verdict.error.params);
      }
      const resolved: ResolvedAction = {
        action: resolvedAction,
        outcome: resolveOutcome(current, resolvedAction, ctx.rng),
      };
      const applied = applyResolved(current, resolved, next.playerId);
      current = applied.state;
      events.push(...applied.events);
      const index = steps.length;
      steps.push({ playerId: next.playerId, resolved, causeIndex: next.causeIndex });
      for (const consequent of ctx.rules.onAction(current, resolved, next.playerId)) {
        queue.push({ action: consequent, playerId: SYSTEM_PLAYER, causeIndex: index });
      }
    }
    return { ok: true, state: current, steps, events };
  } catch (e) {
    ctx.rng.setState(rngBefore);
    if (e instanceof ActionError) return { ok: false, error: e.toGameError() };
    throw e;
  }
}
