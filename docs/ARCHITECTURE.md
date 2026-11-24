# Architettura

## Pacchetti

```
apps/client ─┐
             ├─► packages/core ◄── packages/module-format (tipi modulo)
apps/server ─┘
```

Il **core** è puro e deterministico: riceve stato + azione e restituisce un nuovo stato. Client e server lo usano entrambi.

## Principi

1. **Stato serializzabile + azioni.** Lo stato è un documento JSON; cambia solo tramite azioni tipizzate validate dal core. Il log delle azioni consente undo, replay e salvataggi.
2. **Autorità unica.** Un host applica le azioni: `LocalHost` offline, il server online. Il client usa la stessa interfaccia `GameHost`.
3. **Informazione nascosta filtrata alla fonte.** `getViewFor(state, playerId)` produce la vista per un giocatore; ciò che non può vedere non viene mai inviato.
4. **Casualità decisa dall'host** tramite RNG con seed, segreto finché la partita è in corso.
5. **Core deterministico e testato.**
6. **Pipeline delle regole** `validate → apply → after` con un `RulesProvider` (per ora `SandboxRules`).

## Decisioni

- **Colyseus senza sincronizzazione Schema**: il server invia a ciascun client la sua vista JSON filtrata come messaggio. Colyseus serve per stanze, lobby, riconnessione.
- **Persistenza locale**: IndexedDB per partite e moduli; Capacitor Preferences solo per le impostazioni.
- **ID opachi nelle viste**: i componenti nascosti ricevono id diversi per vista, così una carta non è tracciabile mentre è coperta.
- **Pacchetti interni senza build**: esportano i sorgenti TS; Vite (client) e tsx/bundler (server) li compilano.
