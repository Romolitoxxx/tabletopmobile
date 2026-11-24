# CLAUDE.md — Tabletop Mobile

App mobile (Android/iOS via Capacitor) per giochi da tavolo 2D in stile sandbox, con regole opzionali via script.
Architettura: vedi `docs/ARCHITECTURE.md`.

## Struttura

- `packages/core` — motore di gioco puro (stato JSON + azioni). **Nessuna dipendenza da UI, rete o piattaforma** (imposto da ESLint). Unica dipendenza: zod.
  - Ogni modifica passa da `applyAction` (pipeline regole) → `applyResolved` (reducer puro). Nuova azione = schema in `actions/schema.ts` + handler in `actions/apply.ts` + `resolveRefs` in `rules/pipeline.ts` + test.
  - Ciò che arriva al client passa solo da `getViewFor`/`eventsFor`: ogni nuova informazione nascosta richiede un test di non-fuga (vedi `view/visibility.test.ts`).
- `packages/module-format` — tipi e validazione zod del formato modulo, `ModuleLoader`.
- `apps/client` — PixiJS + Vite + Capacitor. Gira anche nel browser. Testi solo tramite `i18n` (chiavi in `i18n/en.ts`, traduzione obbligatoria in `i18n/it.ts`).
- `apps/server` — Colyseus (Node), riusa `packages/core`.

## Comandi

- `pnpm install` — installa le dipendenze (Node ≥ 22, pnpm 10).
- `pnpm check` — tutto quello che fa la CI: format, lint, typecheck, test, build.
- `pnpm test` / `pnpm test:watch` — Vitest su tutti i pacchetti.
- `pnpm --filter @tabletop/core test` — test di un solo pacchetto (anche `pnpm vitest run --project core`).
- `pnpm lint`, `pnpm typecheck`, `pnpm format`.
- `pnpm --filter @tabletop/client dev` — client nel browser su http://localhost:5173 (`?stress=300` per il test di prestazioni).

## Convenzioni

- Codice, identificatori e commenti in **inglese**; documentazione e messaggi di commit in **italiano**.
- TypeScript `strict` (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Niente `any`.
- I pacchetti interni esportano direttamente i sorgenti `.ts` (`exports: ./src/index.ts`); import senza estensione.
- `import type` per gli import di soli tipi (`verbatimModuleSyntax`).
- Lo stato di gioco è JSON puro (niente classi, `Date`, `Map`, `undefined` significativi): deve sopravvivere a `JSON.parse(JSON.stringify(s))`.
- Le funzioni del core sono pure: mai mutare lo stato in ingresso, mai usare `Math.random()` o l'orologio. La casualità passa solo dall'RNG con seed nello stato.
- Ogni azione nuova richiede test, compresi quelli di visibilità quando tocca informazione nascosta.
- Una milestone = un branch (`mN-nome`) + PR verso `main`. Commit piccoli. Prima di chiudere: `pnpm check` verde.
- Aggiornare questo file e `docs/ARCHITECTURE.md` quando cambiano comandi o architettura.
