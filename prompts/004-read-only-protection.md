# Incarico 004 — Protezione dei documenti in sola lettura

Gli incarichi 001, 002 e 003, comprese le correzioni, sono approvati nel perimetro verificato. Parti dal working tree attuale senza reset. Leggi AUDIT-IMPLEMENTATION.md e codice/test reali. Baseline: 48 test Go e 82 frontend verdi.

## Difetto già riprodotto

Un file POSIX 0444 in una directory scrivibile viene restituito con read_only:false e /api/save può sostituirlo tramite temp+rename. Il processo non apre il file originale per scriverci: il salvataggio atomico aggira quindi l'intenzione di sola lettura. Lo stesso rischio esiste per rename e per overwrite della destinazione. Un controllo solo UI non basta.

## Obiettivo

Policy backend esplicita che impedisca scritture/rimozioni non autorizzate e modalità UI di sola lettura. Deve restare possibile salvare una COPIA esplicita su una destinazione scrivibile senza rimuovere il sorgente protetto. Non convertire tutto il Save As in una nuova semantica: il riordino generale copia/rinomina è un incarico successivo.

## 1. Policy backend e metadati

- Definisci un helper condiviso per la policy di protezione/scrivibilità e documenta esattamente cosa garantisce. Non usare il successo del rename come prova che il file originale fosse scrivibile.
- Su POSIX, un file esistente con nessun bit di scrittura (mode & 0222 == 0) è protetto per scelta applicativa ANCHE se il processo privilegiato potrebbe sostituirlo. Rileva anche gli errori effettivi di accesso del processo quando possibile, senza scrivere/troncare il documento per fare una prova.
- Considera che il salvataggio atomico richiede anche i permessi della directory. Non inventare un controllo ACL/Windows completo basato solo su mode.Perm(): per gli aspetti non determinabili in modo portabile, metadato consultivo e gestione sicura dell'errore al momento della scrittura, con limiti espliciti. Nessun chmod o ripristino permessi per aggirare il rifiuto.
- Nessuna operazione di prova deve modificare contenuto, permessi, mtime o proprietario del documento. Non introdurre troncamenti o scritture in-place al posto di atomicWrite.
- /api/init, /api/file e /api/stat espongono read_only coerente con la policy (e opzionalmente un motivo strutturato). Un file vuoto protetto è comunque una snapshot valida. read_only non entra nella fingerprint di contenuto.
- /api/stat rileva cambi di protezione anche quando contenuto/revisione sono identici. Assenza del file ed errore di lettura restano distinti dalla sola lettura.

## 2. Enforcement delle operazioni

- Dentro la sequenza di verifica/scrittura coordinata da diskWriteMu, /api/save rifiuta il file protetto prima di creare/sostituire qualcosa. force:true scavalca un conflitto di contenuto, NON la protezione read-only.
- /api/rename rifiuta un sorgente protetto prima di creare cartelle/destinazione o rimuovere il sorgente; vale anche per old_path == new_path. overwrite:true non scavalca la protezione.
- Una destinazione esistente protetta non può essere sostituita da rename o creazione di una copia, neanche con overwrite:true e sorgente vuoto. Conflitto destinazione e rifiuto read-only sono casi diversi: niente conferma che promette di aggirare i permessi.
- Rifiuti con errore JSON distinguibile, per esempio 403 read_only / write_forbidden con indicazione sorgente/destinazione. Nessuna mutazione di file, activePath/activeDir/recents nei casi negati prima della scrittura.
- Se i permessi cambiano dopo il preflight, tratta l'errore operativo senza dichiarare successo, senza retry forzato, senza pulire il buffer. Non promettere di eliminare il TOCTOU esterno.
- Conserva tutte le precondizioni di revisione del 003; nessuna baseline vuota o auto-acquisita dal disco per eludere conflitti.

## 3. UI sola lettura e cambiamenti durante l'editing

