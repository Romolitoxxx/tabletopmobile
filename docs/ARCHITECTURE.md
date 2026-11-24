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
| `net/`     | Protocollo online (messaggi + schemi zod) e `RemoteHost` (indipendente dal trasporto)   |

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
- Prestazioni: un nodo PixiJS per componente, aggiornato solo se cambia (chiave di cache), texture generate una volta. il gioco "Test prestazioni" (`stressModule`) aggiunge 300 segnalini e mostra un contatore FPS.

## Modulo demo (`packages/module-format/src/demo.ts`)

52 carte, 2 dadi, tabellone 8×8 con griglia (lo snap vale solo dentro il tabellone: `Grid.bounds`), 12 segnalini, un sacchetto infinito di monete, 2 contatori, una pila degli scarti. Le immagini sono riferimenti `gen:...` disegnati dal client.

## Salvataggi e passa-e-gioca (M4)

- **`GameRecord`** (`apps/client/src/app/game.ts`): nome, modalità (`solo` / `hotseat`), giocatore che ha il dispositivo, date, e il `SavedGame` del core (stato iniziale + log + RNG). Ricaricare = replay del log: la partita torna identica, compresa la casualità futura.
- **`SaveStore`** (`storage/saves.ts`): `IndexedDbSaveStore` nel browser e nella WebView di Capacitor; `MemorySaveStore` per test e come ripiego. Le impostazioni (lingua) restano in `localStorage`; in M5 passeranno a Capacitor Preferences.
- **Salvataggio automatico** 400 ms dopo ogni modifica, e subito quando l'app va in background o si chiude (`visibilitychange`, `pagehide`).
- **Esporta/Importa**: file JSON; all'importazione il file viene validato (zod + replay del log) e riceve un nuovo id, quindi non sovrascrive mai una partita esistente.
- **Passa-e-gioca** (2–6 giocatori, undo `strict`): quando il turno passa a un altro giocatore compare una schermata opaca "Passa il dispositivo a X". La vista del nuovo giocatore viene richiesta e disegnata **solo dopo** la conferma; la mano del precedente viene tolta dalla pagina prima. "Cambia giocatore" permette di passare il dispositivo fuori turno (sandbox).
- Limite noto: in locale il salvataggio contiene anche le informazioni segrete (seed, carte coperte). È inevitabile per giocare offline sullo stesso dispositivo; online (M6) i segreti restano sul server.

## App native (M5)

- **Capacitor 8** con i progetti nativi in `apps/client/android` (Gradle) e `apps/client/ios` (Xcode, Swift Package Manager: niente CocoaPods). Sono versionati; la copia della web app (`assets/public`, `App/public`) no: la genera `cap sync`.
- **Codice unico**: tutto ciò che cambia tra browser, Android e iOS sta in `apps/client/src/platform/platform.ts`:
  - impostazioni con Capacitor Preferences (su web usa `localStorage`);
  - esportazione delle partite: foglio di condivisione nativo (Filesystem + Share) su Android/iOS, download nel browser;
  - tasto/gesto Indietro di Android: chiude il popup in primo piano, altrimenti torna al menu (la schermata di passaggio del dispositivo lo ignora). Nel browser lo stesso comportamento è sul tasto Esc. Il tasto è intercettato in `MainActivity.java`, che lo inoltra alla pagina come evento `tabletopback` su `document` (l'ascoltatore del plugin App non riceveva l'evento su Samsung S24); l'"Indietro predittivo" è disattivato nel manifest. Se la pagina non lo gestisce, l'app viene minimizzata (mai chiusa);
  - pausa dell'app: salvataggio immediato.
