import type { I18n } from '../i18n/i18n';
import { h, overlay } from './dom';

/**
 * Opaque screen shown between two players on the same device. Nothing of
 * the next player's view is rendered until they confirm.
 */
export function showHandoff(name: string, color: string, i18n: I18n): Promise<void> {
  return new Promise((resolve) => {
    let layer: HTMLElement | null = null;
    const ready = h(
      'button',
      {
        class: 'primary big',
        onclick: () => {
          layer?.remove();
          resolve();
        },
      },
      i18n.t('handoff.ready', { player: name }),
    );
    layer = overlay(
      () => {},
      h(
        'div',
        { class: 'handoff' },
        h('div', { class: 'avatar', style: `background:${color}` }, name.slice(0, 1).toUpperCase()),
        h('h1', {}, i18n.t('handoff.title', { player: name })),
        h('p', { class: 'muted' }, i18n.t('handoff.hint')),
        ready,
      ),
    );
    layer.classList.add('opaque');
  });
}

/** Lets the players choose who takes the device. */
export function choosePlayer(
  players: { id: string; name: string; color: string }[],
  i18n: I18n,
): Promise<string | null> {
  return new Promise((resolve) => {
    let layer: HTMLElement | null = null;
    const done = (id: string | null) => {
      layer?.remove();
      resolve(id);
    };
    layer = overlay(
      () => done(null),
      h(
        'div',
        { class: 'dialog' },
        h('h2', {}, i18n.t('switch.title')),
        h(
          'div',
          { class: 'player-list' },
          ...players.map((p) =>
            h(
              'button',
              { onclick: () => done(p.id) },
              h('span', { class: 'dot', style: `background:${p.color}` }),
              p.name,
            ),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { onclick: () => done(null) }, i18n.t('prompt.cancel')),
        ),
      ),
    );
  });
}
