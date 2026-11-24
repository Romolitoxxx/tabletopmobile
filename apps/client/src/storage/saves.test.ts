import 'fake-indexeddb/auto';
import { getViewFor } from '@tabletop/core';
import { demoModule } from '@tabletop/module-format';
import { describe, expect, it } from 'vitest';
import { createGame, handoffTarget, restoreGame, updateRecord } from '../app/game';
import {
  exportRecord,
  IndexedDbSaveStore,
  MemorySaveStore,
  parseExport,
  type SaveStore,
} from './saves';

let counter = 0;
const secret = () => `secret-${++counter}`;

function playedGame() {
  const { record, session } = createGame({
    module: demoModule,
    mode: 'hotseat',
    playerNames: ['Marco', 'Anna', 'Luca'],
    name: 'Test',
    secret,
    now: 1000,
  });
  session.submit('p1', { type: 'deck.shuffle', deckId: 'deck' });
  session.submit('p1', { type: 'deck.deal', deckId: 'deck', count: 5, playerIds: null });
  session.submit('p1', { type: 'die.roll', ids: ['die-1', 'die-2'] });
  session.submit('p1', { type: 'turn.end' });
  return { record: updateRecord(record, session, 'p2', 2000), session };
}

for (const [name, make] of [
  ['MemorySaveStore', () => new MemorySaveStore()],
  ['IndexedDbSaveStore', () => new IndexedDbSaveStore()],
] as [string, () => SaveStore][]) {
  describe(name, () => {
    it('stores, lists and deletes games', async () => {
      const store = make();
      const { record } = playedGame();
      const other = { ...playedGame().record, updatedAt: 5000, name: 'Newer' };
      await store.put(record);
      await store.put(other);
      const list = await store.list();
      expect(list.map((s) => s.name).slice(0, 2)).toEqual(['Newer', 'Test']);
      expect(list.find((s) => s.id === record.id)?.players).toEqual(['Marco', 'Anna', 'Luca']);
      await store.delete(other.id);
      expect(await store.get(other.id)).toBeNull();
    });

    it('a saved game reloads identical', async () => {
      const store = make();
      const { record, session } = playedGame();
      await store.put(record);
      const loaded = await store.get(record.id);
      expect(loaded).toEqual(record);
      const restored = restoreGame(loaded!);
      expect(restored.state).toEqual(session.state);
      // Same future randomness too.
      session.submit('p2', { type: 'die.roll', ids: ['die-1'] });
      restored.submit('p2', { type: 'die.roll', ids: ['die-1'] });
      expect(restored.state).toEqual(session.state);
    });
  });
}

describe('export / import', () => {
  it('round-trips through a file', () => {
    const { record } = playedGame();
    expect(parseExport(exportRecord(record))).toEqual(record);
  });

  it('rejects files that are not games', () => {
    expect(parseExport('not json')).toBeNull();
    expect(parseExport('{"format":"other"}')).toBeNull();
  });
});

describe('hotseat', () => {
  it('creates the players in seat order with strict undo', () => {
    const { record, session } = playedGame();
    expect(session.state.players.map((p) => p.name)).toEqual(['Marco', 'Anna', 'Luca']);
    expect(record.save.undoPolicy).toBe('strict');
    expect(session.state.turn.current).toBe('p2');
  });

  it('hands the device to the player whose turn it is', () => {
    const { session } = playedGame();
    const view = getViewFor(session.state, 'p1');
    expect(handoffTarget('hotseat', view, 'p1')).toBe('p2');
    expect(handoffTarget('hotseat', view, 'p2')).toBeNull();
    expect(handoffTarget('solo', view, 'p1')).toBeNull();
  });

  it("each player's view hides the others' hands", () => {
    const { session } = playedGame();
    const json = JSON.stringify(getViewFor(session.state, 'p2'));
    for (const id of session.state.hands.p1!) expect(json).not.toContain(id);
    expect(getViewFor(session.state, 'p2').hand).toHaveLength(5);
  });
});