- **Bordo a bordo**: `viewport-fit=cover`; Android riceve gli spazi delle barre di sistema come variabili CSS `--safe-area-inset-*` (plugin SystemBars, modalità `css`), iOS come `env(safe-area-inset-*)`. Lo stile usa entrambe.
- **Icona e splash**: generate da `apps/client/assets/generate-icons.py` (Pillow) per entrambe le piattaforme.
- **Firma di debug**: `android/app/debug.keystore` è una chiave di debug _non segreta_ (password `android`) versionata di proposito, così ogni APK di debug si installa sopra il precedente senza perdere le partite. Per il Play Store servirà una chiave di rilascio separata, **mai** nel repository.
- **CI**:
  - `android.yml`: a ogni push compila l'APK di debug e lo pubblica come artefatto `tabletop-mobile-debug-apk`; il `versionCode` è il numero della build.
  - `ios.yml`: sulle PR (o a mano) compila l'app iOS per il simulatore, senza firma, su un Mac di GitHub: verifica che iOS resti compilabile anche senza un Mac a disposizione.
- **iOS sul dispositivo**: richiede un Mac con Xcode (o un servizio di build cloud) e un account Apple Developer. Il codice e il progetto sono già pronti.

## Gioco online (M6)

```
client A ─┐ WebSocket (Colyseus)        ┌─ OnlineTable ── GameSession (autorità: stato, log, RNG)
client B ─┼──────────────────────────► TableRoom          └─ LocalHost.subscribe(p) → vista filtrata di p
client C ─┘ submit / start             └─ welcome · table · update · result
```

- **Server** (`apps/server`): `TableRoom` (adattatore Colyseus, `room.ts`) attorno a `OnlineTable` (`table.ts`), che non dipende dal trasporto ed è testata a parte. Il server riusa `LocalHost` del core: ogni client riceve **solo** `getViewFor`/`eventsFor` del proprio posto. Niente stato Schema di Colyseus.
- **Protocollo** (`packages/core/src/net/protocol.ts`): opzioni di creazione/ingresso e messaggio `submit` validati con zod lato server; `PROTOCOL_VERSION` rifiuta app di versione diversa con l'errore `protocol`. Messaggi del server: `welcome` (posto + token segreto), `table` (informazioni pubbliche del tavolo), `update` (vista + eventi filtrati), `result` (esito di un `submit`, abbinato per `seq`).
- **Tavolo**: codice di 5 caratteri senza ambiguità (niente 0/O, 1/I) che è anche l'id della stanza. Chi crea il tavolo è il primo posto e il solo che può iniziare. In sala d'attesa ci si siede con un nome (2–6 posti; si può iniziare anche da soli); all'inizio la partita viene creata con quei giocatori, undo `strict`, seed e chiave delle maschere generati sul server con `crypto`. A partita iniziata non entra nessun altro.
- **Riconnessione**, su due livelli:
  - caduta della connessione: l'SDK riprova da solo, il server tiene il posto per 60 s (`allowReconnection`) e alla ripresa rimanda la vista corrente;
  - rientro (app chiusa, connessione persa a lungo, tasto "Torna al tavolo"): ogni posto ha un **token segreto**, conservato sul dispositivo (Preferences, `tabletop.online.ticket`) e mai inviato agli altri. Con il token si torna allo stesso posto; una nuova connessione con lo stesso token sostituisce la precedente.
- Il tavolo resta aperto anche se tutti si disconnettono e viene chiuso dopo 30 minuti senza nessuno connesso. **Limite noto**: le partite online vivono in memoria nel processo del server; un riavvio le perde (la persistenza lato server verrà dopo).
- **Client** (`apps/client/src/net/online.ts`): `OnlineSession` apre la stanza con `@colyseus/sdk` e fornisce un `RemoteHost` al `GameController`, che non sa se la partita è locale o online (modalità `online`: niente passaggio del dispositivo, codice del tavolo nella barra, rosso mentre la connessione è assente). Mentre si è offline le azioni sono rifiutate subito con `error.offline`.
- **Indirizzo del server**: si scrive nel dialogo "Gioca online" (`192.168.1.5:2567` diventa `ws://192.168.1.5:2567`) e viene ricordato; il valore iniziale è `VITE_SERVER_URL` se definita al build, altrimenti l'host della pagina sulla porta 2567. Per provare in rete locale Android permette `ws://` (cleartext e contenuto misto) e iOS le connessioni locali (`NSAllowsLocalNetworking`); un server pubblico deve usare `wss://`.
- Limite dei messaggi in ingresso: 64 KB.
