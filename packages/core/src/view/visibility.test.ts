import { describe, expect, it } from 'vitest';
import type { Action } from '../actions/schema';
import type { GameState, PlayerId } from '../model/types';
import { exposureFor, maskIdOf } from '../model/visibility';
import { applyAction } from '../rules/pipeline';
import { SandboxRules } from '../rules/sandbox';
import { Rng } from '../rng/rng';
import { A, B, CARD_IDS, S, allStrings, fixture, front } from '../test/fixture';
import { ok } from '../test/run';
import { eventsFor, getViewFor, type DeckView, type HiddenView } from './view';

/** Strings that must never reach `viewer`: ids and fronts of what it cannot fully see. */
function forbidden(state: GameState, viewer: PlayerId, alsoVisibleIn?: GameState): Set<string> {
  const out = new Set<string>([state.secret.maskKey]);
  for (const c of Object.values(state.components)) {
    if (exposureFor(state, c, viewer) === 'full') continue;
    const other = alsoVisibleIn?.components[c.id];
    if (other && exposureFor(alsoVisibleIn!, other, viewer) === 'full') continue;
    out.add(c.id);
    if (c.type === 'card' || c.type === 'tile') out.add(c.front);
  }
  return out;
}

function expectNoLeak(payload: unknown, banned: Set<string>): void {
  const strings = allStrings(payload);
  const leaked = [...banned].filter((x) => strings.has(x));
  expect(leaked).toEqual([]);
}

describe('getViewFor', () => {
  it("never exposes the cards in another player's hand", () => {
    let s = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 3 }, A).state;
    s = ok(s, { type: 'deck.peek', deckId: 'deck', count: 1 }, A).state;
    const viewB = getViewFor(s, B);
    for (const id of ['k1', 'k2', 'k3']) {
      expectNoLeak(viewB, new Set([id, front(id)]));
    }
    expect(viewB.handCounts[A]).toBe(3);
    expect(viewB.hand).toEqual([]);
    const viewA = getViewFor(s, A);
    expect(viewA.hand).toEqual(['k1', 'k2', 'k3']);
    expect(allStrings(viewA).has(front('k2'))).toBe(true);
  });

  it('shows decks as counts, with only the own peeked cards', () => {
    const s = ok(fixture(), { type: 'deck.peek', deckId: 'deck', count: 2 }, A).state;
    const deckA = getViewFor(s, A).components.find((c) => c.id === 'deck') as DeckView;
    expect(deckA.count).toBe(6);
    expect(deckA.topBack).toBe('back-red');
    expect(deckA.top).toBeNull();
    expect(deckA.peeked.map((c) => c.id)).toEqual(['k1', 'k2']);
    expect('contents' in deckA).toBe(false);
    const viewB = getViewFor(s, B);
    expectNoLeak(viewB, forbidden(s, B));
    for (const id of CARD_IDS) expect(allStrings(viewB).has(id)).toBe(false);
  });

  it('shows the top card of a face-up deck to everyone', () => {
    let s = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 2 }, A).state;
    s = ok(
      s,
      { type: 'container.insert', ids: ['k2', 'k1'], containerId: 'discard', position: 'top' },
      A,
    ).state;
    const discard = getViewFor(s, B).components.find((c) => c.id === 'discard') as DeckView;
    expect(discard.top?.id).toBe('k2');
    expectNoLeak(getViewFor(s, B), new Set(['k1', front('k1')]));
  });

  it('replaces face-down cards with an opaque placeholder', () => {
    const s = fixture();
    const loose = getViewFor(s, B).components.find((c) => 'hidden' in c) as HiddenView;
    expect(loose).toMatchObject({ hidden: true, back: 'back-blue', type: 'card' });
    expect(loose.id).toBe(maskIdOf(s, s.components.loose!));
    expect(Object.keys(loose)).not.toContain('front');
    expectNoLeak(getViewFor(s, B), forbidden(s, B));
  });

  it('a card played face down stays visible to its owner only', () => {
    let s = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 1 }, A).state;
    s = ok(s, { type: 'hand.play', id: 'k1', x: 10, y: 10, faceUp: false }, A).state;
    expect(allStrings(getViewFor(s, A)).has(front('k1'))).toBe(true);
    expectNoLeak(getViewFor(s, B), new Set(['k1', front('k1')]));
    expectNoLeak(getViewFor(s, S), new Set(['k1', front('k1')]));
  });

  it('hides face-up cards inside a private hand zone', () => {
    const s = ok(
      fixture(),
      { type: 'component.move', targets: [{ id: 'open', x: 1100, y: 1100 }] },
      A,
    ).state;
    expect(allStrings(getViewFor(s, A)).has(front('open'))).toBe(true);
    expectNoLeak(getViewFor(s, B), new Set(['open', front('open')]));
  });

  it('changes the opaque id when a card is hidden again, so it cannot be tracked', () => {
    let s = fixture();
    const before = maskIdOf(s, s.components.loose!);
    s = ok(
      s,
      { type: 'container.insert', ids: [before], containerId: 'deck', position: 'top' },
      A,
    ).state;
    s = ok(
      s,
      { type: 'deck.takeTop', deckId: 'deck', to: { kind: 'table', x: 0, y: 0, faceUp: false } },
      A,
    ).state;
    expect(maskIdOf(s, s.components.loose!)).not.toBe(before);
    // Flipping a public card face down also gives it a fresh opaque id.
    const s2 = ok(fixture(), { type: 'component.flip', ids: ['open'] }, A).state;
    const s3 = ok(
      s2,
      { type: 'component.flip', ids: [maskIdOf(s2, s2.components.open!)] },
      A,
    ).state;
    const s4 = ok(s3, { type: 'component.flip', ids: ['open'] }, A).state;
    expect(maskIdOf(s2, s2.components.open!)).not.toBe(maskIdOf(s4, s4.components.open!));
  });

  it('never includes secrets', () => {
    const s = fixture();
    for (const p of [A, B, S]) {
      const v = getViewFor(s, p);
      expect(allStrings(v).has(s.secret.maskKey)).toBe(false);
      expect('secret' in v).toBe(false);
      expect(allStrings(v).has('hideEpoch')).toBe(false);
    }
  });

  it('only shows a player their own prompts', () => {
    const s = ok(
      fixture(),
      {
        type: 'prompt.create',
        prompt: {
          id: 'p',
          playerId: A,
          kind: 'chooseOption',
          message: { key: 'k', params: {} },
          options: [{ value: 'x', label: null, componentId: null }],
          min: 1,
          max: 1,
        },
      },
      '$system',
    ).state;
    expect(getViewFor(s, A).prompts).toHaveLength(1);
    expect(getViewFor(s, B).prompts).toHaveLength(0);
  });
});

