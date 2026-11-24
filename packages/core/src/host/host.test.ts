import { describe, expect, it } from 'vitest';
import { GameSession } from '../log/session';
import { exposureFor } from '../model/visibility';
import { SandboxRules } from '../rules/sandbox';
import { A, B, S, allStrings, fixture } from '../test/fixture';
import { type HostUpdate, LocalHost } from './host';

describe('LocalHost', () => {
  it('sends each player only their filtered view and events', async () => {
    const host = new LocalHost(
      GameSession.start({ state: fixture(), rules: SandboxRules, seed: 'h', undoPolicy: 'free' }),
    );
    const received: Record<string, HostUpdate[]> = { [A]: [], [B]: [], [S]: [] };
    for (const p of [A, B, S]) host.subscribe(p, (u) => received[p]!.push(u));

    expect(await host.submit(A, { type: 'deck.shuffle', deckId: 'deck' })).toEqual({ ok: true });
    await host.submit(A, { type: 'deck.draw', deckId: 'deck', count: 2 });
    await host.submit(A, {
      type: 'hand.play',
      id: (await host.getView(A)).hand[0],
      x: 0,
      y: 0,
      faceUp: false,
    });
    expect((await host.submit(B, { type: 'nope' })).ok).toBe(false);

    const state = host.session.state;
    const secretFor = (p: string) =>
      Object.values(state.components)
        .filter((c) => exposureFor(state, c, p) !== 'full')
        .flatMap((c) => (c.type === 'card' ? [c.id, c.front] : [c.id]));

    for (const p of [B, S]) {
      // Inspect the exact payloads that would cross the network.
      const payload = allStrings(JSON.parse(JSON.stringify(received[p])));
      expect(secretFor(p).filter((x) => payload.has(x))).toEqual([]);
      expect(payload.has(state.secret.maskKey)).toBe(false);
    }
    expect(received[A]).toHaveLength(3);
    expect(received[A]![2]!.view.hand).toHaveLength(1);
  });

  it('stops notifying after unsubscribe', async () => {
    const host = new LocalHost(
      GameSession.start({ state: fixture(), rules: SandboxRules, seed: 'h', undoPolicy: 'free' }),
    );
    let calls = 0;
    const off = host.subscribe(A, () => calls++);
    await host.submit(A, { type: 'table.ping', x: 0, y: 0 });
    off();
    await host.submit(A, { type: 'table.ping', x: 0, y: 0 });
    expect(calls).toBe(1);
  });
});
