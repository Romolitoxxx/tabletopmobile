import { describe, expect, it } from 'vitest';
import type { CounterComponent, DeckComponent, DieComponent, Flippable } from '../model/types';
import { SYSTEM_PLAYER } from '../model/types';
import { maskIdOf } from '../model/visibility';
import { A, B, S, fixture } from '../test/fixture';
import { err, ok } from '../test/run';

const deck = (s: ReturnType<typeof fixture>, id = 'deck') => s.components[id] as DeckComponent;
const card = (s: ReturnType<typeof fixture>, id: string) => s.components[id] as Flippable;

describe('component actions', () => {
  it('moves components and brings them to front', () => {
    const s = fixture();
    const r = ok(s, { type: 'component.move', targets: [{ id: 'pawn', x: 10, y: 20 }] }, A);
    const loc = r.state.components.pawn!.location;
    expect(loc).toMatchObject({ kind: 'table', x: 10, y: 20 });
    expect(loc.kind === 'table' && loc.z).toBe(s.nextZ);
    expect(r.events[0]).toMatchObject({ type: 'moved', actor: A, componentIds: ['pawn'] });
  });

  it('snaps to the grid when enabled, except boards', () => {
    const s = fixture();
    s.table = {
      ...s.table,
      grid: { kind: 'square', size: 50, originX: 0, originY: 0, snap: true, bounds: null },
    };
    const r = ok(
      s,
      {
        type: 'component.move',
        targets: [
          { id: 'pawn', x: 12, y: 40 },
          { id: 'board', x: 12, y: 40 },
        ],
      },
      A,
    );
    expect(r.state.components.pawn!.location).toMatchObject({ x: 25, y: 25 });
    expect(r.state.components.board!.location).toMatchObject({ x: 12, y: 40 });
  });

  it('snaps only inside the grid bounds', () => {
    const s = fixture();
    s.table = {
      ...s.table,
      grid: {
        kind: 'square',
        size: 50,
        originX: 0,
        originY: 0,
        snap: true,
        bounds: { x: 0, y: 0, w: 100, h: 100 },
      },
    };
    const r = ok(
      s,
      {
        type: 'component.move',
        targets: [
          { id: 'pawn', x: 12, y: 40 },
          { id: 'd1', x: 212, y: 40 },
        ],
      },
      A,
    );
    expect(r.state.components.pawn!.location).toMatchObject({ x: 25, y: 25 });
    expect(r.state.components.d1!.location).toMatchObject({ x: 212, y: 40 });
  });

  it('refuses to move locked components and components not on the table', () => {
    const s = ok(fixture(), { type: 'component.lock', ids: ['pawn'], locked: true }, A).state;
    expect(s.components.pawn!.locked).toBe(true);
    expect(err(s, { type: 'component.move', targets: [{ id: 'pawn', x: 0, y: 0 }] }, A)).toBe(
      'locked',
    );
    const s2 = ok(s, { type: 'component.lock', ids: ['pawn'], locked: false }, A).state;
    ok(s2, { type: 'component.move', targets: [{ id: 'pawn', x: 0, y: 0 }] }, A);
    expect(
      err(fixture(), { type: 'component.move', targets: [{ id: 'nope', x: 0, y: 0 }] }, A),
    ).toBe('unknown_component');
  });

  it('rotates with normalized angles', () => {
    const r = ok(fixture(), { type: 'component.rotate', ids: ['pawn'], rotation: -90 }, A);
    expect(r.state.components.pawn!.rotation).toBe(270);
  });

  it('flips cards and decks', () => {
    const s = fixture();
    const r = ok(s, { type: 'component.flip', ids: ['open', 'deck'] }, A);
    expect(card(r.state, 'open').faceUp).toBe(false);
    expect(deck(r.state).faceUp).toBe(true);
    expect(err(s, { type: 'component.flip', ids: ['pawn'] }, A)).toBe('wrong_type');
  });

  it('groups and ungroups', () => {
    const r = ok(fixture(), { type: 'group.create', ids: ['pawn', 'd1'] }, A);
    const g = r.state.components.pawn!.groupId;
    expect(g).not.toBeNull();
    expect(r.state.components.d1!.groupId).toBe(g);
    const r2 = ok(r.state, { type: 'group.dissolve', groupId: g! }, A);
    expect(r2.state.components.pawn!.groupId).toBeNull();
    expect(err(r2.state, { type: 'group.dissolve', groupId: g! }, A)).toBe('invalid_target');
  });
});

