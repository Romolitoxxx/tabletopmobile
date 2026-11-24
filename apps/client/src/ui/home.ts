import type { GameMode } from '../app/game';
import { MAX_HOTSEAT_PLAYERS } from '../app/game';
import type { I18n } from '../i18n/i18n';
import type { SaveSummary } from '../storage/saves';
import { h, overlay } from './dom';

export interface NewGameChoice {
  moduleId: string;
  mode: GameMode;
  playerNames: string[];
  name: string;
}

export interface HomeHandlers {
  modules(): { id: string; name: string }[];
  onNew(choice: NewGameChoice): void;
  onOpen(id: string): void;
  onExport(id: string): void;
  onDelete(id: string): void;
  onImport(text: string): void;
  onLocale(): void;
}

/** Start screen: continue, new game, saved games. */
export class HomeScreen {
  readonly el = h('main', { class: 'home' });
  private saves: SaveSummary[] = [];

  constructor(
    private readonly i18n: I18n,
    private readonly handlers: HomeHandlers,
  ) {}

  setSaves(saves: SaveSummary[]): void {
    this.saves = saves;
    this.render();
  }

  private date(ms: number): string {
    return new Intl.DateTimeFormat(this.i18n.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(ms);
  }

  render(): void {
    const t = this.i18n.t.bind(this.i18n);
    const latest = this.saves[0];
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void file.text().then((text) => this.handlers.onImport(text));
      fileInput.value = '';
    });
    const list =
      this.saves.length === 0
        ? h('p', { class: 'muted' }, t('home.noSaves'))
        : h(
            'ul',
            { class: 'saves' },
            ...this.saves.map((s) =>
              h(
                'li',
                {},
                h(
                  'div',
                  { class: 'save-info' },
                  h('strong', {}, s.name),
                  h(
                    'span',
                    { class: 'muted' },
                    `${t(s.mode === 'solo' ? 'home.solo' : 'home.hotseat')} · ${s.players.join(', ')}`,
                  ),
                  h(
                    'span',
                    { class: 'muted' },
                    t('home.updated', { date: this.date(s.updatedAt) }),
                  ),
                ),
                h(
                  'div',
                  { class: 'save-actions' },
                  h(
                    'button',
                    { class: 'primary', onclick: () => this.handlers.onOpen(s.id) },
                    t('home.load'),
                  ),
                  h('button', { onclick: () => this.handlers.onExport(s.id) }, t('home.export')),
                  h(
                    'button',
                    {
                      onclick: () => {
                        if (window.confirm(t('home.confirmDelete', { name: s.name })))
                          this.handlers.onDelete(s.id);
                      },
                    },
                    t('home.delete'),
                  ),
                ),
              ),
            ),
          );
    this.el.replaceChildren(
      h(
        'div',
        { class: 'home-inner' },
        h(
          'header',
          {},
          h('h1', {}, t('app.title')),
          h(
            'button',
            { class: 'lang', onclick: () => this.handlers.onLocale() },
            t('home.language'),
          ),
        ),
        h('p', { class: 'muted' }, t('home.subtitle')),
        h(
          'div',
          { class: 'home-main' },
          latest
            ? h(
                'button',
                { class: 'primary big', onclick: () => this.handlers.onOpen(latest.id) },
                t('home.continue', { name: latest.name }),
              )
            : null,
          h(
            'button',
            { class: latest ? 'big' : 'primary big', onclick: () => this.openNewGame() },
            t('home.newGame'),
          ),
        ),
        h('h2', {}, t('home.saved')),
        list,
        h('button', { class: 'link', onclick: () => fileInput.click() }, t('home.import')),
        fileInput,
      ),
    );
  }

  private openNewGame(): void {
    const t = this.i18n.t.bind(this.i18n);
    const modules = this.handlers.modules();
    let mode: GameMode = 'solo';
    let count = 2;
    const names: string[] = Array.from({ length: MAX_HOTSEAT_PLAYERS }, (_, i) =>
      t('player.default', { n: i + 1 }),
    );
    const moduleSelect = h(
      'select',
      { 'aria-label': t('newGame.module') },
      ...modules.map((m) => h('option', { value: m.id }, m.name)),
    );
    const nameInput = h('input', {
      type: 'text',
      value: `${modules[0]?.name ?? ''} – ${this.date(Date.now())}`,
      'aria-label': t('newGame.name'),
    });
    const playersBox = h('div', { class: 'players' });
    const modeBox = h('div', { class: 'segmented' });

    const renderPlayers = () => {
      const countSelect = h(
        'select',
        { 'aria-label': t('newGame.players') },
        ...Array.from({ length: MAX_HOTSEAT_PLAYERS - 1 }, (_, i) => {
          const n = i + 2;
          return h('option', { value: n, selected: n === count }, String(n));
        }),
      );
      countSelect.addEventListener('change', () => {
        count = Number(countSelect.value);
        renderPlayers();
      });
      const shown = mode === 'solo' ? 1 : count;
      const inputs = Array.from({ length: shown }, (_, i) => {
        const input = h('input', {
          type: 'text',
          value: names[i]!,
          maxlength: 24,
          'aria-label': t('newGame.playerName', { n: i + 1 }),
        });
        input.addEventListener('input', () => (names[i] = input.value));
        return input;
      });
      const header = mode === 'hotseat' ? [h('label', {}, t('newGame.players'), countSelect)] : [];
      playersBox.replaceChildren(...header, ...inputs);
    };
    const renderMode = () => {
      const option = (m: GameMode, key: 'home.solo' | 'home.hotseat') =>
        h(
          'button',
          {
            class: m === mode ? 'primary' : '',
            'aria-pressed': m === mode ? 'true' : 'false',
            onclick: () => {
              mode = m;
              renderMode();
              renderPlayers();
            },
          },
          t(key),
        );
      modeBox.replaceChildren(option('solo', 'home.solo'), option('hotseat', 'home.hotseat'));
    };
    renderMode();
    renderPlayers();

    let layer: HTMLElement | null = null;
    const close = () => layer?.remove();
    const start = () => {
      close();
      this.handlers.onNew({
        moduleId: moduleSelect.value,
        mode,
        playerNames: names.slice(0, mode === 'solo' ? 1 : count),
        name: nameInput.value.trim() || (modules[0]?.name ?? 'Game'),
      });
    };
    layer = overlay(
      close,
      h(
        'div',
        { class: 'dialog form' },
        h('h2', {}, t('newGame.title')),
        h('label', {}, t('newGame.module'), moduleSelect),
        h('label', {}, t('newGame.name'), nameInput),
        h('div', { class: 'field' }, h('span', {}, t('newGame.mode')), modeBox),
        playersBox,
        h(
          'div',
          { class: 'row' },
          h('button', { onclick: close }, t('newGame.cancel')),
          h('button', { class: 'primary', onclick: start }, t('newGame.start')),
        ),
      ),
    );
  }
}
