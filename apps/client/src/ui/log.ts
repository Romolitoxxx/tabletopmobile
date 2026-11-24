import type { GameEvent } from '@tabletop/core';
import type { I18n } from '../i18n/i18n';
import { h } from './dom';

const MAX_LINES = 200;

/** Side panel with the action log. Events are re-formatted when the language changes. */
export class LogPanel {
  readonly el = h('aside', { class: 'log hidden', 'aria-live': 'polite' });
  private readonly list = h('ol');
  private readonly title = h('h2');
  private events: GameEvent[] = [];

  constructor(
    private readonly i18n: I18n,
    private readonly format: (e: GameEvent) => string,
  ) {
    this.el.append(this.title, this.list);
    this.render();
  }

  toggle(): void {
    this.el.classList.toggle('hidden');
  }

  add(events: GameEvent[]): void {
    if (events.length === 0) return;
    this.events = [...this.events, ...events].slice(-MAX_LINES);
    this.render();
  }

  clear(): void {
    this.events = [];
    this.render();
  }

  render(): void {
    this.title.textContent = this.i18n.t('log.title');
    const items =
      this.events.length === 0
        ? [h('li', { class: 'muted' }, this.i18n.t('log.empty'))]
        : [...this.events].reverse().map((e) => h('li', {}, this.format(e)));
    this.list.replaceChildren(...items);
  }
}
