import { z } from 'zod';
import type { JsonValue } from '../util/json';

// Runtime schemas for actions: every action coming from a client (or from a
// script) is parsed with these before reaching the engine.

const id = z.string().min(1).max(128);
const ids = z.array(id).min(1).max(500);
const coord = z.number().finite().min(-1e6).max(1e6);
const count = z.int().min(1).max(1000);

const destination = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hand') }),
  z.object({ kind: z.literal('table'), x: coord, y: coord, faceUp: z.boolean() }),
]);
export type Destination = z.infer<typeof destination>;

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

const localizedText = z.object({
  key: z.string().min(1).max(200),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});

const promptSchema = z.object({
  id,
  playerId: id,
  kind: z.enum(['chooseComponents', 'chooseOption']),
  message: localizedText,
  options: z
    .array(
      z.object({
        value: z.string().max(128),
        label: localizedText.nullable(),
        componentId: id.nullable(),
      }),
    )
    .max(500),
  min: z.int().min(0),
  max: z.int().min(0),
});

export const ActionSchema = z.discriminatedUnion('type', [
  // Generic components
  z.object({
    type: z.literal('component.move'),
    targets: z
      .array(z.object({ id, x: coord, y: coord }))
      .min(1)
      .max(500),
  }),
  z.object({ type: z.literal('component.rotate'), ids, rotation: z.number().finite() }),
  z.object({ type: z.literal('component.flip'), ids }),
  z.object({ type: z.literal('component.lock'), ids, locked: z.boolean() }),
  z.object({ type: z.literal('group.create'), ids }),
  z.object({ type: z.literal('group.dissolve'), groupId: id }),
  // Decks
  z.object({ type: z.literal('deck.form'), ids }),
  z.object({ type: z.literal('deck.shuffle'), deckId: id }),
  z.object({ type: z.literal('deck.draw'), deckId: id, count }),
  z.object({
    type: z.literal('deck.deal'),
    deckId: id,
    count,
    playerIds: z.array(id).min(1).max(64).nullable(),
  }),
  z.object({ type: z.literal('deck.peek'), deckId: id, count }),
  z.object({ type: z.literal('deck.search'), deckId: id }),
  z.object({ type: z.literal('deck.endPeek'), deckId: id }),
  z.object({ type: z.literal('deck.takeTop'), deckId: id, to: destination }),
  z.object({ type: z.literal('deck.take'), deckId: id, cardId: id, to: destination }),
  z.object({
    type: z.literal('container.insert'),
    ids,
    containerId: id,
    position: z.enum(['top', 'bottom']),
  }),
  // Dice, bags, counters
  z.object({ type: z.literal('die.roll'), ids }),
  z.object({ type: z.literal('die.set'), id, faceIndex: z.int().min(0) }),
  z.object({ type: z.literal('bag.draw'), bagId: id, to: destination }),
  z.object({ type: z.literal('counter.add'), id, delta: z.number().finite() }),
  z.object({ type: z.literal('counter.set'), id, value: z.number().finite() }),
  // Hand
  z.object({ type: z.literal('hand.take'), ids }),
  z.object({ type: z.literal('hand.play'), id, x: coord, y: coord, faceUp: z.boolean() }),
  z.object({ type: z.literal('hand.pass'), ids, toPlayerId: id }),
  // Game
  z.object({ type: z.literal('turn.end') }),
  z.object({ type: z.literal('table.ping'), x: coord, y: coord }),
  z.object({ type: z.literal('game.undo') }),
  z.object({
    type: z.literal('prompt.answer'),
    promptId: id,
    choice: z.array(z.string().max(128)).max(500),
  }),
  // System only (rules engine)
  z.object({
    type: z.literal('turn.set'),
    order: z.array(id).nullable(),
    current: id.nullable(),
    phase: z.string().max(100).nullable(),
  }),
  z.object({ type: z.literal('prompt.create'), prompt: promptSchema }),
  z.object({ type: z.literal('rules.setData'), data: jsonValue }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

/** Actions only the rules engine may issue. */
export const SYSTEM_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set([
  'turn.set',
  'prompt.create',
  'rules.setData',
]);

/** Outcome of the randomness of an action, decided by the host and recorded in the log. */
export type Outcome =
  | { kind: 'shuffle'; order: string[] }
  | { kind: 'roll'; faceIndexes: number[] }
  | { kind: 'bagDraw'; index: number };

/** An action whose randomness has been resolved: replaying it is fully deterministic. */
export interface ResolvedAction {
  action: Action;
  outcome: Outcome | null;
}
