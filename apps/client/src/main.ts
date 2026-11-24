import './styles.css';
import { LocalHost, type GameSession } from '@tabletop/core';
import { BuiltinModuleLoader } from '@tabletop/module-format';
import { GameController } from './app/controller';
import { createGame, type GameRecord, restoreGame, updateRecord } from './app/game';
import { detectLocale, I18n, type Locale } from './i18n/i18n';
import {
  normalizeCode,
  normalizeServer,
  onlineErrorCode,
  OnlineSession,
  type OnlineListener,
  type OnlineTicket,
} from './net/online';
import { listenLifecycle, settings, shareTextFile } from './platform/platform';
import { Assets } from './render/assets';
import {
  exportRecord,
  IndexedDbSaveStore,
  MemorySaveStore,
  parseExport,
  type SaveStore,
} from './storage/saves';
import { h } from './ui/dom';
import { HomeScreen, type NewGameChoice } from './ui/home';
import { LobbyScreen, type OnlineChoice, showOnlineDialog } from './ui/online';
import { toast } from './ui/popups';

const LOCALE_KEY = 'tabletop.locale';
const AUTOSAVE_DELAY_MS = 400;
const SERVER_KEY = 'tabletop.online.server';
const NAME_KEY = 'tabletop.online.name';
const TICKET_KEY = 'tabletop.online.ticket';

/** Server offered by default: build-time setting, else this host on the default port. */
function defaultServer(): string {
  const configured: unknown = import.meta.env.VITE_SERVER_URL;
  if (typeof configured === 'string' && configured) return configured;
  const secure = location.protocol === 'https:' && location.hostname !== 'localhost';
  return `${secure ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:2567`;
}

/** The seat this device can go back to (online), if any. */
async function loadTicket(): Promise<OnlineTicket | null> {
  try {
    const t = JSON.parse((await settings.get(TICKET_KEY)) || 'null') as Partial<OnlineTicket>;
    if (
      t &&
      typeof t.server === 'string' &&
      typeof t.code === 'string' &&
      typeof t.seatToken === 'string' &&
      typeof t.name === 'string'
    ) {
      const { server, code, seatToken, name } = t;
      return { server, code, seatToken, name, gameName: t.gameName ?? '' };
    }
  } catch {
    // Corrupted: forget it.
  }
  return null;
}

async function loadLocale(): Promise<Locale | null> {
  const v = await settings.get(LOCALE_KEY);
  return v === 'it' || v === 'en' ? v : null;
}

/** Secret random string for seeds, opaque ids and record ids. */
function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function openStore(): SaveStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbSaveStore();
  } catch {
    // fall through
  }
  return new MemorySaveStore();
}