describe('deck actions', () => {
  it('shuffles into a permutation decided by the host', () => {
    const s = fixture();
    const r = ok(s, { type: 'deck.shuffle', deckId: 'deck' }, A);
    expect([...deck(r.state).contents].sort()).toEqual([...deck(s).contents].sort());
    expect(deck(r.state).contents).not.toEqual(deck(s).contents);
    expect(r.events[0]).toMatchObject({ type: 'shuffled', params: { deckId: 'deck' } });
  });

  it('draws into the hand', () => {
    const r = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 2 }, A);
    expect(r.state.hands[A]).toEqual(['k1', 'k2']);
    expect(deck(r.state).contents).toEqual(['k3', 'k4', 'k5', 'k6']);
    expect(card(r.state, 'k1')).toMatchObject({
      location: { kind: 'hand', playerId: A },
      owner: A,
      visibility: 'owner',
    });
    expect(r.events[0]).toMatchObject({ type: 'drew', componentIds: [], params: { count: 2 } });
  });

  it('draws what is left and fails on an empty deck', () => {
    const r = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 50 }, A);
    expect(r.state.hands[A]).toHaveLength(6);
    expect(err(r.state, { type: 'deck.draw', deckId: 'deck', count: 1 }, A)).toBe(
      'empty_container',
    );
  });

  it('deals round-robin to all players in turn order', () => {
    const r = ok(fixture(), { type: 'deck.deal', deckId: 'deck', count: 2, playerIds: null }, A);
    expect(r.state.hands[A]).toEqual(['k1', 'k3']);
    expect(r.state.hands[B]).toEqual(['k2', 'k4']);
    expect(r.state.hands[S]).toEqual([]);
    expect(
      err(fixture(), { type: 'deck.deal', deckId: 'deck', count: 1, playerIds: ['x'] }, A),
    ).toBe('unknown_player');
  });

  it('peeks, searches, and keeps what is known after removals', () => {
    let s = ok(fixture(), { type: 'deck.peek', deckId: 'deck', count: 3 }, A).state;
    expect(deck(s).peeks).toEqual({ [A]: 3 });
    s = ok(s, { type: 'deck.draw', deckId: 'deck', count: 1 }, B).state;
    expect(deck(s).peeks).toEqual({ [A]: 2 });
    s = ok(s, { type: 'deck.search', deckId: 'deck' }, B).state;
    expect(deck(s).peeks).toEqual({ [A]: 2, [B]: 5 });
    s = ok(s, { type: 'deck.endPeek', deckId: 'deck' }, B).state;
    expect(deck(s).peeks).toEqual({ [A]: 2 });
    s = ok(s, { type: 'deck.shuffle', deckId: 'deck' }, B).state;
    expect(deck(s).peeks).toEqual({});
  });

  it('takes a specific card only when the player can see it', () => {
    const s = fixture();
    expect(
      err(s, { type: 'deck.take', deckId: 'deck', cardId: 'k4', to: { kind: 'hand' } }, A),
    ).toBe('unknown_component');
    const searched = ok(s, { type: 'deck.search', deckId: 'deck' }, A).state;
    const r = ok(
      searched,
      { type: 'deck.take', deckId: 'deck', cardId: 'k4', to: { kind: 'hand' } },
      A,
    );
    expect(r.state.hands[A]).toEqual(['k4']);
    expect(deck(r.state).contents).toEqual(['k1', 'k2', 'k3', 'k5', 'k6']);
    expect(deck(r.state).peeks[A]).toBe(5);
    // Bob did not search.
    expect(
      err(searched, { type: 'deck.take', deckId: 'deck', cardId: 'k4', to: { kind: 'hand' } }, B),
    ).toBe('unknown_component');
  });

  it('takes the top card onto the table face up or down', () => {
    const r = ok(
      fixture(),
      { type: 'deck.takeTop', deckId: 'deck', to: { kind: 'table', x: 5, y: 6, faceUp: true } },
      A,
    );
    expect(card(r.state, 'k1')).toMatchObject({
      faceUp: true,
      location: { kind: 'table', x: 5, y: 6 },
    });
    const r2 = ok(
      fixture(),
      { type: 'deck.takeTop', deckId: 'deck', to: { kind: 'table', x: 5, y: 6, faceUp: false } },
      A,
    );
    expect(card(r2.state, 'k1').faceUp).toBe(false);
    expect(r2.events[0]!.componentIds).toEqual([]);
  });

  it('inserts on top or bottom (discard, put back)', () => {
    let s = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 2 }, A).state;
    s = ok(
      s,
      { type: 'container.insert', ids: ['k1'], containerId: 'discard', position: 'top' },
      A,
    ).state;
    s = ok(
      s,
      { type: 'container.insert', ids: ['open'], containerId: 'deck', position: 'bottom' },
      A,
    ).state;
    s = ok(
      s,
      { type: 'container.insert', ids: ['k2'], containerId: 'deck', position: 'top' },
      A,
    ).state;
    expect(deck(s, 'discard').contents).toEqual(['k1']);
    expect(deck(s).contents).toEqual(['k2', 'k3', 'k4', 'k5', 'k6', 'open']);
    expect(s.hands[A]).toEqual([]);
    expect(card(s, 'k2')).toMatchObject({ faceUp: false, owner: null, visibility: 'nobody' });
    expect(
      err(s, { type: 'container.insert', ids: ['pawn'], containerId: 'deck', position: 'top' }, A),
    ).toBe('wrong_type');
    expect(
      err(s, { type: 'container.insert', ids: ['deck'], containerId: 'bag', position: 'top' }, A),
    ).toBe('wrong_type');
  });

  it("cannot insert another player's hand card", () => {
    const s = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 1 }, A).state;
    expect(
      err(s, { type: 'container.insert', ids: ['k1'], containerId: 'deck', position: 'top' }, B),
    ).toBe('unknown_component');
  });

  it('forms a deck from table cards and decks', () => {
    let s = ok(
      fixture(),
      { type: 'deck.takeTop', deckId: 'deck', to: { kind: 'table', x: 0, y: 0, faceUp: true } },
      A,
    ).state;
    const r = ok(s, { type: 'deck.form', ids: ['open', 'k1', 'deck'] }, A);
    s = r.state;
    const formed = Object.values(s.components).find(
      (c) => c.type === 'deck' && c.id !== 'discard',
    ) as DeckComponent;
    expect(formed.contents).toEqual(['open', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
    expect(s.components.deck).toBeUndefined();
    expect(card(s, 'k3').location).toEqual({ kind: 'container', containerId: formed.id });
    expect(formed.location).toMatchObject({ x: 350, y: 300 });
  });
});

