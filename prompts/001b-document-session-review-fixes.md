# Incarico 001b — Correzioni bloccanti emerse dalla revisione

L'incarico 001 NON è approvato. Prosegui dalle modifiche attuali, senza reset o riscritture generali. Leggi il capitolato 001, questo documento e i test indipendenti aggiunti in `web/tests/review-regressions.test.cjs`.

## Verifiche del revisore

- Suite consegnata: 30/30 passati.
- Go: 20 test passati con race detector; vet pulito; sintassi JS e diff check puliti.
- Cinque nuovi test indipendenti: **0/5 passati**.
- `go list -json .`, dopo npm ci: 1308 EmbedFiles, di cui 1293 sotto web/tests e 1286 sotto node_modules. Test/dipendenze incorporati: 13.564.948 byte (conteggio dei file, non incremento misurato del binario).

I test indipendenti sono parte della consegna: non rimuoverli o indebolirli. Puoi integrarli e rifattorizzarli conservando le stesse asserzioni.

## 1. Non eseguire scritture accodate di sessioni invalidate — BLOCCANTE

`enqueueWrite` conserva callback già accodate. `beginDocumentSession` azzera i flag ma non le invalida sul percorso di esecuzione; `performSave` e `performRename` inviano fetch prima di controllare se il contesto è ancora valido.

Riproduzioni:
- Save A bloccato -> apri B -> modifica B e Salva (accodato) -> Nuovo -> completa Save A. Parte comunque POST save B, benché il task non fosse ancora stato inviato e la sessione B sia stata abbandonata.
- Save A bloccato -> richiedi rinomina A -> Nuovo -> completa Save A. Parte comunque POST rename A, con possibile spostamento/cancellazione del sorgente.

Verifica la validità del task quando viene prelevato dalla coda, PRIMA di ogni effetto esterno. Invalida/cancella i task non iniziati della vecchia sessione, preservando serializzazione, coalescing e bookkeeping della nuova. Non presentare l'ignorare una risposta come annullamento di una richiesta ancora da inviare. Le richieste già inviate restano un caso distinto e documentato.

## 2. Consenso overwrite limitato a una singola richiesta — ALTA

Dopo 409 -> consenso -> retry con mod_time 0 -> errore 500, `state.currentModTime` rimane 0. Al successivo input, il nuovo autosave bypassa il controllo conflitti senza ulteriore consenso.

Questo NON richiede cambiare il protocollo Go: limita il bypass alla richiesta autorizzata (per esempio usando un'opzione locale), senza azzerare stabilmente la baseline della sessione. Preserva la baseline fino a una risposta di successo attendibile. Copri anche errore di rete e accodamento di nuove modifiche durante il retry.

## 3. Retry realmente limitato — MEDIA

La dichiarazione «retry una volta» non corrisponde al codice: il retry ripassa per performSave con explicit=true e un altro 409 provoca un'altra conferma e un terzo POST.

Traccia esplicitamente il tentativo di overwrite e imponi il limite. Un ulteriore conflitto/errore lascia dirty e status coerenti; nessun ciclo di conferme/retry. Test: due risposte 409 consecutive -> massimo due POST e una conferma per quel tentativo esplicito.

## 4. Validare la sessione anche dopo lettura del corpo errore — MEDIA

In performRename si controlla sameDocument PRIMA di `await res.text()`, ma non dopo. Se nel frattempo si crea un nuovo documento, compare comunque l'alert della vecchia rinomina.

Test indipendente: risposta rename 500, text() differita, Nuovo, risolvi text() -> nessun alert della sessione vecchia. Rivedi analoghi await, messaggi e finally nei flussi del documento. Non estendere questo punto a una riscrittura del file browser.

## 5. Escludere test e dipendenze dal bundle applicativo — ALTA

`main.go` contiene `//go:embed web` e serve il sottoalbero embedded con FileServer. La directory web/tests è quindi contenuto distribuibile, non soltanto sviluppo: include anche node_modules dopo npm ci, indipendentemente da .gitignore.

Sposta suite, manifest, lockfile e dipendenze sotto una directory NON incorporata, per esempio `tests/frontend/`. Aggiorna harness, percorsi e documentazione. Non spostare accidentalmente node_modules dentro altri asset pubblici. Non usare cancellazioni manuali pre-build come unica difesa.

Aggiungi una verifica riproducibile che, con dipendenze npm installate, EmbedFiles/embeddedWebFS non includa file di test, package manifest/lockfile o node_modules. Si può aggiungere un test Go mirato senza modificare la logica backend. Nessun cambiamento del protocollo mtime, dell'autenticazione o della semantica rename.

## Consegna richiesta

- Tutti i 30 test originali e i 5 test indipendenti verdi; aggiungi i casi indicati che mancano.
- `go test -race -count=1 ./...`, `go vet ./...`, controllo sintassi su OGNI JS, `git diff --check`.
- Prova di esclusione degli asset dev eseguita DOPO npm ci, non soltanto in checkout senza dipendenze.
- Aggiorna il comando unico dei test frontend nei documenti pertinenti senza alterare le REVIEW storiche. Il capitolato 001 può ricevere un aggiornamento mirato del percorso della suite; non cambiare retroattivamente i requisiti.
- Riporta file, comandi/esiti effettivi e limiti. Nessun commit/push, versione, binario o release.

Non procedere all'incarico successivo: attendi la nuova revisione.
