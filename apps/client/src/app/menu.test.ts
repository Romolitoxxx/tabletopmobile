import { describe, expect, it } from 'vitest';
import { GameSession, getViewFor, SandboxRules } from '@tabletop/core';
import { createDemoState } from '@tabletop/module-format';
import { buildMenu, type MenuContext } from './menu';
import { formatEvent } from './format';
import { I18n } from '../i18n/i18n';

const players = [
  { id: 'p1', name: 'Marco', color: '#e33', seat: 0, role: 'player' as const },
  { id: 'p2', name: 'Anna', color: '#33e', seat: 1, role: 'player' as const },
];

function setup() {
  const session = GameSession.start({
    state: createDemoState(players, 'k'),
    rules: SandboxRules,
    seed: 's',
    undoPolicy: 'free',
  });
  const view = () => getViewFor(session.state, 'p1');
  const ctx = (selection: string[] = []): MenuContext => ({
    view: view(),
    selection: new Set(selection),
    at: { x: 0, y: 0 },
    drop: { x: 10, y: 10 },
  });
  const find = (id: string) => view().components.find((c) => c.id === id)!;
  return { session, view, ctx, find };
}

describe('context menu', () => {
  it('every action entry is accepted by the engine', () => {
    const { session, ctx, find } = setup();
    for (const id of ['deck', 'die-1', 'coins', 'score-1', 'token-red-1', 'board']) {
      for (const item of buildMenu(find(id), ctx())) {
        if (item.command.kind !== 'action') continue;
        const copy = GameSession.load(session.save(), SandboxRules);
        const r = copy.submit('p1', item.command.action);
        expect(r.ok, `${id} / ${item.key}: ${r.ok ? '' : r.error.code}`).toBe(true);
      }
    }
  });

  it('offers deck entries only when they make sense', () => {
    const { ctx, find } = setup();
    const keys = buildMenu(find('discard'), ctx()).map((i) => i.key);
    expect(keys).not.toContain('menu.draw');
    expect(buildMenu(find('deck'), ctx()).map((i) => i.key)).toContain('menu.shuffle');
  });

  it('applies to the whole selection', () => {
    const { ctx, find } = setup();
    const menu = buildMenu(find('die-1'), ctx(['die-1', 'die-2']));
    const roll = menu.find((i) => i.key === 'menu.rollSelected');
    expect(roll?.command).toEqual({
      kind: 'action',
      action: { type: 'die.roll', ids: ['die-1', 'die-2'] },
    });
  });

  it('formats events for the log', () => {
    const { session, view } = setup();
    const r = session.submit('p1', { type: 'deck.draw', deckId: 'deck', count: 2 });
    if (!r.ok) throw new Error();
    const i18n = new I18n('it');
    expect(formatEvent(r.events[0]!, view(), i18n)).toBe('Marco ha pescato 2 carte da Mazzo');
    const roll = session.submit('p1', { type: 'die.roll', ids: ['die-1', 'die-2'] });
    if (!roll.ok) throw new Error();
    expect(formatEvent(roll.events[0]!, view(), i18n)).toMatch(/^Lancio: \d, \d$/);
  });
});