- Un documento protetto è leggibile, selezionabile e copiabile, con indicatore chiaro e distinto da «Salvato». Imposta l'editor readOnly e impedisci anche le modifiche PROGRAMMATICHE: toolbar, scorciatoie di formattazione, inserimento tabelle e task checkbox in preview. Bloccare solo la digitazione nativa non basta.
- Autosave sospeso senza dialoghi e senza scritture mentre read-only. Non inventare percorsi alternativi.
- Se un documento diventa protetto durante l'editing, conserva buffer, revisioni e dirty/beforeunload, invalida l'autosave non inviato e non perdere alcuna modifica. Le risposte read_only devono avere le stesse guardie sessione/writeEpoch già approvate.
- Se torna scrivibile, riabilita l'editing; non avviare una scrittura soltanto per il cambio di permessi. Il successivo input/salvataggio esplicito segue il protocollo normale e la baseline già confermata.
- New e apertura di un altro file ripristinano correttamente la modalità: un vecchio risultato non può bloccare/sbloccare il documento nuovo. La semantica di un salvataggio già inviato e poi negato resta dirty.
- Se il backend nega una scrittura perché la protezione è cambiata dopo l'ultimo poll, aggiorna UI/status senza trasformare il rifiuto in conflitto da forzare e senza perdere il testo.

## 4. Salvataggio di una copia sicura

- Per un documento protetto, offri esplicitamente «Salva una copia…» (anche come esito del salvataggio manuale); un autosave non apre questo dialogo.
- Il flusso può riusare il browser file e l'attuale creazione /api/rename con old_path vuoto, purché la UI chiarisca che NON è una rinomina: il sorgente non viene mai cancellato/modificato.
- Nuova destinazione scrivibile -> salva copia, adotta percorso/revisione della copia soltanto alla conferma valida, riabilita editing. Sostituzione destinazione scrivibile richiede la conferma esistente; destinazione protetta resta rifiutata.
- Conserva i dati modificati prima del cambio di protezione, i controlli su risposte tarde, duplicati, scritture accodate e digitazione durante richieste. Un semplice cambio di etichetta con old_path ancora valorizzato è inaccettabile.
- Non cambiare il comportamento Save As/rinomina dei documenti normali in questo incarico. Documenta questa distinzione transitoria.

## Test obbligatori

Go sullo stack reale, fixture isolate e niente browser/HOME reali:
- file 0444 leggibile in directory scrivibile: metadata read_only veri; save negato anche force:true, bytes/mode/mtime/stato invariati;
- rename di sorgente protetto negato anche stesso path/overwrite, destinazione e relative cartelle non create;
- destinazione protetta negata con overwrite:true e old_path vuoto; sorgente protetto copiato in nuova destinazione senza rimozione tramite il flusso copia;
- file 0644 scrivibile normale continua a funzionare, compreso preservare mode 0640;
- cambio permessi a contenuto invariato rilevato da stat; errore permessi dopo lettura iniziale non dichiarato successo;
- non aggirare test usando chmod per rendere il documento scrivibile o eseguendo la scrittura prima del controllo. Se OS/privilegi rendono un caso non testabile, dichiara skip mirato e non spacciare un test di mode POSIX per verifica ACL/Windows.

Frontend sul controller reale:
- init/apertura read-only e riapertura normale; New reset; vecchio stat read-only dopo cambio documento ignorato;
- zero autosave e zero modifiche da formattazione/tabelle/task su documento protetto;
- dirty -> readonly con autosave pendente: testo e beforeunload conservati, niente scrittura; ritorno scrivibile non salva da solo;
- rifiuto backend read-only in volo: nessun force, dirty protetto;
- Salva copia: old_path vuoto, sorgente intatto, nuovo percorso/revisione solo a risposta valida; destinazione protetta e risposte tarde non alterano documento corrente.

Mantieni tutti gli 82 scenari frontend e le verifiche Go approvate. Puoi estendere fixture con read_only, non eliminare asserzioni o scenari.

## Confini e consegna

Non introdurre readonly manuale indipendente dai permessi, nuove librerie runtime o dipendenze native senza motivazione da sottoporre prima al revisore. Nessuna modifica a Host/Origin, token/cookie/nonce, fingerprint, symlink policy, owner/ACL/xattr preservation, nuove funzionalità Markdown o packaging. Non promettere preservazione completa dei metadati. Non alterare le REVIEW storiche.

Esegui Go race/shuffle e vet, frontend dopo npm ci, sintassi di ogni JS/CJS, diff check ed esclusione asset dev. Riporta policy precisa, schema API, gestione UX, risultati reali e limiti multipiattaforma/TOCTOU. Nessun commit/push, versione/binario/release. Attendi la revisione indipendente.
