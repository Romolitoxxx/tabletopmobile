import type { AddressInfo } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import type { Server } from '@colyseus/core';
import {
  PROTOCOL_VERSION,
  RemoteHost,
  ROOM_NAME,
  type ServerMessages,
  type TableInfo,
  type Welcome,
} from '@tabletop/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, createTransport, restoreTables } from './server';
import { MemoryTableStore } from './store';
import { OnlineTable } from './table';
import { demoModule } from '@tabletop/module-format';

let server: Server;
let endpoint: string;
let httpBase: string;
const store = new MemoryTableStore();

beforeAll(async () => {
  const transport = createTransport();
  server = createServer({ transport, store });
  await server.listen(0, '127.0.0.1');
  const { port } = transport.server!.address() as AddressInfo;
  endpoint = `ws://127.0.0.1:${port}`;
  httpBase = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

/** Waits for the next message of a type (or returns the last one already seen). */
function next<K extends keyof ServerMessages>(room: Room, type: K): Promise<ServerMessages[K]> {
  return new Promise((resolve) => {
    const off = room.onMessage(type, (m: ServerMessages[K]) => {
      off();
      resolve(m);
    });
  });
}

function channel(room: Room) {
  return {
    send: (type: 'submit', message: { seq: number; action: unknown }) => room.send(type, message),
    onMessage: <K extends keyof ServerMessages>(type: K, l: (m: ServerMessages[K]) => void) =>
      room.onMessage(type, l),
  };
}

describe('online server', () => {
  it('runs a game between two clients with filtered views', async () => {
    const anna = new Client(endpoint);
    const owner = await anna.create(ROOM_NAME, {
      protocol: PROTOCOL_VERSION,
      moduleId: 'demo',
      gameName: 'Serata',
      name: 'Anna',
    });
    const ownerWelcome = next(owner, 'welcome');
    const ownerTable = next(owner, 'table');
    owner.send('ready');
    expect((await ownerWelcome).playerId).toBe('p1');
    const info: TableInfo = await ownerTable;
    expect(info.code).toBe(owner.roomId);
    expect(info.code).toMatch(/^[A-Z2-9]{5}$/);

    const bruno = new Client(endpoint);
    const guest = await bruno.joinById(info.code, { protocol: PROTOCOL_VERSION, name: 'Bruno' });
    const guestWelcomed = next(guest, 'welcome');
    guest.send('ready');
    const guestWelcome: Welcome = await guestWelcomed;
    expect(guestWelcome.playerId).toBe('p2');

    const ownerHost = new RemoteHost(channel(owner), 'p1');
    const guestHost = new RemoteHost(channel(guest), 'p2');
    owner.send('start');
    const [ownerView, guestView] = await Promise.all([
      ownerHost.getView('p1'),
      guestHost.getView('p2'),
    ]);
    expect(ownerView.players.map((p) => p.name)).toEqual(['Anna', 'Bruno']);
    expect(guestView.viewer).toBe('p2');

    const guestUpdate = next(guest, 'update');
    expect(await ownerHost.submit('p1', { type: 'deck.draw', deckId: 'deck', count: 3 })).toEqual({
      ok: true,
    });
    const seen = await guestUpdate;
    expect(seen.view.handCounts.p1).toBe(3);
    expect(seen.view.hand).toEqual([]);
    expect((await ownerHost.getView('p1')).hand).toHaveLength(3);

    expect(await guestHost.submit('p2', { type: 'bogus' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_action' },
    });

    // A third person cannot join a game in progress.
    await expect(
      new Client(endpoint).joinById(info.code, { protocol: PROTOCOL_VERSION, name: 'Carla' }),
    ).rejects.toThrow(/started/);

    // Bruno leaves and comes back with his seat token: same seat, current view.
    await guest.leave(true);
    const again = await new Client(endpoint).joinById(info.code, {
      protocol: PROTOCOL_VERSION,
      name: 'Bruno',
      seatToken: guestWelcome.seatToken,
    });
    const backed = next(again, 'update');
    again.send('ready');
    const back = await backed;
    expect(back.view.viewer).toBe('p2');
    expect(back.view.handCounts.p1).toBe(3);

    await again.leave(true);
    await owner.leave(true);
  });

  it('refuses unknown modules and bad options', async () => {
    const c = new Client(endpoint);
    await expect(
      c.create(ROOM_NAME, {
        protocol: PROTOCOL_VERSION,
        moduleId: 'nope',
        gameName: 'x',
        name: 'A',
      }),
    ).rejects.toThrow(/unknown_module/);
    await expect(c.create(ROOM_NAME, { protocol: 999 })).rejects.toThrow(/protocol/);
    await expect(
      c.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, moduleId: 'demo' }),
    ).rejects.toThrow(/invalid_options/);
  });

  it('answers the health check', async () => {
    const r = await fetch(`${httpBase}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('saves every table and reopens stored ones after a restart', async () => {
    // A game in progress, as a previous server process would have left it.
    let n = 0;
    const tokens: string[] = [];
    const old = new OnlineTable({
      code: 'QWERT',
      gameName: 'Ieri sera',
      module: demoModule,
      secret: () => `s${++n}`,
      outbox: {
        send: (_c, type, m) => {
          if (type === 'welcome') tokens.push((m as Welcome).seatToken);
        },
      },
    });
    old.join('a', { protocol: PROTOCOL_VERSION, name: 'Anna' });
    old.join('b', { protocol: PROTOCOL_VERSION, name: 'Bruno' });
    old.ready('a');
    old.ready('b');
    old.start('a');
    await old.submit('b', { seq: 1, action: { type: 'deck.draw', deckId: 'deck', count: 4 } });
    store.put({ version: 1, ...old.snapshot(), lastActive: Date.now() });
    // An expired lobby is deleted instead of reopened.
    store.put({ ...store.get('QWERT')!, code: 'OLDXX', phase: 'lobby', lastActive: 0 });

    expect(await restoreTables()).toBe(1);
    expect(store.get('OLDXX')).toBeNull();

    const bruno = await new Client(endpoint).joinById('QWERT', {
      protocol: PROTOCOL_VERSION,
      name: 'Bruno',
      seatToken: tokens[1],
    });
    const host = new RemoteHost(channel(bruno), 'p2');
    bruno.send('ready');
    const view = await host.getView('p2');
    expect(view.viewer).toBe('p2');
    expect(view.hand).toHaveLength(4);

    // New actions are written back to the store.
    expect(await host.submit('p2', { type: 'deck.draw', deckId: 'deck', count: 1 })).toEqual({
      ok: true,
    });
    await new Promise((r) => setTimeout(r, 1200));
    const saved = store.get('QWERT')!;
    expect(saved.save?.log.filter((e) => e.kind === 'action')).toHaveLength(2);
    await bruno.leave(true);
  });

  it('refuses a client that floods actions', async () => {
    const owner = await new Client(endpoint).create(ROOM_NAME, {
      protocol: PROTOCOL_VERSION,
      moduleId: 'demo',
      gameName: 'Flood',
      name: 'Anna',
    });
    const host = new RemoteHost(channel(owner), 'p1');
    owner.send('ready');
    owner.send('start');
    await host.getView('p1');
    const results = await Promise.all(
      Array.from({ length: 60 }, () => host.submit('p1', { type: 'table.ping', x: 0, y: 0 })),
    );
    const limited = results.filter((r) => !r.ok && r.error.code === 'rate_limited').length;
    expect(limited).toBeGreaterThan(0);
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(30);
    await owner.leave(true);
  });
});
