import type { TableInfo } from '@tabletop/core';
import type { I18n } from '../i18n/i18n';
import { h, overlay } from './dom';

export type OnlineChoice =
  | { kind: 'create'; server: string; name: string; moduleId: string; gameName: string }
  | { kind: 'join'; server: string; name: string; code: string };

export interface OnlineDefaults {
  server: string;
  name: string;
  modules: { id: string; name: string }[];
}

/** Dialog to create an online table or join one with its code. */
export function showOnlineDialog(
  i18n: I18n,
  defaults: OnlineDefaults,
  onChoice: (choice: OnlineChoice) => void,
): void {
  const t = i18n.t.bind(i18n);
  let mode: 'create' | 'join' = 'join';
  const nameInput = h('input', {
    type: 'text',
    value: defaults.name,
    maxlength: 24,
    autocomplete: 'nickname',
    'aria-label': t('online.name'),
  });
  const serverInput = h('input', {
    type: 'text',
    value: defaults.server,
    inputmode: 'url',
    autocapitalize: 'off',
    spellcheck: false,
    'aria-label': t('online.server'),
  });
  const codeInput = h('input', {
    type: 'text',
    maxlength: 8,
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: false,
    class: 'code',
    'aria-label': t('online.code'),
  });
  const moduleSelect = h(
    'select',
    { 'aria-label': t('newGame.module') },
    ...defaults.modules.map((m) => h('option', { value: m.id }, m.name)),
  );
  const gameNameInput = h('input', {
    type: 'text',
    maxlength: 60,
    value: defaults.modules[0]?.name ?? '',
    'aria-label': t('newGame.name'),
  });
  moduleSelect.addEventListener('change', () => {
    gameNameInput.value = defaults.modules.find((m) => m.id === moduleSelect.value)?.name ?? '';
  });

  const modeBox = h('div', { class: 'segmented' });
  const fields = h('div', {});
  const confirm = h('button', { class: 'primary' });
  const render = () => {
    const option = (m: typeof mode, key: 'online.join' | 'online.create') =>
      h(
        'button',
        {
          class: m === mode ? 'primary' : '',
          'aria-pressed': m === mode ? 'true' : 'false',
          onclick: () => {
            mode = m;
            render();
          },
        },
        t(key),
      );
    modeBox.replaceChildren(option('join', 'online.join'), option('create', 'online.create'));
    fields.replaceChildren(
      ...(mode === 'join'
        ? [h('label', {}, t('online.code'), codeInput)]
        : [
            h('label', {}, t('newGame.module'), moduleSelect),
            h('label', {}, t('newGame.name'), gameNameInput),
          ]),
    );
    confirm.textContent = t(mode === 'join' ? 'online.join' : 'online.create');
  };
  render();

  let layer: HTMLElement | null = null;
  const close = () => layer?.remove();
  confirm.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const server = serverInput.value.trim();
    if (!name) return nameInput.focus();
    if (!server) return serverInput.focus();
    if (mode === 'join') {
      const code = codeInput.value.trim();
      if (!code) return codeInput.focus();
      close();
      onChoice({ kind: 'join', server, name, code });
    } else {
      close();
      onChoice({
        kind: 'create',
        server,
        name,
        moduleId: moduleSelect.value,
        gameName: gameNameInput.value.trim() || (defaults.modules[0]?.name ?? 'Game'),
      });
    }
  });
  layer = overlay(
    close,
    h(
      'div',
      { class: 'dialog form' },
      h('h2', {}, t('online.title')),
      h('label', {}, t('online.name'), nameInput),
      h('div', { class: 'field' }, modeBox),
      fields,
      h('label', {}, t('online.server'), serverInput),
      h('div', { class: 'row' }, h('button', { onclick: close }, t('newGame.cancel')), confirm),
    ),
  );
}

/** Lobby: the table code, who is seated, and the start button for the host. */
export class LobbyScreen {
  readonly el = h('main', { class: 'home lobby hidden' });

  constructor(
    private readonly i18n: I18n,
    private readonly handlers: { onStart(): void; onLeave(): void },
  ) {}

  show(info: TableInfo | null, playerId: string): void {
    this.el.classList.remove('hidden');
    this.render(info, playerId);
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.replaceChildren();
  }

  render(info: TableInfo | null, playerId: string): void {
    const t = this.i18n.t.bind(this.i18n);
    if (!info) {
      this.el.replaceChildren(
        h('div', { class: 'home-inner' }, h('p', { class: 'muted' }, t('online.connecting'))),
      );
      return;
    }
    const me = info.seats.find((s) => s.playerId === playerId);
    const seats = h(
      'ul',
      { class: 'saves seats' },
      ...info.seats.map((s) => {
        const tags = [
          s.playerId === playerId ? t('online.you') : null,
          s.owner ? t('online.host') : null,
          s.connected ? null : t('online.offline'),
        ].filter((x): x is string => x !== null);
        return h(
          'li',
          { class: s.connected ? '' : 'away' },
          h(
            'div',
            { class: 'seat' },
            h('span', { class: 'dot', style: `background:${s.color}` }),
            h('strong', {}, s.name),
            tags.length > 0 ? h('span', { class: 'muted' }, tags.join(' · ')) : null,
          ),
        );
      }),
    );
    this.el.replaceChildren(
      h(
        'div',
        { class: 'home-inner' },
        h('h1', {}, info.gameName),
        h('p', { class: 'muted' }, t('online.lobbyHint')),
        h('div', { class: 'table-code', 'aria-label': t('online.code') }, info.code),
        h('h2', {}, t('newGame.players')),
        seats,
        me?.owner
          ? h(
              'button',
              { class: 'primary big', onclick: () => this.handlers.onStart() },
              t('online.start'),
            )
          : h('p', { class: 'muted' }, t('online.waiting')),
        h('button', { class: 'big', onclick: () => this.handlers.onLeave() }, t('online.leave')),
      ),
    );
  }
}
