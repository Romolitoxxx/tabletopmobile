import './styles.css';
import { LocalHost, makeToken, type GameSession, type GameState } from '@tabletop/core';
import { BuiltinModuleLoader } from '@tabletop/module-format';
import { GameController } from './app/controller';
import { createGame, type GameRecord, restoreGame, updateRecord } from './app/game';
import { detectLocale, I18n, type Locale } from './i18n/i18n';
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
import { toast } from './ui/popups';

const LOCALE_KEY = 'tabletop.locale';
const AUTOSAVE_DELAY_MS = 400;

function loadLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v === 'it' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage may be unavailable (private mode): the choice just isn't remembered.
  }
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

/** `?stress=N` adds N extra tokens to check rendering performance. */
function withStress(state: GameState): GameState {
  const stress = Math.min(2000, Number(new URLSearchParams(location.search).get('stress') ?? 0));
  if (!(stress > 0)) return state;
  const components = { ...state.components };
  for (let i = 0; i < stress; i++) {
    const t = makeToken({
      id: `stress-${i}`,
      image: `gen:token:${['red', 'blue', 'green', 'yellow'][i % 4]}`,
      x: 100 + ((i * 47) % 2200),
      y: 100 + ((i * 89) % 1400),
      w: 36,
      h: 36,
    });
    components[t.id] =
      t.location.kind === 'table' ? { ...t, location: { ...t.location, z: state.nextZ + i } } : t;
  }
  return { ...state, components, nextZ: state.nextZ + stress };
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

class App {
  private readonly i18n = new I18n(loadLocale() ?? detectLocale(navigator.languages));
  private readonly store = openStore();
  private readonly loader = new BuiltinModuleLoader();
  private readonly gameRoot = h('div', { class: 'game hidden' });
  private readonly home: HomeScreen;
  private readonly controller: GameController;
  private current: { record: GameRecord; session: GameSession; active: string } | null = null;
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
    });
    this.controller = new GameController(this.gameRoot, new Assets(), this.i18n, {
      onExit: () => void this.flush().then(() => this.showHome()),
      onChange: (active) => this.scheduleSave(active),
    });
    root.append(this.home.el, this.gameRoot);
    // Save before the app is closed or put in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
    window.addEventListener('pagehide', () => void this.flush());
  }

  async start(): Promise<void> {
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
    saveLocale(this.i18n.locale);
    this.applyLocale();
    this.home.render();
    this.controller.refreshTexts();
  }

  private async showHome(): Promise<void> {
    this.controller.detach();
    this.current = null;
    this.gameRoot.classList.add('hidden');
    this.home.el.classList.remove('hidden');
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
    await this.controller.load(
      new LocalHost(session),
      record.activePlayerId,
      record.mode,
      record.mode === 'hotseat',
    );
  }

  private async newGame(choice: NewGameChoice): Promise<void> {
    const module = await this.loader.load(`builtin:${choice.moduleId}`);
    const stressed = {
      ...module,
      createState: (...a: Parameters<typeof module.createState>) =>
        withStress(module.createState(...a)),
    };
    const { record, session } = createGame({
      module: stressed,
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
    download(`tabletop-${safe}.json`, exportRecord(record));
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
