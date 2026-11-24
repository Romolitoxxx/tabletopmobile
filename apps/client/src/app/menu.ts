import type { Action, ComponentView, DeckView, PlayerView } from '@tabletop/core';
import type { MessageKey } from '../i18n/i18n';

/** What a menu entry does when chosen. */
export type MenuCommand =
  | { kind: 'action'; action: Action }
  | {
      kind: 'number';
      initial: number;
      min: number;
      max: number;
      make: (value: number) => Action;
    }
  | { kind: 'zoom'; id: string }
  | { kind: 'select'; ids: string[] }
  | { kind: 'deselect'; ids: string[] }
  | { kind: 'clearSelection' }
  | { kind: 'showPeek'; deckId: string };

export interface MenuItem {
  key: MessageKey;
  command: MenuCommand;
}

export interface MenuContext {
  view: PlayerView;
  selection: ReadonlySet<string>;
  /** World point where the menu was opened. */
  at: { x: number; y: number };
  /** Free spot to put things on the table (next to the target). */
  drop: { x: number; y: number };
}

const act = (key: MessageKey, action: Action): MenuItem => ({
  key,
  command: { kind: 'action', action },
});

function byId(view: PlayerView, ids: Iterable<string>): ComponentView[] {
  const set = new Set(ids);
  return view.components.filter((c) => set.has(c.id) && c.location.kind === 'table');
}

/** Builds the context menu for a long press on a component (or on the empty table). */
export function buildMenu(target: ComponentView | null, ctx: MenuContext): MenuItem[] {
  const { view, selection, at, drop } = ctx;
  const items: MenuItem[] = [];

  if (!target) {
    items.push(act('menu.ping', { type: 'table.ping', x: at.x, y: at.y }));
    if (selection.size > 0)
      items.push({ key: 'menu.clearSelection', command: { kind: 'clearSelection' } });
    return items;
  }

  // When the target is part of the selection, generic actions apply to all selected items.
  const inSelection = selection.has(target.id) && selection.size > 1;
  const targets = inSelection ? byId(view, selection) : [target];
  const ids = targets.map((c) => c.id);
  const unlocked = targets.filter((c) => !c.locked).map((c) => c.id);

  switch (target.type) {
    case 'deck': {
      const deck = target as DeckView;
      if (deck.count > 0) {
        items.push(act('menu.draw', { type: 'deck.draw', deckId: deck.id, count: 1 }));
        items.push({
          key: 'menu.drawN',
          command: {
            kind: 'number',
            initial: 2,
            min: 1,
            max: deck.count,
            make: (n) => ({ type: 'deck.draw', deckId: deck.id, count: n }),
          },
        });
        items.push(act('menu.shuffle', { type: 'deck.shuffle', deckId: deck.id }));
        items.push(
          act('menu.deal', { type: 'deck.deal', deckId: deck.id, count: 1, playerIds: null }),
        );
        items.push({
          key: 'menu.dealN',
          command: {
            kind: 'number',
            initial: 5,
            min: 1,
            max: deck.count,
            make: (n) => ({ type: 'deck.deal', deckId: deck.id, count: n, playerIds: null }),
          },
        });
        const to = (faceUp: boolean) => ({ kind: 'table' as const, x: drop.x, y: drop.y, faceUp });
        items.push(act('menu.takeTopUp', { type: 'deck.takeTop', deckId: deck.id, to: to(true) }));
        items.push(
          act('menu.takeTopDown', { type: 'deck.takeTop', deckId: deck.id, to: to(false) }),
        );
        items.push(act('menu.peek', { type: 'deck.peek', deckId: deck.id, count: 3 }));
        items.push(act('menu.search', { type: 'deck.search', deckId: deck.id }));
      }
      if (deck.peeked.length > 0) {
        items.push({ key: 'menu.showPeek', command: { kind: 'showPeek', deckId: deck.id } });
        items.push(act('menu.endPeek', { type: 'deck.endPeek', deckId: deck.id }));
      }
      if (!deck.locked)
        items.push(act('menu.flipDeck', { type: 'component.flip', ids: [deck.id] }));
      break;
    }
    case 'card':
    case 'tile': {
      const flippable = targets.filter(
        (c) => (c.type === 'card' || c.type === 'tile') && !c.locked,
      );
      if (flippable.length > 0) {
        const fids = flippable.map((c) => c.id);
        items.push(act('menu.flip', { type: 'component.flip', ids: fids }));
        items.push(act('menu.takeToHand', { type: 'hand.take', ids: fids }));
        if (fids.length > 1) items.push(act('menu.formDeck', { type: 'deck.form', ids: fids }));
      }
      if (!('hidden' in target))
        items.push({ key: 'menu.zoom', command: { kind: 'zoom', id: target.id } });
      break;
    }
    case 'die': {
      const dice = targets.filter((c) => c.type === 'die').map((c) => c.id);
      items.push(
        act(dice.length > 1 ? 'menu.rollSelected' : 'menu.roll', { type: 'die.roll', ids: dice }),
      );
      if (target.type === 'die' && 'faces' in target) {
        const faces = target.faces.length;
        items.push({
          key: 'menu.setFace',
          command: {
            kind: 'number',
            initial: target.faceIndex + 1,
            min: 1,
            max: faces,
            make: (n) => ({ type: 'die.set', id: target.id, faceIndex: n - 1 }),
          },
        });
      }
      break;
    }
    case 'bag':
      items.push(
        act('menu.bagDraw', {
          type: 'bag.draw',
          bagId: target.id,
          to: { kind: 'table', x: drop.x, y: drop.y, faceUp: true },
        }),
      );
      break;
    case 'counter':
      if ('value' in target) {
        items.push(act('menu.counterPlus', { type: 'counter.add', id: target.id, delta: 1 }));
        items.push(act('menu.counterMinus', { type: 'counter.add', id: target.id, delta: -1 }));
        items.push({
          key: 'menu.counterSet',
          command: {
            kind: 'number',
            initial: target.value,
            min: target.min ?? -9999,
            max: target.max ?? 9999,
            make: (n) => ({ type: 'counter.set', id: target.id, value: n }),
          },
        });
      }
      break;
    case 'token':
    case 'board':
      break;
  }

  if (unlocked.length > 0) {
    const rotation = (target.rotation + 90) % 360;
    items.push(act('menu.rotate', { type: 'component.rotate', ids: unlocked, rotation }));
  }
  items.push(
    target.locked
      ? act('menu.unlock', { type: 'component.lock', ids, locked: false })
      : act('menu.lock', { type: 'component.lock', ids, locked: true }),
  );
  if (inSelection) {
    items.push(act('menu.group', { type: 'group.create', ids }));
    items.push({ key: 'menu.clearSelection', command: { kind: 'clearSelection' } });
  } else if (selection.has(target.id)) {
    items.push({ key: 'menu.deselect', command: { kind: 'deselect', ids: [target.id] } });
  } else {
    items.push({ key: 'menu.select', command: { kind: 'select', ids: [target.id] } });
  }
  if (target.groupId)
    items.push(act('menu.ungroup', { type: 'group.dissolve', groupId: target.groupId }));
  return items;
}