describe('dice, bags, counters', () => {
  it('rolls dice with host randomness', () => {
    const r = ok(fixture(), { type: 'die.roll', ids: ['d1', 'd2'] }, A);
    const d1 = r.state.components.d1 as DieComponent;
    const d2 = r.state.components.d2 as DieComponent;
    expect(r.events[0]!.params.values).toEqual([d1.faceIndex + 1, d2.faceIndex + 1]);
    expect(d2.faceIndex).toBeLessThan(20);
  });

  it('sets a die face manually', () => {
    const r = ok(fixture(), { type: 'die.set', id: 'd1', faceIndex: 5 }, A);
    expect((r.state.components.d1 as DieComponent).faceIndex).toBe(5);
    expect(err(fixture(), { type: 'die.set', id: 'd1', faceIndex: 6 }, A)).toBe('invalid_action');
  });

  it('draws from a bag until empty', () => {
    let s = fixture();
    for (let i = 0; i < 3; i++) {
      s = ok(
        s,
        { type: 'bag.draw', bagId: 'bag', to: { kind: 'table', x: i, y: 0, faceUp: true } },
        A,
      ).state;
    }
    for (const t of ['t1', 't2', 't3']) expect(s.components[t]!.location.kind).toBe('table');
    expect(
      err(
        s,
        { type: 'bag.draw', bagId: 'bag', to: { kind: 'table', x: 0, y: 0, faceUp: true } },
        A,
      ),
    ).toBe('empty_container');
  });

  it('clones from an infinite bag', () => {
    const s = fixture();
    const r1 = ok(
      s,
      { type: 'bag.draw', bagId: 'supply', to: { kind: 'table', x: 1, y: 1, faceUp: true } },
      A,
    );
    const r2 = ok(
      r1.state,
      { type: 'bag.draw', bagId: 'supply', to: { kind: 'table', x: 2, y: 2, faceUp: true } },
      A,
    );
    const golds = Object.values(r2.state.components).filter(
      (c) => c.type === 'token' && c.image === 'gold.png',
    );
    expect(golds).toHaveLength(3);
    expect(r2.state.components.gold!.location.kind).toBe('container');
    expect(err(s, { type: 'bag.draw', bagId: 'supply', to: { kind: 'hand' } }, A)).toBe(
      'wrong_type',
    );
  });

  it('changes counters within bounds', () => {
    const s = ok(fixture(), { type: 'counter.add', id: 'score', delta: 3 }, A).state;
    expect((s.components.score as CounterComponent).value).toBe(3);
    const s2 = ok(s, { type: 'counter.add', id: 'score', delta: -10 }, A).state;
    expect((s2.components.score as CounterComponent).value).toBe(0);
    const s3 = ok(s2, { type: 'counter.set', id: 'score', value: 99 }, A).state;
    expect((s3.components.score as CounterComponent).value).toBe(10);
  });
});

