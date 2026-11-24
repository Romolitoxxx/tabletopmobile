import { applyResolved } from '../actions/apply';
import type { GameError } from '../actions/errors';
import type { GameEvent } from '../actions/events';
import type { ActionType, ResolvedAction } from '../actions/schema';
import type { GameState, PlayerId } from '../model/types';
import { applyAction, parseAction } from '../rules/pipeline';
import type { RulesProvider } from '../rules/types';
import { Rng, type RngState } from '../rng/rng';
import { jsonClone } from '../util/json';

/**
 * `free`: any last action can be undone (solo, pass-and-play).
 * `strict` (online): only your own last action, if nobody acted after it,
 * and never across an action that revealed information or used randomness.
 */
export type UndoPolicy = 'free' | 'strict';

export type LogEntry =
  | {
      seq: number;
      kind: 'action';
      playerId: PlayerId;
      resolved: ResolvedAction;
      /** Seq of the player action that triggered this automatic one, or null. */
      causeSeq: number | null;
      /** Seq of the undo entry that cancelled this action, or null. */
      undoneBy: number | null;
    }
  | { seq: number; kind: 'undo'; playerId: PlayerId; targetSeq: number };

/** Saved game: the initial state plus the action log (event sourcing). */
export interface SavedGame {
  format: 'tabletop-save';
  version: 1;
  rulesId: string;
  undoPolicy: UndoPolicy;
  initial: GameState;
  log: LogEntry[];
  rng: RngState;
}

export type SubmitResult =
  | { ok: true; events: GameEvent[]; before: GameState; after: GameState }
  | { ok: false; error: GameError };

/** Actions that reveal information or use randomness: never undoable under `strict`. */
const IRREVERSIBLE_TYPES: ReadonlySet<ActionType> = new Set([
  'deck.shuffle',
  'deck.draw',
  'deck.deal',
  'deck.peek',
  'deck.search',
  'deck.takeTop',
  'deck.take',
  'die.roll',
  'bag.draw',
  'component.flip',
  'hand.pass',
  'prompt.answer',
  'hand.take',
]);

function isIrreversible(r: ResolvedAction): boolean {
  return (
    IRREVERSIBLE_TYPES.has(r.action.type) || (r.action.type === 'hand.play' && r.action.faceUp)
  );
}

/** Rebuilds a state from the initial one by applying every action not undone. */
export function replay(initial: GameState, log: readonly LogEntry[]): GameState {
  let state = initial;
  for (const e of log) {
    if (e.kind !== 'action' || e.undoneBy !== null) continue;
    state = applyResolved(state, e.resolved, e.playerId).state;
  }
  return state;
}

export interface StartOptions {
  /** State built from the module, before rules setup. */
  state: GameState;
  rules: RulesProvider;
  /** Secret seed; must come from a secure random source. */
  seed: string;
  undoPolicy: UndoPolicy;
}

/** Authoritative game: state, log, RNG and undo. Used by every host. */
export class GameSession {
  private constructor(
    readonly rules: RulesProvider,
    readonly undoPolicy: UndoPolicy,
    private readonly initial: GameState,
    private log: LogEntry[],
    private current: GameState,
    private readonly rng: Rng,
  ) {}

  static start(opts: StartOptions): GameSession {
    const rng = Rng.fromSeed(opts.seed);
    const initial = opts.rules.setup(opts.state, rng);
    return new GameSession(opts.rules, opts.undoPolicy, initial, [], initial, rng);
  }

  static load(saved: SavedGame, rules: RulesProvider): GameSession {
    if (saved.format !== 'tabletop-save' || saved.version !== 1) {
      throw new Error('Unsupported save format');
    }
    if (saved.rulesId !== rules.id) throw new Error(`Save needs rules ${saved.rulesId}`);
    const initial = jsonClone(saved.initial);
    const log = jsonClone(saved.log);
    return new GameSession(
      rules,
      saved.undoPolicy,
      initial,
      log,
      replay(initial, log),
      new Rng(saved.rng),
    );
  }

  get state(): GameState {
    return this.current;
  }

  get entries(): readonly LogEntry[] {
    return this.log;
  }

  private nextSeq(): number {
    return this.log.length === 0 ? 1 : this.log[this.log.length - 1]!.seq + 1;
  }

  /** Validates and applies an untrusted action from a player. */
  submit(playerId: PlayerId, input: unknown): SubmitResult {
    const parsed = parseAction(input);
    if (!parsed.ok) return parsed;
    if (parsed.action.type === 'game.undo') return this.undo(playerId);
    const before = this.current;
    const r = applyAction(before, parsed.action, playerId, { rules: this.rules, rng: this.rng });
    if (!r.ok) return r;
    const base = this.nextSeq();
    r.steps.forEach((step, i) => {
      this.log.push({
        seq: base + i,
        kind: 'action',
        playerId: step.playerId,
        resolved: step.resolved,
        causeSeq: step.causeIndex === null ? null : base,
        undoneBy: null,
      });
    });
    this.current = r.state;
    return { ok: true, events: r.events, before, after: r.state };
  }

  private undo(playerId: PlayerId): SubmitResult {
    const roots = this.log.filter(
      (e): e is Extract<LogEntry, { kind: 'action' }> =>
        e.kind === 'action' && e.undoneBy === null && e.causeSeq === null,
    );
    const target = roots[roots.length - 1];
    if (!target)
      return { ok: false, error: { code: 'nothing_to_undo', message: 'Nothing to undo' } };
    if (this.undoPolicy === 'strict') {
      const chain = this.log.filter(
        (e) => e.kind === 'action' && (e.seq === target.seq || e.causeSeq === target.seq),
      );
      const irreversible = chain.some((e) => e.kind === 'action' && isIrreversible(e.resolved));
      if (target.playerId !== playerId || irreversible) {
        return {
          ok: false,
          error: { code: 'undo_not_allowed', message: 'This action cannot be undone' },
        };
      }
    }
    const seq = this.nextSeq();
    this.log = this.log.map((e) =>
      e.kind === 'action' &&
      e.undoneBy === null &&
      (e.seq === target.seq || e.causeSeq === target.seq)
        ? { ...e, undoneBy: seq }
        : e,
    );
    this.log.push({ seq, kind: 'undo', playerId, targetSeq: target.seq });
    const before = this.current;
    // The RNG is not rewound: undoing a roll and rolling again gives a new result.
    this.current = replay(this.initial, this.log);
    const events: GameEvent[] = [
      { type: 'undone', actor: playerId, componentIds: [], params: { targetSeq: target.seq } },
    ];
    return { ok: true, events, before, after: this.current };
  }

  save(): SavedGame {
    return jsonClone({
      format: 'tabletop-save',
      version: 1,
      rulesId: this.rules.id,
      undoPolicy: this.undoPolicy,
      initial: this.initial,
      log: this.log,
      rng: this.rng.getState(),
    });
  }
}
