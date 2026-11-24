import {
  exposureFor,
  type JoinOptions,
  PROTOCOL_VERSION,
  type ServerMessages,
} from '@tabletop/core';
import { demoModule } from '@tabletop/module-format';
import { describe, expect, it } from 'vitest';
import { OnlineTable } from './table';

type Sent = { type: keyof ServerMessages; message: unknown };

function setup() {
  let n = 0;
  const sent = new Map<string, Sent[]>();
  const table = new OnlineTable({
    code: 'ABCDE',
    gameName: 'Test',
    module: demoModule,
    secret: () => `secret-${++n}`,
    outbox: {
      send: (clientId, type, message) => {
        const list = sent.get(clientId) ?? [];
        list.push({ type, message: JSON.parse(JSON.stringify(message)) });
        sent.set(clientId, list);
      },
    },
  });
  const of = (clientId: string, type: keyof ServerMessages) =>
    (sent.get(clientId) ?? []).filter((s) => s.type === type).map((s) => s.message);
  return { table, sent, of };
}

const join = (name: string, seatToken?: string): JoinOptions =>
  seatToken === undefined
    ? { protocol: PROTOCOL_VERSION, name }
    : { protocol: PROTOCOL_VERSION, name, seatToken };

function allStrings(value: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        out.add(k);
        walk(x);
      }
    }
  };
  walk(value);
  return out;
}

