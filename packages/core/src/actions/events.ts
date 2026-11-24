import type { ComponentId, PlayerId } from '../model/types';

export type EventParam = string | number | boolean | null | number[];

/**
 * Something that happened, for the action log and animations. Events carry
 * only public information; component ids are rewritten per viewer.
 */
export interface GameEvent {
  /** Also the i18n key suffix (`event.<type>`). */
  type: string;
  actor: PlayerId;
  componentIds: (ComponentId | null)[];
  params: Record<string, EventParam>;
}

export function event(
  type: string,
  actor: PlayerId,
  componentIds: ComponentId[] = [],
  params: Record<string, EventParam> = {},
): GameEvent {
  return { type, actor, componentIds, params };
}
