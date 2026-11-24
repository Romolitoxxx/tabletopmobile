import type { RulesProvider } from './types';

/** No rules: every structurally valid action is accepted. */
export const SandboxRules: RulesProvider = {
  id: 'sandbox',
  level: 'sandbox',
  setup: (state) => state,
  validate: () => ({ ok: true }),
  onAction: () => [],
  legalMoves: () => null,
  publicData: () => null,
  score: () => null,
  isGameOver: () => null,
};
