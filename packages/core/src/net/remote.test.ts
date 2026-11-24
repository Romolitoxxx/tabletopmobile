import { describe, expect, it } from 'vitest';
import type { HostUpdate } from '../host/host';
import type { PlayerView } from '../view/view';
import type { ServerMessages } from './protocol';
import { type Channel, RemoteHost } from './remote';

function fakeChannel() {
  const handlers = new Map<string, Set<(m: never) => void>>();
  const sent: { seq: number; action: unknown }[] = [];
  const channel: Channel = {
    send: (_type, message) => sent.push(message),
    onMessage: (type, listener) => {
      const set = handlers.get(type) ?? new Set();
      set.add(listener as (m: never) => void);
      handlers.set(type, set);
      return () => set.delete(listener as (m: never) => void);
    },
  };
  const emit = <K extends keyof ServerMessages>(type: K, message: ServerMessages[K]) => {
    for (const h of handlers.get(type) ?? []) (h as (m: ServerMessages[K]) => void)(message);
  };
  return { channel, sent, emit, handlers };
}

const view = (n: number) => ({ viewer: 'p1', turn: { number: n } }) as unknown as PlayerView;

describe('RemoteHost', () => {
  it('matches each result to its submit', async () => {
    const { channel, sent, emit } = fakeChannel();
    const host = new RemoteHost(channel, 'p1');
    const a = host.submit('p1', { type: 'turn.end' });
    const b = host.submit('p1', { type: 'game.undo' });
    expect(sent.map((s) => s.seq)).toEqual([1, 2]);
    emit('result', { seq: 2, result: { ok: true } });
    emit('result', {
      seq: 1,
      result: { ok: false, error: { code: 'not_your_turn', message: 'x' } },
    });
    expect(await a).toMatchObject({ ok: false });
    expect(await b).toEqual({ ok: true });
  });

  it('waits for the first view and forwards updates', async () => {
    const { channel, emit } = fakeChannel();
    const host = new RemoteHost(channel, 'p1');
    const first = host.getView('p1');
    const got: HostUpdate[] = [];
    host.subscribe('p1', (u) => got.push(u));
    emit('update', { view: view(1), events: [] });
    expect((await first).turn.number).toBe(1);
    emit('update', { view: view(2), events: [] });
    expect((await host.getView('p1')).turn.number).toBe(2);
    expect(got).toHaveLength(2);
  });

  it('fails pending and new submits while offline', async () => {
    const { channel, sent } = fakeChannel();
    const host = new RemoteHost(channel, 'p1');
    const pending = host.submit('p1', { type: 'turn.end' });
    host.setConnected(false);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(await host.submit('p1', { type: 'turn.end' })).toMatchObject({ ok: false });
    expect(sent).toHaveLength(1);
    host.setConnected(true);
    void host.submit('p1', { type: 'turn.end' });
    expect(sent).toHaveLength(2);
  });

  it('only plays its own seat and stops listening when closed', async () => {
    const { channel, sent, handlers } = fakeChannel();
    const host = new RemoteHost(channel, 'p1');
    expect(await host.submit('p2', { type: 'turn.end' })).toMatchObject({ ok: false });
    expect(sent).toHaveLength(0);
    host.close();
    expect([...handlers.values()].every((s) => s.size === 0)).toBe(true);
  });
});
