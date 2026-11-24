import type {
  BagComponent,
  BoardComponent,
  CardComponent,
  Component,
  ComponentBase,
  CounterComponent,
  DeckComponent,
  DieComponent,
  DieFace,
  GameState,
  Player,
  Table,
  TileComponent,
  TokenComponent,
  Zone,
} from './types';

type BaseInit = Partial<Omit<ComponentBase, 'id' | 'location'>> & {
  id: string;
  x?: number;
  y?: number;
};

function base(init: BaseInit, defaults: { w: number; h: number; layer: number }): ComponentBase {
  return {
    id: init.id,
    name: init.name ?? null,
    location: { kind: 'table', x: init.x ?? 0, y: init.y ?? 0, z: 0 },
    rotation: init.rotation ?? 0,
    locked: init.locked ?? false,
    owner: init.owner ?? null,
    groupId: init.groupId ?? null,
    w: init.w ?? defaults.w,
    h: init.h ?? defaults.h,
    layer: init.layer ?? defaults.layer,
    hideEpoch: 0,
  };
}

const PIECE = { w: 40, h: 40, layer: 1 };
const CARD = { w: 63, h: 88, layer: 1 };

export function makeCard(
  init: BaseInit & { front: string; back: string; faceUp?: boolean },
): CardComponent {
  return {
    ...base(init, CARD),
    type: 'card',
    front: init.front,
    back: init.back,
    faceUp: init.faceUp ?? false,
    visibility: 'nobody',
  };
}

export function makeTile(
  init: BaseInit & { front: string; back: string; faceUp?: boolean },
): TileComponent {
  return { ...makeCard(init), type: 'tile' };
}

/** Builds a deck and the cards inside it (first card = top). */
export function makeDeck(
  init: BaseInit & { cards: CardComponent[]; faceUp?: boolean },
): Component[] {
  const deck: DeckComponent = {
    ...base(init, CARD),
    type: 'deck',
    contents: init.cards.map((c) => c.id),
    faceUp: init.faceUp ?? false,
    peeks: {},
  };
  const cards = init.cards.map((c): CardComponent => ({
    ...c,
    location: { kind: 'container', containerId: deck.id },
    faceUp: false,
  }));
  return [deck, ...cards];
}

/** Builds a bag and the components inside it. */
export function makeBag(
  init: BaseInit & { image: string; contents: Component[]; infinite?: boolean },
): Component[] {
  const bag: BagComponent = {
    ...base(init, { w: 60, h: 60, layer: 1 }),
    type: 'bag',
    image: init.image,
    contents: init.contents.map((c) => c.id),
    infinite: init.infinite ?? false,
  };
  const inside = init.contents.map((c): Component => ({
    ...c,
    location: { kind: 'container', containerId: bag.id },
  }));
  return [bag, ...inside];
}

export function makeToken(init: BaseInit & { image: string }): TokenComponent {
  return { ...base(init, PIECE), type: 'token', image: init.image };
}

export function makeBoard(init: BaseInit & { image: string }): BoardComponent {
  return { ...base(init, { w: 600, h: 600, layer: 0 }), type: 'board', image: init.image };
}

export function makeCounter(
  init: BaseInit & { value?: number; min?: number | null; max?: number | null },
): CounterComponent {
  return {
    ...base(init, PIECE),
    type: 'counter',
    value: init.value ?? 0,
    min: init.min ?? null,
    max: init.max ?? null,
  };
}

export function makeDie(init: BaseInit & { faces?: DieFace[] | number }): DieComponent {
  const faces =
    typeof init.faces === 'object'
      ? init.faces
      : Array.from({ length: init.faces ?? 6 }, (_, i): DieFace => ({
          kind: 'number',
          value: i + 1,
        }));
  return { ...base(init, PIECE), type: 'die', faces, faceIndex: 0 };
}

export interface GameStateInit {
  moduleId: string;
  table?: Partial<Table>;
  players: Player[];
  components: Component[];
  zones?: Zone[];
  /** Secret key used to derive opaque ids; must come from a secure random source. */
  maskKey: string;
}

/** Assembles a consistent initial game state. */
export function createGameState(init: GameStateInit): GameState {
  const components: GameState['components'] = {};
  let z = 0;
  for (const c of init.components) {
    if (components[c.id]) throw new Error(`Duplicate component id: ${c.id}`);
    components[c.id] =
      c.location.kind === 'table' ? { ...c, location: { ...c.location, z: ++z } } : c;
  }
  const hands: GameState['hands'] = {};
  for (const p of init.players) hands[p.id] = [];
  const order = init.players
    .filter((p) => p.role !== 'spectator')
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
    .map((p) => p.id);
  return {
    schemaVersion: 1,
    moduleId: init.moduleId,
    table: { width: 2000, height: 2000, background: null, grid: null, ...init.table },
    players: init.players,
    components,
    hands,
    zones: init.zones ?? [],
    turn: { order, current: order[0] ?? null, number: 1, phase: null },
    prompts: [],
    rulesData: null,
    nextId: 1,
    nextZ: z + 1,
    secret: { maskKey: init.maskKey },
  };
}
