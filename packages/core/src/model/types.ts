import type { JsonValue } from '../util/json';

export type PlayerId = string;
export type ComponentId = string;
export type ZoneId = string;
/** Reference to an image asset inside a module (path or key). */
export type AssetRef = string;

/** Pseudo player used by the rules engine for automatic (consequent) actions. */
export const SYSTEM_PLAYER: PlayerId = '$system';

export type RulesLevel = 'sandbox' | 'assisted' | 'full';

/** Who can see the front of a component (relative to its `owner`). */
export type Visibility = 'everyone' | 'owner' | 'nobody' | { players: PlayerId[] };

export type Location =
  | { kind: 'table'; x: number; y: number; z: number }
  | { kind: 'container'; containerId: ComponentId }
  | { kind: 'hand'; playerId: PlayerId };

export interface ComponentBase {
  id: ComponentId;
  name: string | null;
  location: Location;
  /** Degrees, clockwise. */
  rotation: number;
  locked: boolean;
  owner: PlayerId | null;
  groupId: string | null;
  w: number;
  h: number;
  /** Coarse z-order bucket (e.g. 0 = boards, 1 = pieces); `location.z` orders within it. */
  layer: number;
  /**
   * Incremented each time the component becomes hidden, so the opaque id seen
   * by other players changes and the component cannot be tracked.
   */
  hideEpoch: number;
}

/** Card and tile share the same two-sided shape. */
export interface FlippableComponent<T extends 'card' | 'tile'> extends ComponentBase {
  type: T;
  front: AssetRef;
  back: AssetRef;
  faceUp: boolean;
  /** Who sees the front while it is face down (or in a hand). */
  visibility: Visibility;
}
export type CardComponent = FlippableComponent<'card'>;
export type TileComponent = FlippableComponent<'tile'>;

export interface DeckComponent extends ComponentBase {
  type: 'deck';
  /** Index 0 is the top of the deck. */
  contents: ComponentId[];
  /** A face-up deck shows its top card to everyone (e.g. a discard pile). */
  faceUp: boolean;
  /** Number of top cards each player is currently allowed to look at. */
  peeks: Record<PlayerId, number>;
}

export interface BagComponent extends ComponentBase {
  type: 'bag';
  image: AssetRef;
  contents: ComponentId[];
  /** An infinite bag draws copies of its contents instead of removing them. */
  infinite: boolean;
}

export interface TokenComponent extends ComponentBase {
  type: 'token';
  image: AssetRef;
}

export interface BoardComponent extends ComponentBase {
  type: 'board';
  image: AssetRef;
}

export interface CounterComponent extends ComponentBase {
  type: 'counter';
  value: number;
  min: number | null;
  max: number | null;
}

export type DieFace =
  { kind: 'number'; value: number } | { kind: 'image'; image: AssetRef; value: number | null };

export interface DieComponent extends ComponentBase {
  type: 'die';
  faces: DieFace[];
  faceIndex: number;
}

export type Component =
  | CardComponent
  | TileComponent
  | DeckComponent
  | BagComponent
  | TokenComponent
  | BoardComponent
  | CounterComponent
  | DieComponent;

export type ComponentType = Component['type'];
export type ContainerComponent = DeckComponent | BagComponent;
export type Flippable = CardComponent | TileComponent;

export interface Grid {
  kind: 'square' | 'hex';
  size: number;
  originX: number;
  originY: number;
  snap: boolean;
  /** Area where snapping applies (e.g. the board); null = the whole table. */
  bounds: { x: number; y: number; w: number; h: number } | null;
}

export interface Table {
  width: number;
  height: number;
  background: AssetRef | null;
  grid: Grid | null;
}

export type ZoneKind = 'hand' | 'hidden' | 'deal' | 'discard' | 'snap';

export interface Zone {
  id: ZoneId;
  kind: ZoneKind;
  x: number;
  y: number;
  w: number;
  h: number;
  owner: PlayerId | null;
  /** For `hand`/`hidden` zones: who sees the front of flippables inside. */
  visibleTo: Visibility;
}

export type PlayerRole = 'player' | 'spectator' | 'host';

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  seat: number | null;
  role: PlayerRole;
}

export interface TurnState {
  order: PlayerId[];
  current: PlayerId | null;
  number: number;
  phase: string | null;
}

/** Translatable text: an i18n key plus parameters. */
export interface LocalizedText {
  key: string;
  params: Record<string, string | number>;
}

export interface PromptOption {
  value: string;
  label: LocalizedText | null;
  componentId: ComponentId | null;
}

/** A choice the rules ask a player to make, rendered by a generic client UI. */
export interface Prompt {
  id: string;
  playerId: PlayerId;
  kind: 'chooseComponents' | 'chooseOption';
  message: LocalizedText;
  options: PromptOption[];
  min: number;
  max: number;
}

export interface GameState {
  schemaVersion: 1;
  moduleId: string;
  table: Table;
  players: Player[];
  components: Record<ComponentId, Component>;
  /** Ordered hand of each player. */
  hands: Record<PlayerId, ComponentId[]>;
  zones: Zone[];
  turn: TurnState;
  prompts: Prompt[];
  /** Free-form data owned by the rules provider (never sent to clients as is). */
  rulesData: JsonValue;
  nextId: number;
  nextZ: number;
  /** Host-only secrets; stripped from every view. */
  secret: { maskKey: string };
}
