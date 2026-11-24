# Incarico 005b — Timer dopo copia non confermata e identità degli alias

La revisione ha confermato la separazione principale Save As/copia vs rinomina e ha rieseguito con successo i 67 Go e 103 frontend consegnati. L'incarico 005 NON è ancora approvato: sei regressioni indipendenti riproducono tre cause.

Lavora sul working tree corrente, preservando tutto il lavoro 001–005. Nessun reset, commit/push, incremento versione, binario o release.

## 1. Edit durante copia rifiutata -> autosave sull'originale — ALTA

Test indipendenti: `tests/frontend/review-save-as-copy.test.cjs` (4 casi, tutti falliti).

Sequenza:
1. Documento normale /docs/a.md, contenuto disco alpha; buffer alpha draft.
2. Salva con nome, submit copia: startRename annulla il vecchio debounce.
3. Si digita ancora mentre la richiesta è pendente: viene creato un NUOVO debounce per alpha draft more.
4. La copia riceve un errore/rifiuto prima che scatti il nuovo timer.
5. Il controller non adotta la destinazione e mostra errore, ma lascia il timer attivo.
6. Il timer manda /api/save a /docs/a.md: originale sovrascritto e beforeunload poi disarmato.

Riprodotto in quattro varianti: errore I/O 500; 409 copy_same_source; 403 destinazione protetta; 409 target_exists con consenso negato.

Quindi il rifiuto «non copiare sul sorgente» viene di fatto seguito da un save implicito sul sorgente. Non si tratta di un autosave già inviato prima dell'operazione: la richiesta parte DOPO il rifiuto, per un timer generato durante la copia.

Correggi il ciclo di vita del debounce e delle scritture coalesciate:
- Una copia non confermata non deve scaricare sul vecchio percorso gli edit maturati durante quella copia, né tramite timer né tramite saveQueued/follow-up.
- Copri i rami rifiuto, consenso negato, rete, risposta malformata e partial. Non limitarti al solo 500 del primo test.
- Mantieni buffer, dirty e beforeunload quando ci sono modifiche locali, percorso e baseline invariati; stato non transitorio. Nessun fallback silenzioso a save/rename.
- La pulizia appartiene al contesto ancora corrente: un errore tardivo di un vecchio documento NON deve cancellare il timer del nuovo documento o alterarne lo stato.
- Non disabilitare permanentemente l'autosave e non rendere read-only il sorgente per un errore della destinazione. Dopo la gestione dell'errore, un nuovo edit esplicito deve poter generare un nuovo autosave normale; un Ctrl+S esplicito deve continuare a funzionare sul documento corrente.
- Conserva il percorso positivo: gli edit durante copia riuscita devono andare soltanto alla copia confermata.

## 2. Errore nell'identità della DESTINAZIONE ignorato — MEDIA

Test: `save_as_copy_review_test.go`, TestReviewCopyUnverifiableDestinationIdentityFailsWithoutEffects.

Fixture reale: source.md regolare; loop.md è symlink a se stesso. os.Stat(loop.md) fallisce ELOOP.

copyDestinationAliasesSource propaga errori dello stat SORGENTE ma ignora quelli dello stat DESTINAZIONE. Anche resolveForCompare degrada gli errori a confronto lessicale. Risultato attuale: API 200, il symlink loop.md viene sostituito senza consenso e stato/recents passano alla destinazione.

Il contratto 005 richiede: identità non verificabile per errore operativo -> errore esplicito prima degli effetti, non supposizione «diversi».

- Propaga gli errori pertinenti di risoluzione/stat per entrambi i percorsi.
- Una destinazione realmente assente rimane lecita; non confondere ENOENT con ELOOP/EACCES/I/O.
- Nel caso riprodotto: 503 snapshot_unstable, symlink intatto, sorgente intatto, activePath/activeDir/recents invariati.
- La correzione riguarda il preflight della COPIA. Non riscrivere la policy generale di scrittura attraverso symlink del resto dell'app.

## 3. Sorgente symlink con target mancante non riconosciuto — MEDIA

Test: `save_as_copy_review_test.go`, TestReviewCopyCannotRecreateDanglingSourceAtItsTarget.

Fixture reale:
- source.md -> missing-target.md (link relativo, target attualmente assente);
- copia del buffer verso missing-target.md, anche con overwrite:true.

Risultato attuale: resolveForCompare non risolve il link dangling, os.Stat(source.md) restituisce ENOENT e la funzione conclude «diversi». La copia crea proprio il referente dell'originale, che torna così ad aprirsi sul testo copiato. Risposta 200, mentre è un alias del sorgente.

Richiesto: riconoscere il referente del link anche quando il file finale non esiste e rifiutare 409 copy_same_source prima degli effetti. Il target deve restare mancante e il link intatto; stato/recents invariati.

- Conserva la copia da un sorgente ordinario realmente mancante verso un percorso diverso: resta lecita.
- Gestisci link relativi/assoluti e catene con limite finito/cicli espliciti. Aggiungi casi per brevi catene dangling e directory symlink pertinenti, senza ricorsione illimitata.
- Se introduci un resolver più rigoroso, preferiscilo dedicato all'identità della copia: `resolveForCompare` è usato anche dal confinamento degli asset, che non va indebolito o riscritto incidentalmente.
- Verifica l'identità nel tratto serializzato con le altre scritture del processo. Questo non elimina il TOCTOU rispetto a processi esterni e non deve essere presentato come filesystem CAS.

## Test e consegna

Mantieni intatti i due test Go e i quattro frontend del revisore; aggiungi copertura dei rami di cleanup e ripartenza autosave descritti. Nessun debug hook produzione o weakening delle asserzioni.

Suite attuale della revisione:
- Go: 67 passati, 2 falliti, zero skip su questo host non privilegiato.
- Frontend: 103 passati, 4 falliti.
- Vet, sintassi, diff check ed esclusione asset dev puliti.

Riesegui Go race/shuffle/vet, frontend dopo npm ci, sintassi JS/CJS, diff check ed embed dopo installazione dipendenze. Aggiorna audit e README per i limiti effettivi, senza dichiarare infallibilità dell'identità in presenza di mutazioni esterne.

Nessun intervento su task Markdown/fence/outline, shortcut non pertinenti, cookie o packaging. Riporta comandi/esiti e attendi nuova revisione; non procedere all'incarico successivo.