describe('hand actions', () => {
  it('takes table cards into the hand and plays them back', () => {
    let s = ok(fixture(), { type: 'hand.take', ids: ['open'] }, A).state;
    expect(s.hands[A]).toEqual(['open']);
    expect(card(s, 'open').faceUp).toBe(false);
    s = ok(s, { type: 'hand.play', id: 'open', x: 9, y: 9, faceUp: false }, A).state;
    expect(card(s, 'open')).toMatchObject({
      faceUp: false,
      owner: A,
      visibility: 'owner',
      location: { kind: 'table', x: 9, y: 9 },
    });
    expect(s.hands[A]).toEqual([]);
  });

  it('only plays from the own hand', () => {
    const s = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 1 }, A).state;
    expect(err(s, { type: 'hand.play', id: 'k1', x: 0, y: 0, faceUp: true }, B)).toBe(
      'unknown_component',
    );
  });

  it('passes cards to another player', () => {
    let s = ok(fixture(), { type: 'deck.draw', deckId: 'deck', count: 2 }, A).state;
    s = ok(s, { type: 'hand.pass', ids: ['k2'], toPlayerId: B }, A).state;
    expect(s.hands[A]).toEqual(['k1']);
    expect(s.hands[B]).toEqual(['k2']);
    expect(card(s, 'k2').owner).toBe(B);
  });

  it('takes a face-down card by its opaque id', () => {
    const s = fixture();
    const mask = maskIdOf(s, s.components.loose!);
    expect(err(s, { type: 'hand.take', ids: ['loose'] }, A)).toBe('unknown_component');
    const r = ok(s, { type: 'hand.take', ids: [mask] }, A);
    expect(r.state.hands[A]).toEqual(['loose']);
  });
});

describe('game actions', () => {
  it('ends turns in order, only for the current player', () => {
    const s = fixture();
    expect(s.turn).toMatchObject({ order: [A, B], current: A, number: 1 });
    expect(err(s, { type: 'turn.end' }, B)).toBe('not_your_turn');
    const s2 = ok(s, { type: 'turn.end' }, A).state;
    expect(s2.turn).toMatchObject({ current: B, number: 2 });
    expect(ok(s2, { type: 'turn.end' }, B).state.turn.current).toBe(A);
  });

  it('pings without changing the state', () => {
    const s = fixture();
    const r = ok(s, { type: 'table.ping', x: 1, y: 2 }, S);
    expect(r.state).toEqual(s);
    expect(r.events[0]).toMatchObject({ type: 'pinged', actor: S, params: { x: 1, y: 2 } });
  });

  it('spectators cannot act', () => {
    expect(err(fixture(), { type: 'die.roll', ids: ['d1'] }, S)).toBe('spectator');
    expect(err(fixture(), { type: 'die.roll', ids: ['d1'] }, 'ghost')).toBe('unknown_player');
  });

  it('reserves system actions to the rules engine', () => {
    const prompt = {
      id: 'p1',
      playerId: A,
      kind: 'chooseOption' as const,
      message: { key: 'test', params: {} },
      options: [
        { value: 'x', label: null, componentId: null },
        { value: 'y', label: null, componentId: null },
      ],
      min: 1,
      max: 1,
    };
    expect(err(fixture(), { type: 'prompt.create', prompt }, A)).toBe('system_only');
    const s = ok(fixture(), { type: 'prompt.create', prompt }, SYSTEM_PLAYER).state;
    expect(s.prompts).toHaveLength(1);
    expect(err(s, { type: 'prompt.answer', promptId: 'p1', choice: ['x'] }, B)).toBe(
      'unknown_prompt',
    );
    expect(err(s, { type: 'prompt.answer', promptId: 'p1', choice: ['z'] }, A)).toBe(
      'invalid_choice',
    );
    expect(err(s, { type: 'prompt.answer', promptId: 'p1', choice: ['x', 'y'] }, A)).toBe(
      'invalid_choice',
    );
    expect(
      ok(s, { type: 'prompt.answer', promptId: 'p1', choice: ['y'] }, A).state.prompts,
    ).toEqual([]);
    const t = ok(
      fixture(),
      { type: 'turn.set', order: [B, A], current: B, phase: 'draw' },
      SYSTEM_PLAYER,
    ).state;
    expect(t.turn).toMatchObject({ order: [B, A], current: B, phase: 'draw' });
  });
});
