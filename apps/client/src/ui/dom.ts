type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;

/** Minimal element factory: `h('button', { class: 'x', onclick: fn }, 'Label')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') {
      el.addEventListener(k.replace(/^on/, ''), v);
    } else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c !== null && c !== false) el.append(c);
  }
  return el;
}

/**
 * After a touch, browsers send a "compatibility" click to whatever is under
 * the finger. A popup opened by that same touch would receive it and trigger
 * the button under the finger, so clicks are ignored for a short time.
 */
export const GHOST_CLICK_MS = 400;

/** Full-screen layer that closes when tapping outside its content. */
export function overlay(onClose: () => void, ...content: HTMLElement[]): HTMLElement {
  const layer = h('div', { class: 'overlay' }, ...content);
  const openedAt = performance.now();
  layer.addEventListener(
    'click',
    (e) => {
      if (performance.now() - openedAt < GHOST_CLICK_MS) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  layer.addEventListener('pointerdown', (e) => {
    if (e.target === layer && performance.now() - openedAt >= GHOST_CLICK_MS) {
      e.preventDefault();
      onClose();
    }
  });
  document.body.append(layer);
  return layer;
}