describe('OnlineTable', () => {
  it('gathers players in the lobby and lets only the owner start', () => {
    const { table, of } = setup();
    expect(table.join('c1', join('Anna'))).toMatchObject({ ok: true, playerId: 'p1' });
    expect(table.join('c2', join('Bruno'))).toMatchObject({ ok: true, playerId: 'p2' });
    expect(of('c1', 'table').at(-1)).toMatchObject({
      phase: 'lobby',
      seats: [
        { playerId: 'p1', name: 'Anna', owner: true, connected: true },
        { playerId: 'p2', name: 'Bruno', owner: false, connected: true },
      ],
    });
    expect(table.start('c2')).toEqual({ ok: false, code: 'not_owner' });
    expect(table.start('c1')).toEqual({ ok: true });
    expect(table.session?.state.players.map((p) => p.name)).toEqual(['Anna', 'Bruno']);
    expect(table.session?.undoPolicy).toBe('strict');
    expect(of('c2', 'update')).toHaveLength(1);
    expect(table.join('c3', join('Carla'))).toEqual({ ok: false, code: 'started' });
  });

  it('refuses a seventh player', () => {
    const { table } = setup();
    for (let i = 1; i <= 6; i++) expect(table.join(`c${i}`, join(`P${i}`)).ok).toBe(true);
    expect(table.join('c7', join('P7'))).toEqual({ ok: false, code: 'full' });
  });

  it('frees a lobby seat left on purpose, keeps it on a disconnection', () => {
    const { table } = setup();
    table.join('c1', join('Anna'));
    table.join('c2', join('Bruno'));
    table.join('c3', join('Carla'));
    table.leave('c2', true);
    table.leave('c3', false);
    expect(table.info().seats.map((s) => [s.name, s.connected])).toEqual([
      ['Anna', true],
      ['Carla', false],
    ]);
  });

  it('gives the seat back with its token and resends the current view', async () => {
    const { table, of } = setup();
    table.join('c1', join('Anna'));
    table.join('c2', join('Bruno'));
    table.start('c1');
    const token = (of('c2', 'welcome')[0] as { seatToken: string }).seatToken;
    table.leave('c2', false);
    await table.submit('c1', { seq: 1, action: { type: 'deck.draw', deckId: 'deck', count: 2 } });
    expect(table.join('c9', join('Bruno', 'wrong'))).toEqual({ ok: false, code: 'bad_seat' });
    expect(table.join('c9', join('Bruno', token))).toMatchObject({ ok: true, playerId: 'p2' });
    const view = of('c9', 'update').at(-1) as ServerMessages['update'];
    expect(view.view.viewer).toBe('p2');
    expect(view.view.handCounts).toMatchObject({ p1: 2 });
  });

  it('replaces the old connection when the same seat joins again', () => {
    const { table, of } = setup();
    table.join('c1', join('Anna'));
    const token = (of('c1', 'welcome')[0] as { seatToken: string }).seatToken;
    expect(table.join('c1b', join('Anna', token))).toMatchObject({ ok: true, replaced: 'c1' });
    expect(table.info().seats).toHaveLength(1);
  });

  it('answers each submit and refuses actions before the start', async () => {
    const { table, of } = setup();
    table.join('c1', join('Anna'));
    await table.submit('c1', { seq: 4, action: { type: 'table.ping', x: 0, y: 0 } });
    expect(of('c1', 'result')[0]).toMatchObject({ seq: 4, result: { ok: false } });
    table.start('c1');
    await table.submit('c1', { seq: 5, action: { type: 'table.ping', x: 0, y: 0 } });
    expect(of('c1', 'result')[1]).toEqual({ seq: 5, result: { ok: true } });
  });

  it('stops sending updates to a dropped client until it reconnects', async () => {
    const { table, of } = setup();
    table.join('c1', join('Anna'));
    table.join('c2', join('Bruno'));
    table.start('c1');
    table.drop('c2');
    expect(table.info().seats[1]!.connected).toBe(false);
    await table.submit('c1', { seq: 1, action: { type: 'table.ping', x: 0, y: 0 } });
    expect(of('c2', 'update')).toHaveLength(1);
    table.reconnect('c2');
    expect(of('c2', 'update')).toHaveLength(2);
    expect(table.info().seats[1]!.connected).toBe(true);
  });

  it('never sends a client the secrets of the game or of other seats', async () => {
    const { table, sent, of } = setup();
    table.join('c1', join('Anna'));
    table.join('c2', join('Bruno'));
    table.start('c1');
    const action = (type: string, extra: object) => ({ type, ...extra });
    await table.submit('c1', { seq: 1, action: action('deck.shuffle', { deckId: 'deck' }) });
    await table.submit('c1', { seq: 2, action: action('deck.draw', { deckId: 'deck', count: 3 }) });
    await table.submit('c2', { seq: 1, action: action('deck.draw', { deckId: 'deck', count: 2 }) });
    await table.submit('c1', { seq: 3, action: action('deck.peek', { deckId: 'deck', count: 2 }) });
    const handA = (of('c1', 'update').at(-1) as ServerMessages['update']).view.hand;
    await table.submit('c1', {
      seq: 4,
      action: action('hand.play', { id: handA[0], x: 0, y: 0, faceUp: false }),
    });
    await table.submit('c1', { seq: 5, action: action('die.roll', { ids: ['die-1'] }) });

    const session = table.session!;
    const state = session.state;
    const tokens = new Map(
      ['c1', 'c2'].map((c) => [c, (of(c, 'welcome')[0] as { seatToken: string }).seatToken]),
    );
    const players = { c1: 'p1', c2: 'p2' } as const;
    for (const [clientId, playerId] of Object.entries(players)) {
      const payload = allStrings(sent.get(clientId));
      const hidden = Object.values(state.components)
        .filter((c) => exposureFor(state, c, playerId) !== 'full')
        .flatMap((c) => (c.type === 'card' ? [c.id, c.front] : [c.id]));
      expect(hidden.filter((x) => payload.has(x))).toEqual([]);
      expect(payload.has(state.secret.maskKey)).toBe(false);
      for (const [other, token] of tokens) expect(payload.has(token)).toBe(other === clientId);
      // Every secret (tokens, mask key, RNG seed) comes from `secret()`:
      // the only one a client may see is its own seat token.
      const leaked = [...payload].filter((x) => x.startsWith('secret-'));
      expect(leaked).toEqual([tokens.get(clientId)]);
    }
  });
});