describe('eventsFor', () => {
  it('rewrites ids per viewer', () => {
    const s0 = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 2 }, A).state;
    const r = ok(s0, { type: 'hand.play', id: 'k1', x: 0, y: 0, faceUp: false }, A);
    const forA = eventsFor(s0, r.state, r.events, A);
    const forB = eventsFor(s0, r.state, r.events, B);
    expect(forA[0]!.componentIds).toEqual(['k1']);
    expect(forB[0]!.componentIds).toEqual([maskIdOf(r.state, r.state.components.k1!)]);
    const r2 = ok(s0, { type: 'hand.pass', ids: ['k2'], toPlayerId: B }, A);
    expect(eventsFor(s0, r2.state, r2.events, S)[0]!.componentIds).toEqual([null]);
    expect(eventsFor(s0, r2.state, r2.events, B)[0]!.componentIds).toEqual(['k2']);
  });
});

/** Random play: what each player receives must never contain hidden ids or fronts. */
describe('hidden information fuzzing', () => {
  function randomAction(state: GameState, pid: PlayerId, rng: Rng): Action {
    const v = getViewFor(state, pid);
    const onTable = v.components.filter((c) => c.location.kind === 'table');
    const pick = <T>(xs: T[]): T | undefined => (xs.length ? xs[rng.int(xs.length)] : undefined);
    const any = pick(onTable)?.id ?? 'pawn';
    const flippables = onTable
      .filter((c) => c.type === 'card' || c.type === 'tile')
      .map((c) => c.id);
    const decks = onTable.filter((c) => c.type === 'deck').map((c) => c.id);
    const deck = pick(decks) ?? 'deck';
    const handCard = pick(v.hand);
    const peeked = (v.components.find((c) => c.id === deck) as DeckView | undefined)?.peeked ?? [];
    const x = rng.int(1400);
    const y = rng.int(1400);
    const options: Action[] = [
      { type: 'component.move', targets: [{ id: any, x, y }] },
      { type: 'component.flip', ids: [pick(flippables) ?? any] },
      { type: 'deck.shuffle', deckId: deck },
      { type: 'deck.draw', deckId: deck, count: 1 + rng.int(2) },
      { type: 'deck.deal', deckId: deck, count: 1, playerIds: null },
      { type: 'deck.peek', deckId: deck, count: 2 },
      { type: 'deck.takeTop', deckId: deck, to: { kind: 'table', x, y, faceUp: rng.int(2) === 0 } },
      { type: 'hand.take', ids: [pick(flippables) ?? any] },
      { type: 'die.roll', ids: ['d1', 'd2'] },
      { type: 'bag.draw', bagId: 'bag', to: { kind: 'table', x, y, faceUp: true } },
    ];
    if (handCard) {
      options.push(
        { type: 'hand.play', id: handCard, x, y, faceUp: rng.int(2) === 0 },
        { type: 'hand.pass', ids: [handCard], toPlayerId: pid === A ? B : A },
        { type: 'container.insert', ids: [handCard], containerId: deck, position: 'top' },
      );
    }
    const p = pick(peeked);
    if (p) options.push({ type: 'deck.take', deckId: deck, cardId: p.id, to: { kind: 'hand' } });
    if (flippables.length > 1) options.push({ type: 'deck.form', ids: flippables.slice(0, 2) });
    return pick(options)!;
  }

  it('random games never leak hidden ids or fronts', () => {
    const rng = Rng.fromSeed('fuzz');
    let applied = 0;
    for (let game = 0; game < 15; game++) {
      let state = fixture();
      for (let step = 0; step < 60; step++) {
        const actor = rng.int(2) === 0 ? A : B;
        const r = applyActionLoose(state, randomAction(state, actor, rng), actor, rng);
        if (!r) continue;
        applied++;
        for (const viewer of [A, B, S]) {
          expectNoLeak(getViewFor(r.state, viewer), forbidden(r.state, viewer));
          expectNoLeak(
            eventsFor(state, r.state, r.events, viewer),
            forbidden(r.state, viewer, state),
          );
        }
        state = r.state;
      }
    }
    expect(applied).toBeGreaterThan(300);
  });
});

function applyActionLoose(state: GameState, action: Action, pid: PlayerId, rng: Rng) {
  const r = applyAction(state, action, pid, { rules: SandboxRules, rng });
  return r.ok ? r : null;
}
