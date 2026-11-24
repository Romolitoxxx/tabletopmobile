import { type GameEvent, type PlayerView, SYSTEM_PLAYER } from '@tabletop/core';
import type { I18n } from '../i18n/i18n';

/** Display name of a player. */
export function playerName(view: PlayerView, id: string | null, i18n: I18n): string {
  if (id === null) return '—';
  if (id === SYSTEM_PLAYER) return i18n.t('player.system');
  return view.players.find((p) => p.id === id)?.name ?? id;
}

/** Display name of a component: modules name components with i18n-able keys (`name.<key>`). */
export function componentName(view: PlayerView, id: string, i18n: I18n): string {
  const c = view.components.find((x) => x.id === id);
  const name = c && 'name' in c ? c.name : null;
  if (!name) return i18n.t('name.unknown');
  const key = `name.${name}`;
  return i18n.has(key) ? i18n.t(key) : name;
}

/** One line of the action log, e.g. "Marco drew 2 cards from Deck". */
export function formatEvent(e: GameEvent, view: PlayerView, i18n: I18n): string {
  const key = `event.${e.type}`;
  if (!i18n.has(key)) return e.type;
  const p = e.params;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const params: Record<string, string | number> = {
    actor: playerName(view, e.actor, i18n),
    count: typeof p.count === 'number' ? p.count : e.componentIds.length,
  };
  const deck = str(p.deckId) ?? str(p.containerId);
  if (deck) params.deck = componentName(view, deck, i18n);
  if (str(p.bagId)) params.bag = componentName(view, str(p.bagId)!, i18n);
  if (Array.isArray(p.values)) params.values = p.values.join(', ');
  if (typeof p.value === 'number') params.value = p.value;
  for (const k of ['to', 'next', 'current'] as const) {
    if (k in p) params[k] = playerName(view, str(p[k]), i18n);
  }
  return i18n.t(key, params);
}
