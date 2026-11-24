import type { ComponentView, PlayerView } from '@tabletop/core';
import type { I18n } from '../i18n/i18n';
import type { Assets } from '../render/assets';
import { h } from './dom';

const CARD_W = 72;
const DRAG_THRESHOLD_TOUCH = 20;
const DRAG_THRESHOLD_MOUSE = 8;
/** A dragged card is played only when released this far above the hand. */
const DROP_MARGIN = 24;

export interface HandHandlers {
  onCardTap(id: string): void;
  /** A card was dragged out of the hand and released at a client point. */
  onCardDrop(id: string, clientX: number, clientY: number): void;
}

/** Fan-shaped hand at the bottom of the screen. */
export class HandBar {
  readonly el = h('div', { class: 'hand', 'aria-label': 'hand' });
  private cards: ComponentView[] = [];

  constructor(
    private readonly assets: Assets,
    private readonly i18n: I18n,
    private readonly handlers: HandHandlers,
  ) {
    new ResizeObserver(() => this.layout()).observe(this.el);
  }

  /** True if a client point is over the hand area (to drop cards into it). */
  contains(clientX: number, clientY: number): boolean {
    const r = this.el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /** True if a card released here should leave the hand. */
  private isDropOutside(clientY: number): boolean {
    return clientY < this.el.getBoundingClientRect().top - DROP_MARGIN;
  }

  setHighlight(on: boolean): void {
    this.el.classList.toggle('drop-target', on);
  }

  update(view: PlayerView): void {
    const byId = new Map(view.components.map((c) => [c.id, c]));
    this.cards = view.hand
      .map((id) => byId.get(id))
      .filter((c): c is ComponentView => c !== undefined);
    this.render();
  }

  private render(): void {
    this.el.replaceChildren();
    if (this.cards.length === 0) {
      this.el.append(h('div', { class: 'hand-empty' }, this.i18n.t('hand.empty')));
      return;
    }
    for (const c of this.cards) {
      if (c.type !== 'card' && c.type !== 'tile') continue;
      if ('hidden' in c) continue;
      const img = h('img', {
        class: 'hand-card',
        src: this.assets.url(c.front, c.w, c.h),
        alt: '',
        draggable: 'false',
      });
      this.attachDrag(img, c.id);
      this.el.append(img);
    }
    this.layout();
  }

  private layout(): void {
    const imgs = [...this.el.querySelectorAll<HTMLImageElement>('.hand-card')];
    const n = imgs.length;
    if (n === 0) return;
    const width = this.el.clientWidth;
    const cardW = imgs[0]?.offsetWidth || CARD_W;
    const spacing = n === 1 ? 0 : Math.min(cardW * 0.85, (width - cardW - 24) / (n - 1));
    const angle = Math.min(5, 36 / n);
    const total = spacing * (n - 1);
    imgs.forEach((img, i) => {
      const k = i - (n - 1) / 2;
      const x = width / 2 - cardW / 2 - total / 2 + i * spacing;
      img.style.left = `${x}px`;
      img.style.transform = `translateY(${Math.abs(k) * Math.abs(k) * 1.2}px) rotate(${k * angle}deg)`;
      img.style.zIndex = String(i + 1);
    });
  }

  private attachDrag(img: HTMLImageElement, id: string): void {
    let start: { x: number; y: number } | null = null;
    let threshold = DRAG_THRESHOLD_TOUCH;
    let ghost: HTMLImageElement | null = null;
    img.addEventListener('pointerdown', (e) => {
      img.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      threshold = e.pointerType === 'mouse' ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH;
    });
    img.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > threshold) {
        ghost = img.cloneNode() as HTMLImageElement;
        ghost.className = 'drag-ghost';
        document.body.append(ghost);
        img.style.opacity = '0.3';
      }
      if (ghost) {
        ghost.style.left = `${e.clientX - CARD_W / 2}px`;
        ghost.style.top = `${e.clientY - CARD_W * 0.7}px`;
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!start) return;
      start = null;
      img.style.opacity = '';
      if (ghost) {
        ghost.remove();
        ghost = null;
        if (!cancelled && this.isDropOutside(e.clientY))
          this.handlers.onCardDrop(id, e.clientX, e.clientY);
      } else if (!cancelled) {
        this.handlers.onCardTap(id);
      }
    };
    img.addEventListener('pointerup', (e) => end(e, false));
    img.addEventListener('pointercancel', (e) => end(e, true));
  }
}