class App {
  private readonly i18n = new I18n(detectLocale(navigator.languages));
  private readonly store = openStore();
  private readonly loader = new BuiltinModuleLoader();
  private readonly gameRoot = h('div', { class: 'game hidden' });
  private readonly home: HomeScreen;
  private readonly controller: GameController;
  private current: { record: GameRecord; session: GameSession; active: string } | null = null;
  private online: OnlineSession | null = null;
  /** True once the online game is on screen (not the lobby). */
  private onlinePlaying = false;
  private readonly lobby: LobbyScreen;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly root: HTMLElement) {
    this.home = new HomeScreen(this.i18n, {
      modules: () => this.loader.list().map((m) => ({ id: m.manifest.id, name: m.manifest.name })),
      onNew: (choice) => void this.newGame(choice),
      onOpen: (id) => void this.open(id),
      onExport: (id) => void this.exportGame(id),
      onDelete: (id) => void this.store.delete(id).then(() => this.showHome()),
      onImport: (text) => void this.importGame(text),
      onLocale: () => this.toggleLocale(),
      onOnline: () => void this.openOnline(),
      onRejoin: () => void this.rejoin(),
    });
    this.lobby = new LobbyScreen(this.i18n, {
      onStart: () => this.online?.start(),
      onLeave: () => void this.leaveOnline(),
    });
    this.controller = new GameController(this.gameRoot, new Assets(), this.i18n, {
      onExit: () => void this.exitGame(),
      onChange: (active) => this.scheduleSave(active),
    });
    root.append(this.home.el, this.lobby.el, this.gameRoot);
    // Save before the app is closed or put in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
    window.addEventListener('pagehide', () => void this.flush());
    listenLifecycle({ onBack: () => this.back(), onPause: () => void this.flush() });
  }

  /** Android back: close the topmost popup, else leave the game. */
  private back(): boolean {
    const layers = document.querySelectorAll<HTMLElement>('.overlay');
    const top = layers[layers.length - 1];
    if (top) {
      // Same as tapping outside the popup (the handoff screen ignores it).
      top.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return true;
    }
    if (this.current || this.online) {
      void this.exitGame();
      return true;
    }
    return false;
  }

  private async exitGame(): Promise<void> {
    if (this.online) return this.leaveOnline();
    await this.flush();
    await this.showHome();
  }

  async start(): Promise<void> {
    this.i18n.locale = (await loadLocale()) ?? this.i18n.locale;
    this.applyLocale();
    await this.controller.init();
    await this.showHome();
  }

  private applyLocale(): void {
    document.documentElement.lang = this.i18n.locale;
    document.title = this.i18n.t('app.title');
  }

  private toggleLocale(): void {
    this.i18n.locale = this.i18n.locale === 'it' ? 'en' : 'it';
    void settings.set(LOCALE_KEY, this.i18n.locale);
    this.applyLocale();
    this.home.render();
    this.controller.refreshTexts();
    if (this.online && !this.onlinePlaying)
      this.lobby.render(this.online.table, this.online.playerId);
    if (this.online && this.onlinePlaying) this.setOnlineBadge(false);
  }

  private async showHome(): Promise<void> {
    this.controller.detach();
    this.current = null;
    this.gameRoot.classList.add('hidden');
    this.lobby.hide();
    this.home.el.classList.remove('hidden');
    this.home.setRejoin((await loadTicket())?.code ?? null);
    try {
      this.home.setSaves(await this.store.list());
    } catch {
      this.home.setSaves([]);
    }
  }

  private async play(record: GameRecord, session: GameSession): Promise<void> {
    this.current = { record, session, active: record.activePlayerId };
    this.home.el.classList.add('hidden');
    this.gameRoot.classList.remove('hidden');
    this.controller.showFps(record.moduleId === 'stress');
    this.controller.setBadge(null);
    await this.controller.load(
      new LocalHost(session),
      record.activePlayerId,
      record.mode,
      record.mode === 'hotseat',
    );
  }

  private async newGame(choice: NewGameChoice): Promise<void> {
    const module = await this.loader.load(`builtin:${choice.moduleId}`);
    const { record, session } = createGame({
      module,
      mode: choice.mode,
      playerNames: choice.playerNames,
      name: choice.name,
      secret: randomSecret,
      now: Date.now(),
    });
    await this.store.put(record);
    await this.play(record, session);
  }

  private async open(id: string): Promise<void> {
    const record = await this.store.get(id);
    if (!record) return;
    try {
      await this.play(record, restoreGame(record));
    } catch {
      toast(this.i18n.t('home.importError'));
    }
  }

  private async exportGame(id: string): Promise<void> {
    const record = await this.store.get(id);
    if (!record) return;
    const safe = record.name.replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 40);
    try {
      await shareTextFile(`tabletop-${safe}.json`, exportRecord(record), record.name);
    } catch {
      // The user closed the share sheet: nothing to do.
    }
  }

  private async importGame(text: string): Promise<void> {
    const record = parseExport(text);
    try {
      if (!record) throw new Error('invalid');
      restoreGame(record); // validates the log by replaying it
      // Imported copies get a new id so they never overwrite a local game.
      await this.store.put({ ...record, id: randomSecret(), updatedAt: Date.now() });
      await this.showHome();
    } catch {
      toast(this.i18n.t('home.importError'));
    }
  }

  // ---------- online ----------

  private async openOnline(): Promise<void> {
    const ticket = await loadTicket();
    showOnlineDialog(
      this.i18n,
      {
        server: (await settings.get(SERVER_KEY)) || defaultServer(),
        name: (await settings.get(NAME_KEY)) || ticket?.name || '',
        modules: this.loader.list().map((m) => ({ id: m.manifest.id, name: m.manifest.name })),
      },
      (choice) => void this.connect(choice),
    );
  }

  private showLobby(): void {
    this.home.el.classList.add('hidden');
    this.gameRoot.classList.add('hidden');
    this.lobby.show(null, '');
  }

  private async connect(choice: OnlineChoice): Promise<void> {
    const server = normalizeServer(choice.server);
    void settings.set(SERVER_KEY, choice.server.trim());
    void settings.set(NAME_KEY, choice.name);
    this.showLobby();
    const listener = this.onlineListener();
    try {
      const session =
        choice.kind === 'create'
          ? await OnlineSession.create(
              server,
              { moduleId: choice.moduleId, gameName: choice.gameName, name: choice.name },
              listener,
            )
          : await OnlineSession.join(
              server,
              normalizeCode(choice.code),
              { name: choice.name },
              listener,
            );
      await this.attachOnline(session);
    } catch (e) {
      this.onlineError(e);
      await this.showHome();
    }
  }

  /** Back to one's seat with the token kept on this device. */
  private async rejoin(): Promise<void> {
    const ticket = await loadTicket();
    if (!ticket) return;
    this.showLobby();
    try {
      const session = await OnlineSession.join(
        ticket.server,
        ticket.code,
        { name: ticket.name, seatToken: ticket.seatToken },
        this.onlineListener(),
        ticket.gameName,
      );
      await this.attachOnline(session);
    } catch (e) {
      const code = this.onlineError(e);
      // The table or the seat is gone for good.
      if (code === 'bad_seat' || code === 'not_found') await settings.set(TICKET_KEY, '');
      await this.showHome();
    }
  }

  private onlineError(e: unknown): string {
    const code = onlineErrorCode(e);
    toast(this.i18n.t(`online.error.${code}`));
    return code;
  }

  private async attachOnline(session: OnlineSession): Promise<void> {
    this.online = session;
    this.onlinePlaying = false;
    await settings.set(TICKET_KEY, JSON.stringify(session.ticket));
    this.lobby.render(session.table, session.playerId);
    // The first view arrives when the game starts (at once if it already has).
    void session.host.getView(session.playerId).then(() => {
      if (this.online === session) void this.enterOnlineGame(session);
    });
  }

  private async enterOnlineGame(session: OnlineSession): Promise<void> {
    this.onlinePlaying = true;
    this.lobby.hide();
    this.home.el.classList.add('hidden');
    this.gameRoot.classList.remove('hidden');
    this.controller.showFps(session.table?.moduleId === 'stress');
    await this.controller.load(session.host, session.playerId, 'online', false);
    this.setOnlineBadge(false);
  }

  private setOnlineBadge(offline: boolean): void {
    const code = this.online?.ticket.code;
    if (code) this.controller.setBadge(this.i18n.t('toolbar.code', { code }), offline);
  }

  private onlineListener(): OnlineListener {
    let previous: Map<string, boolean> | null = null;
    return {
      onTable: (info) => {
        const session = this.online;
        if (session && session.ticket.code === info.code) {
          if (!this.onlinePlaying) this.lobby.render(info, session.playerId);
          else if (previous) this.announceSeats(previous, info.seats, session.playerId);
        }
        previous = new Map(info.seats.map((s) => [s.playerId, s.connected]));
      },
      onConnection: (state) => {
        if (!this.online) return;
        if (state === 'reconnecting') {
          this.setOnlineBadge(true);
          toast(this.i18n.t('online.reconnecting'));
        } else if (state === 'connected') {
          this.setOnlineBadge(false);
          toast(this.i18n.t('online.reconnected'));
        } else {
          // The transport gave up: during a game try once with the seat token.
          const playing = this.onlinePlaying;
          this.dropOnline();
          toast(this.i18n.t('online.closed'));
          if (playing) void this.rejoin();
          else void this.showHome();
        }
      },
    };
  }

  /** Tells who went offline or came back during the game. */
  private announceSeats(
    previous: Map<string, boolean>,
    seats: { playerId: string; name: string; connected: boolean }[],
    self: string,
  ): void {
    for (const s of seats) {
      const was = previous.get(s.playerId);
      if (s.playerId === self || was === undefined || was === s.connected) continue;
      const key = s.connected ? 'online.playerBack' : 'online.playerLeft';
      toast(this.i18n.t(key, { player: s.name }));
    }
  }

  private dropOnline(): void {
    const session = this.online;
    this.online = null;
    this.onlinePlaying = false;
    session?.host.close();
  }

  /** Leaves the table. A lobby seat is given up; a game seat stays reserved. */
  private async leaveOnline(): Promise<void> {
    const session = this.online;
    const started = this.onlinePlaying || session?.table?.phase === 'playing';
    this.dropOnline();
    if (!started) await settings.set(TICKET_KEY, '');
    await session?.leave();
    await this.showHome();
  }

  private scheduleSave(active: string): void {
    if (!this.current) return;
    this.current.active = active;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), AUTOSAVE_DELAY_MS);
  }

  /** Writes the current game to storage now. */
  private async flush(): Promise<void> {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const c = this.current;
    if (!c) return;
    c.record = updateRecord(c.record, c.session, c.active, Date.now());
    await this.store.put(c.record);
  }
}

const root = document.querySelector<HTMLDivElement>('#app');
if (root) void new App(root).start();
