import { describe, expect, it } from 'vitest';
import type { Action } from '../actions/schema';
import type { DieComponent } from '../model/types';
import { SYSTEM_PLAYER } from '../model/types';
import { maskIdOf } from '../model/visibility';
import { Rng } from '../rng/rng';
import { A, B, fixture } from '../test/fixture';
import { err, ok } from '../test/run';
import { applyAction, parseAction } from './pipeline';
import { SandboxRules } from './sandbox';
import type { RulesProvider } from './types';

describe('parseAction', () => {
  it('accepts valid actions and rejects malformed input', () => {
    expect(parseAction({ type: 'turn.end' }).ok).toBe(true);
    expect(parseAction({ type: 'nope' }).ok).toBe(false);
    expect(parseAction({ type: 'deck.draw', deckId: 'deck', count: -1 }).ok).toBe(false);
    expect(
      parseAction({ type: 'component.move', targets: [{ id: 'x', x: Infinity, y: 0 }] }).ok,
    ).toBe(false);
    expect(parseAction('turn.end').ok).toBe(false);
  });
});

describe('rules pipeline', () => {
  it('SandboxRules accepts every structurally valid action', () => {
    ok(fixture(), { type: 'die.roll', ids: ['d1'] }, A, SandboxRules);
  });

  it('lets the rules reject an action with a message', () => {
    const rules: RulesProvider = {
      ...SandboxRules,
      id: 'no-dice',
      validate: (_s, action) =>
        action.type === 'die.roll'
          ? { ok: false, error: { code: 'rejected_by_rules', message: 'No dice today' } }
          : { ok: true },
    };
    expect(err(fixture(), { type: 'die.roll', ids: ['d1'] }, A, rules)).toBe('rejected_by_rules');
    ok(fixture(), { type: 'turn.end' }, A, rules);
  });

  it('validates with real ids after resolving opaque ones', () => {
    const seen: Action[] = [];
    const rules: RulesProvider = {
      ...SandboxRules,
      validate: (_s, action) => {
        seen.push(action);
        return { ok: true };
      },
    };
    const s = fixture();
    ok(s, { type: 'hand.take', ids: [maskIdOf(s, s.components.loose!)] }, A, rules);
    expect(seen[0]).toEqual({ type: 'hand.take', ids: ['loose'] });
  });

  it('runs consequent actions as the system player and logs their cause', () => {
    // Automatic effect: after any die roll, end the turn.
    const rules: RulesProvider = {
      ...SandboxRules,
      onAction: (_s, r) => (r.action.type === 'die.roll' ? [{ type: 'turn.end' }] : []),
    };
    const r = ok(fixture(), { type: 'die.roll', ids: ['d1'] }, A, rules);
    expect(r.steps.map((x) => [x.playerId, x.resolved.action.type, x.causeIndex])).toEqual([
      [A, 'die.roll', null],
      [SYSTEM_PLAYER, 'turn.end', 0],
    ]);
    expect(r.state.turn.current).toBe(B);
    expect(r.events.map((e) => e.type)).toEqual(['rolled', 'turnEnded']);
  });

  it('stops infinite cascades', () => {
    const rules: RulesProvider = {
      ...SandboxRules,
      onAction: () => [{ type: 'table.ping', x: 0, y: 0 }],
    };
    expect(err(fixture(), { type: 'table.ping', x: 0, y: 0 }, A, rules)).toBe('cascade_limit');
  });

  it('is atomic: a failing consequence rolls back state and RNG', () => {
    const rules: RulesProvider = {
      ...SandboxRules,
      onAction: (_s, r) =>
        r.action.type === 'die.roll' ? [{ type: 'deck.draw', deckId: 'nope', count: 1 }] : [],
    };
    const rng = Rng.fromSeed('atomic');
    const before = rng.getState();
    const s = fixture();
    const r = applyAction(s, { type: 'die.roll', ids: ['d1'] }, A, { rules, rng });
    expect(r.ok).toBe(false);
    expect(rng.getState()).toEqual(before);
    expect((s.components.d1 as DieComponent).faceIndex).toBe(0);
  });

  it('the same seed gives the same outcomes', () => {
    const roll = () =>
      (
        ok(fixture(), { type: 'die.roll', ids: ['d2'] }, A, SandboxRules, Rng.fromSeed('same'))
          .state.components.d2 as DieComponent
      ).faceIndex;
    expect(roll()).toBe(roll());
  });
});
