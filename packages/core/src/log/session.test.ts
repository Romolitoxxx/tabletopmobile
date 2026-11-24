import { describe, expect, it } from 'vitest';
import type { Action } from '../actions/schema';
import type { CounterComponent, DieComponent, GameState } from '../model/types';
import { SandboxRules } from '../rules/sandbox';
import type { RulesProvider } from '../rules/types';
import { A, B, fixture } from '../test/fixture';
import { GameSession, replay } from './session';

const start = (undoPolicy: 'free' | 'strict' = 'free', rules: RulesProvider = SandboxRules) =>
  GameSession.start({ state: fixture(), rules, seed: 'session-seed', undoPolicy });

const script: [string, Action][] = [
  [A, { type: 'deck.shuffle', deckId: 'deck' }],
  [A, { type: 'deck.deal', deckId: 'deck', count: 2, playerIds: null }],
  [A, { type: 'die.roll', ids: ['d1', 'd2'] }],
  [A, { type: 'counter.add', id: 'score', delta: 4 }],
  [A, { type: 'turn.end' }],
  [B, { type: 'bag.draw', bagId: 'supply', to: { kind: 'table', x: 5, y: 5, faceUp: true } }],
  [B, { type: 'component.move', targets: [{ id: 'pawn', x: 1, y: 1 }] }],
];

function play(session: GameSession): void {
  for (const [pid, action] of script) {
    const r = session.submit(pid, action);
    if (!r.ok) throw new Error(r.error.message);
  }
}

describe('GameSession', () => {
  it('rejects malformed input from the network', () => {
    const s = start();
    expect(s.submit(A, { type: 'deck.draw', deckId: 'deck', count: 'lots' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_action' },
    });
    expect(s.submit(A, null).ok).toBe(false);
    expect(s.entries).toHaveLength(0);
  });

  it('replaying the log reproduces exactly the final state', () => {
    const s = start();
    play(s);
    const saved = s.save();
    expect(replay(saved.initial, saved.log)).toEqual(s.state);
  });

  it('a saved game reloads identical and keeps the same future randomness', () => {
    const s = start();
    play(s);
    const json = JSON.stringify(s.save());
    const loaded = GameSession.load(JSON.parse(json), SandboxRules);
    expect(loaded.state).toEqual(s.state);
    expect(JSON.stringify(loaded.save())).toBe(json);
    s.submit(A, { type: 'die.roll', ids: ['d2'] });
    loaded.submit(A, { type: 'die.roll', ids: ['d2'] });
    expect((loaded.state.components.d2 as DieComponent).faceIndex).toBe(
      (s.state.components.d2 as DieComponent).faceIndex,
    );
  });

  it('the state stays plain JSON', () => {
    const s = start();
    play(s);
    expect(JSON.parse(JSON.stringify(s.state)) as GameState).toEqual(s.state);
  });

  it('refuses saves for other rules', () => {
    const saved = start().save();
    expect(() => GameSession.load(saved, { ...SandboxRules, id: 'other' })).toThrow();
  });

  it('undoes the last action (free policy), including its consequences', () => {
    const rules: RulesProvider = {
      ...SandboxRules,
      onAction: (_s, r) => (r.action.type === 'counter.add' ? [{ type: 'turn.end' }] : []),
    };
    const s = start('free', rules);
    s.submit(A, { type: 'die.roll', ids: ['d1'] });
    const afterRoll = s.state;
    s.submit(A, { type: 'counter.add', id: 'score', delta: 2 });
    expect(s.state.turn.current).toBe(B);
    const r = s.submit(B, { type: 'game.undo' });
    expect(r.ok).toBe(true);
    expect(s.state).toEqual(afterRoll);
    expect(replay(s.save().initial, s.save().log)).toEqual(s.state);
    s.submit(A, { type: 'game.undo' });
    expect(s.submit(A, { type: 'game.undo' })).toMatchObject({
      ok: false,
      error: { code: 'nothing_to_undo' },
    });
  });

  it('does not rewind the RNG on undo', () => {
    const s = start();
    const rolls: number[] = [];
    for (let i = 0; i < 8; i++) {
      s.submit(A, { type: 'die.roll', ids: ['d2'] });
      rolls.push((s.state.components.d2 as DieComponent).faceIndex);
      s.submit(A, { type: 'game.undo' });
    }
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });

  it('strict policy: only your own last action, if nobody acted after', () => {
    const s = start('strict');
    s.submit(A, { type: 'counter.add', id: 'score', delta: 1 });
    expect(s.submit(B, { type: 'game.undo' })).toMatchObject({
      ok: false,
      error: { code: 'undo_not_allowed' },
    });
    s.submit(B, { type: 'component.move', targets: [{ id: 'pawn', x: 1, y: 1 }] });
    expect(s.submit(A, { type: 'game.undo' }).ok).toBe(false);
    expect(s.submit(B, { type: 'game.undo' }).ok).toBe(true);
    expect(s.submit(A, { type: 'game.undo' }).ok).toBe(true);
    expect((s.state.components.score as CounterComponent).value).toBe(0);
  });

  it('strict policy: random or revealing actions cannot be undone', () => {
    const s = start('strict');
    s.submit(A, { type: 'die.roll', ids: ['d1'] });
    expect(s.submit(A, { type: 'game.undo' })).toMatchObject({
      ok: false,
      error: { code: 'undo_not_allowed' },
    });
    s.submit(A, { type: 'deck.draw', deckId: 'deck', count: 1 });
    expect(s.submit(A, { type: 'game.undo' }).ok).toBe(false);
  });
});
