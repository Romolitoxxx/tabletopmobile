import {
  createGameState,
  makeBag,
  makeBoard,
  makeCard,
  makeCounter,
  makeDeck,
  makeDie,
  makeToken,
} from '../model/factory';
import type { GameState, Player } from '../model/types';

export const A = 'alice';
export const B = 'bob';
export const S = 'spec';

export const players: Player[] = [
  { id: A, name: 'Alice', color: '#e33', seat: 0, role: 'player' },
  { id: B, name: 'Bob', color: '#33e', seat: 1, role: 'player' },
  { id: S, name: 'Spec', color: '#999', seat: null, role: 'spectator' },
];

export const CARD_IDS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'];
export const front = (id: string): string => `front-${id}`;

/** A small table with one of every component type. */
export function fixture(): GameState {
  const cards = CARD_IDS.map((id) => makeCard({ id, front: front(id), back: 'back-red' }));
  return createGameState({
    moduleId: 'test',
    players,
    maskKey: 'test-mask-key',
    components: [
      makeBoard({ id: 'board', image: 'board.png', x: 0, y: 0 }),
      ...makeDeck({ id: 'deck', cards, x: 100, y: 100 }),
      ...makeDeck({ id: 'discard', cards: [], x: 200, y: 100, faceUp: true }),
      makeCard({ id: 'loose', front: front('loose'), back: 'back-blue', x: 300, y: 300 }),
      makeCard({
        id: 'open',
        front: front('open'),
        back: 'back-blue',
        x: 350,
        y: 300,
        faceUp: true,
      }),
      makeDie({ id: 'd1', x: 400, y: 400 }),
      makeDie({ id: 'd2', x: 450, y: 400, faces: 20 }),
      ...makeBag({
        id: 'bag',
        image: 'bag.png',
        x: 500,
        y: 500,
        contents: [
          makeToken({ id: 't1', image: 'red.png' }),
          makeToken({ id: 't2', image: 'green.png' }),
          makeToken({ id: 't3', image: 'blue.png' }),
        ],
      }),
      ...makeBag({
        id: 'supply',
        image: 'bag.png',
        x: 600,
        y: 500,
        infinite: true,
        contents: [makeToken({ id: 'gold', image: 'gold.png' })],
      }),
      makeCounter({ id: 'score', value: 0, min: 0, max: 10, x: 700, y: 700 }),
      makeToken({ id: 'pawn', image: 'pawn.png', x: 50, y: 50 }),
    ],
    zones: [
      {
        id: 'zoneA',
        kind: 'hand',
        x: 1000,
        y: 1000,
        w: 300,
        h: 200,
        owner: A,
        visibleTo: 'owner',
      },
    ],
  });
}

/** Recursively freezes a value so tests catch accidental mutations. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Every string anywhere inside a JSON value. */
export function allStrings(value: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        out.add(k);
        walk(x);
      }
    }
  };
  walk(JSON.parse(JSON.stringify(value)));
  return out;
}
