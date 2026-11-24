export type ErrorCode =
  | 'invalid_action'
  | 'unknown_player'
  | 'spectator'
  | 'system_only'
  | 'unknown_component'
  | 'wrong_type'
  | 'locked'
  | 'not_on_table'
  | 'not_in_hand'
  | 'empty_container'
  | 'not_your_turn'
  | 'unknown_prompt'
  | 'invalid_choice'
  | 'invalid_target'
  | 'rejected_by_rules'
  | 'cascade_limit'
  | 'undo_not_allowed'
  | 'nothing_to_undo';

/** A refused action. `code` doubles as the i18n key (`error.<code>`). */
export interface GameError {
  code: ErrorCode;
  message: string;
  params?: Record<string, string | number>;
}

export class ActionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
  }

  toGameError(): GameError {
    return this.params
      ? { code: this.code, message: this.message, params: this.params }
      : { code: this.code, message: this.message };
  }
}

export function fail(
  code: ErrorCode,
  message: string,
  params?: Record<string, string | number>,
): never {
  throw new ActionError(code, message, params);
}
