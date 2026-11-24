import './styles.css';
import { GameSession, LocalHost, makeToken, type Player, SandboxRules } from '@tabletop/core';
import { BuiltinModuleLoader } from '@tabletop/module-format';
import { GameController } from './app/controller';
import { detectLocale, I18n, type Locale } from './i18n/i18n';
import { Assets } from './render/assets';

const LOCALE_KEY = 'tabletop.locale';
const PLAYER_ID = 'p1';

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

/** Secret random string for seeds and opaque ids. */
function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createHost(i18n: I18n): Promise<LocalHost> {
  const module = await new BuiltinModuleLoader().load('builtin:demo');
  const players: Player[] = [
    {
      id: PLAYER_ID,
      name: i18n.t('player.default', { n: 1 }),
      color: '#ffca28',
      seat: 0,
      role: 'player',
    },
  ];
  let state = module.createState(players, randomSecret());
  // `?stress=N` adds N extra tokens to check rendering performance.
  const stress = Number(new URLSearchParams(location.search).get('stress') ?? 0);
  if (stress > 0) {
    const components = { ...state.components };
    for (let i = 0; i < Math.min(stress, 2000); i++) {
      const t = makeToken({
        id: `stress-${i}`,
        image: `gen:token:${['red', 'blue', 'green', 'yellow'][i % 4]}`,
        x: 100 + ((i * 47) % 2200),
        y: 100 + ((i * 89) % 1400),
        w: 36,
        h: 36,
      });
      components[t.id] = {
        ...t,
        location: {
          kind: 'table',
          x: t.location.kind === 'table' ? t.location.x : 0,
          y: t.location.kind === 'table' ? t.location.y : 0,
          z: state.nextZ + i,
        },
      };
    }
    state = { ...state, components, nextZ: state.nextZ + stress };
  }
  const session = GameSession.start({
    state,
    rules: SandboxRules,
    seed: randomSecret(),
    undoPolicy: 'free',
  });
  return new LocalHost(session);
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) return;
  const i18n = new I18n(loadLocale() ?? detectLocale(navigator.languages));
  document.documentElement.lang = i18n.locale;
  document.title = i18n.t('app.title');

  const controller: GameController = new GameController(root, new Assets(), i18n, {
    onNewGame: () => void createHost(i18n).then((host) => controller.load(host, PLAYER_ID)),
    onLocaleChange: () => {
      i18n.locale = i18n.locale === 'it' ? 'en' : 'it';
      document.documentElement.lang = i18n.locale;
      saveLocale(i18n.locale);
      controller.refreshTexts();
    },
  });
  await controller.init();
  await controller.load(await createHost(i18n), PLAYER_ID);
}

void main();
