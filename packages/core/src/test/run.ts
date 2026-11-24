import type { Action } from '../actions/schema';
import type { GameState, PlayerId } from '../model/types';
import { applyAction, type ApplyResult } from '../rules/pipeline';
import { SandboxRules } from '../rules/sandbox';
import type { RulesProvider } from '../rules/types';
import { Rng } from '../rng/rng';
import { deepFreeze } from './fixture';

/** Applies an action that must succeed; the input state is frozen to detect mutations. */
export function ok(
  state: GameState,
  action: Action,
  pid: PlayerId,
  rules: RulesProvider = SandboxRules,
  rng: Rng = Rng.fromSeed('test'),
): Extract<ApplyResult, { ok: true }> {
  const r = applyAction(deepFreeze(state), action, pid, { rules, rng });
  if (!r.ok) throw new Error(`Expected success, got ${r.error.code}: ${r.error.message}`);
  return r;
}

/** Applies an action that must fail and returns the error code. */
export function err(
  state: GameState,
  action: Action,
  pid: PlayerId,
  rules: RulesProvider = SandboxRules,
): string {
  const r = applyAction(deepFreeze(state), action, pid, { rules, rng: Rng.fromSeed('test') });
  if (r.ok) throw new Error('Expected failure');
  return r.error.code;
}
