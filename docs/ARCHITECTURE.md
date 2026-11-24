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

## Il core (`packages/core`)

| Cartella   | Contenuto                                                                               |
| ---------- | --------------------------------------------------------------------------------------- |
| `model/`   | Tipi (`GameState`, componenti, zone, giocatori), factory, griglia, regole di visibilità |
| `actions/` | Schema zod delle azioni, reducer puri (`applyResolved`), eventi, errori                 |
| `rules/`   | `RulesProvider`, `SandboxRules`, pipeline `applyAction`                                 |
| `view/`    | `getViewFor` (vista filtrata) ed `eventsFor` (eventi filtrati)                          |
| `rng/`     | RNG sfc32 con seed, stato serializzabile                                                |
| `log/`     | `GameSession`: log, undo, replay, salvataggio                                           |
| `host/`    | Interfaccia `GameHost` e `LocalHost`                                                    |

### Flusso di un'azione

```
client ──(azione non fidata)──► GameHost.submit
  GameSession.submit
    parseAction (zod)                    → invalid_action
    applyAction (pipeline):
      checkActor                          → spettatori, azioni riservate al sistema
      resolveRefs: id visti → id reali    → un componente nascosto si indica solo col suo id opaco
      rules.validate                      → rifiuto con messaggio
      resolveOutcome: l'host decide la casualità (mescolamento, dadi, sacchetto)
      applyResolved (puro)                → nuovo stato + eventi pubblici
      rules.onAction → azioni conseguenti (giocatore "$system"), stessa pipeline, max 200
    log += passi risolti
  per ogni giocatore: getViewFor + eventsFor ──► client
```

L'azione è atomica: se un passo fallisce non cambia nulla (nemmeno l'RNG).

### Visibilità

Ogni componente ha, per ogni osservatore, un'esposizione `full` (tutto), `back` (segnaposto con dorso e **id opaco**) o `none` (non elencato: dentro un mazzo/sacchetto o nella mano di un altro).

- Carte/tessere: `faceUp` (orientamento fisico) + `visibility` (chi vede il fronte quando è coperta: `owner` per le carte giocate coperte dalla propria mano).
- Zone `hand`/`hidden` sul tavolo coprono le carte all'interno per chi non è ammesso.
- Mazzi: solo conteggio e dorso in cima; la cima è visibile se il mazzo è scoperto; `peeks` dice quante carte in cima ogni giocatore sta guardando (guarda/cerca).
- **Id opachi**: `sha256(maskKey | id | hideEpoch)`. `hideEpoch` cresce quando un componente smette di essere pubblico o entra in mano/contenitore, così una carta mescolata non è più riconoscibile.
- Gli eventi contengono solo dati pubblici; gli id sono riscritti per osservatore.

### Casualità, log, undo

- L'RNG vive nella `GameSession`, fuori dal `GameState`. L'esito di ogni azione casuale è salvato nel log (`ResolvedAction.outcome`): il replay non usa l'RNG ed è esatto.
- Salvataggio = stato iniziale + log + stato dell'RNG. Il caricamento ricostruisce lo stato col replay.
- Undo: segna l'azione (e le sue conseguenze) come annullata e ricalcola dal log. L'RNG **non** torna indietro.
  - `free` (solo, passa-e-gioca): si annulla l'ultima azione.
  - `strict` (online): solo la propria ultima azione, se nessuno ha agito dopo, e **mai** azioni casuali o che hanno rivelato informazioni (pescare, guardare, girare, lanciare…), altrimenti l'undo permetterebbe di barare.

### Regole

`RulesProvider` (vedi `rules/types.ts`): `setup`, `validate`, `onAction`, `legalMoves`, `publicData`, `score`, `isGameOver`. Turni/fasi stanno in `state.turn` e si modificano con l'azione di sistema `turn.set`; le scelte si chiedono con `prompt.create` e si rispondono con `prompt.answer`. I dati privati delle regole (`state.rulesData`) non arrivano al client: solo ciò che espone `publicData`.

### Note e limiti noti

- L'RNG (sfc32) non è crittografico: va bene per un gioco, ma il seed non deve mai uscire dall'host.
- L'undo ricalcola dallo stato iniziale (O(n) azioni); se servirà, si aggiungeranno checkpoint.
- Nel livello `full` il rifiuto delle mosse illegali avviene in `validate`; `legalMoves` serve a UI e bot.

## Il client (`apps/client`)

| Cartella  | Contenuto                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app/`    | `GameController` (collega `GameHost`, tavolo, mano, pannelli), menu contestuale puro (`menu.ts`), testi del log (`format.ts`) |
| `render/` | Scena PixiJS (`table.ts`), camera pan/zoom, hit test, immagini segnaposto generate (`gen:`)                                   |
| `input/`  | `Gestures`: tap, pressione lunga, trascinamento, pan, pinch, rotella, tasto destro                                            |
| `ui/`     | DOM: mano a ventaglio, menu, dialoghi, lente, registro, avvisi                                                                |
| `i18n/`   | Dizionari `en` (definisce le chiavi) e `it`; un test verifica che coincidano                                                  |

- Il client conosce **solo** la `PlayerView` e gli eventi filtrati; ogni modifica passa da `GameHost.submit`. Offline il host è `LocalHost`.
- Il trascinamento è un'anteprima locale: al rilascio si invia l'azione (sposta, metti nel mazzo/sacchetto, prendi in mano); se è rifiutata, la vista torna quella dell'host.
- Gesti: tap su un dado = lancio, tap su una carta = lente, pressione lunga (o tasto destro) = menu, Maiusc/Ctrl+clic o "Seleziona" = selezione multipla.
- Prestazioni: un nodo PixiJS per componente, aggiornato solo se cambia (chiave di cache), texture generate una volta. `?stress=300` aggiunge 300 segnalini per misurare gli fps.

## Modulo demo (`packages/module-format/src/demo.ts`)

52 carte, 2 dadi, tabellone 8×8 con griglia (lo snap vale solo dentro il tabellone: `Grid.bounds`), 12 segnalini, un sacchetto infinito di monete, 2 contatori, una pila degli scarti. Le immagini sono riferimenti `gen:...` disegnati dal client.
