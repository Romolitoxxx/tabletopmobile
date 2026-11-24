import { describe, expect, it } from 'vitest';
import { GameSession, getViewFor, SandboxRules, type Player } from '@tabletop/core';
import { BuiltinModuleLoader } from './builtin';
import { ModuleManifest } from './index';

const players: Player[] = [
  { id: 'p1', name: 'Uno', color: '#e33', seat: 0, role: 'player' },
  { id: 'p2', name: 'Due', color: '#33e', seat: 1, role: 'player' },
];

describe('demo module', async () => {
  const demo = await new BuiltinModuleLoader().load('builtin:demo');

  it('has a valid manifest', () => {
    expect(ModuleManifest.parse(demo.manifest)).toEqual(demo.manifest);
  });

  it('contains 52 cards, 2 dice, a board, tokens, a bag and counters', () => {
    const s = demo.createState(players, 'k');
    const all = Object.values(s.components);
    const count = (t: string) => all.filter((c) => c.type === t).length;
    expect(count('card')).toBe(52);
    expect(count('die')).toBe(2);
    expect(count('board')).toBe(1);
    expect(count('token')).toBeGreaterThanOrEqual(12);
    expect(count('bag')).toBe(1);
    expect(count('counter')).toBe(2);
    const deck = s.components.deck;
    expect(deck?.type === 'deck' && deck.contents.length).toBe(52);
  });

  it('starts a playable game whose deck is hidden', () => {
    const session = GameSession.start({
      state: demo.createState(players, 'k'),
      rules: SandboxRules,
      seed: 's',
      undoPolicy: 'free',
    });
    expect(session.submit('p1', { type: 'deck.shuffle', deckId: 'deck' }).ok).toBe(true);
    expect(session.submit('p1', { type: 'deck.draw', deckId: 'deck', count: 5 }).ok).toBe(true);
    const json = JSON.stringify(getViewFor(session.state, 'p2'));
    for (const id of session.state.hands.p1!) expect(json).not.toContain(id);
  });

  it('offers a performance test with 300 more components', async () => {
    const stress = await new BuiltinModuleLoader().load('builtin:stress');
    const base = Object.keys(demo.createState(players, 'k').components).length;
    expect(Object.keys(stress.createState(players, 'k').components).length).toBe(base + 300);
  });

  it('rejects unknown modules', async () => {
    await expect(new BuiltinModuleLoader().load('builtin:nope')).rejects.toThrow();
  });
});
