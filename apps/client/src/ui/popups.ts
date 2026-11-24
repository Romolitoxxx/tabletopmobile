import type { MenuItem } from '../app/menu';
import type { I18n } from '../i18n/i18n';
import { h, overlay } from './dom';

/** Context menu near a screen point; becomes a bottom sheet on small screens via CSS. */
export function showMenu(
  items: MenuItem[],
  x: number,
  y: number,
  i18n: I18n,
  choose: (item: MenuItem) => void,
): void {
  if (items.length === 0) return;
  let layer: HTMLElement | null = null;
  const close = () => layer?.remove();
  const list = h(
    'div',
    { class: 'menu', role: 'menu' },
    ...items.map((item) =>
      h(
        'button',
        {
          class: 'menu-item',
          role: 'menuitem',
          onclick: () => {
            close();
            choose(item);
          },
        },
        i18n.t(item.key),
      ),
    ),
    h('button', { class: 'menu-item menu-cancel', onclick: close }, i18n.t('menu.cancel')),
  );
  layer = overlay(close, list);
  const r = list.getBoundingClientRect();
  list.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
  list.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
}

/** Asks for an integer. Resolves null when cancelled. */
export function askNumber(
  title: string,
  initial: number,
  min: number,
  max: number,
  i18n: I18n,
): Promise<number | null> {
  return new Promise((resolve) => {
    let layer: HTMLElement | null = null;
    const done = (v: number | null) => {
      layer?.remove();
      resolve(v);
    };
    const input = h('input', {
      type: 'number',
      inputmode: 'numeric',
      min,
      max,
      value: initial,
      'aria-label': i18n.t('prompt.number'),
    });
    const submit = () => {
      const v = Math.round(Number(input.value));
      if (Number.isFinite(v)) done(Math.min(max, Math.max(min, v)));
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const box = h(
      'div',
      { class: 'dialog' },
      h('h2', {}, title),
      input,
      h(
        'div',
        { class: 'row' },
        h('button', { onclick: () => done(null) }, i18n.t('prompt.cancel')),
        h('button', { class: 'primary', onclick: submit }, i18n.t('prompt.ok')),
      ),
    );
    layer = overlay(() => done(null), box);
    input.focus();
    input.select();
  });
}

export interface ZoomAction {
  label: string;
  run: () => void;
}

/** Shows a card (or any image) large, with optional actions below. */
export function showZoom(imageUrl: string, actions: ZoomAction[], i18n: I18n): void {
  let layer: HTMLElement | null = null;
  const close = () => layer?.remove();
  const buttons = actions.map((a) =>
    h(
      'button',
      {
        onclick: () => {
          close();
          a.run();
        },
      },
      a.label,
    ),
  );
  layer = overlay(
    close,
    h(
      'div',
      { class: 'zoom' },
      h('img', { src: imageUrl, alt: '' }),
      h(
        'div',
        { class: 'actions' },
        ...buttons,
        h('button', { onclick: close }, i18n.t('hand.close')),
      ),
    ),
  );
}

export interface GalleryItem {
  imageUrl: string;
  action: ZoomAction;
}

/** A row of cards (e.g. the ones a player is looking at in a deck). */
export function showGallery(
  title: string,
  items: GalleryItem[],
  doneLabel: string,
  onDone: () => void,
): void {
  let layer: HTMLElement | null = null;
  const close = () => {
    layer?.remove();
    onDone();
  };
  const cards = items.map((it) =>
    h(
      'figure',
      {},
      h('img', { src: it.imageUrl, alt: '' }),
      h(
        'button',
        {
          onclick: () => {
            layer?.remove();
            it.action.run();
          },
        },
        it.action.label,
      ),
    ),
  );
  layer = overlay(
    () => layer?.remove(),
    h(
      'div',
      { class: 'dialog gallery' },
      h('h2', {}, title),
      h('div', { class: 'cards' }, ...cards),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: close }, doneLabel)),
    ),
  );
}

/** Short message at the top of the screen. */
export function toast(message: string): void {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('hide'), 1800);
  setTimeout(() => el.remove(), 2300);
}
