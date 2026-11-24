# Incarico 003b — Correzioni emerse dalla revisione del protocollo revisioni

La revisione conferma la struttura di base: fingerprint dei byte, precondizioni save/rename, mutex di processo e rilevamento di modifiche a metadata uguali. I 46 test Go e i 56 frontend consegnati passano. NON resettare o riscrivere questa implementazione.

L'incarico 003 NON è approvato. Il revisore ha aggiunto:
- `tests/frontend/review-revision-protocol.test.cjs`: 9 test, tutti attualmente falliti (8 su produzione/protocollo e uno sulla fedeltà della fixture per file vuoto).
- `disk_revision_review_test.go`: 1 test di snapshot init fallito sul listener reale.

Mantieni questi test, senza ridurre le asserzioni.

## 1. Ricontrollo sessione dopo il JSON dei conflitti — BLOCCANTE

In performSave e nel primo ramo 409 di performRename il controllo sameDocument precede `await res.json()`, ma manca il controllo subito dopo.

Riproduzioni:
- Save 409 con json() differita -> Nuovo -> digitazione -> consegna revision_mismatch: appare una conferma della vecchia sessione e viene modificato lo status del nuovo documento.
- Rename 409 con json() differita -> Nuovo -> consegna target_exists: compare la conferma e viene inviato un SECONDO POST con overwrite:true per la vecchia sessione. Il finto backend reale del test può sovrascrivere la destinazione e rimuovere il sorgente.

Dopo ogni await che legge/parsa una risposta documento, verifica di nuovo il contesto PRIMA di status, flag, conferme o richieste successive. Verifica anche il punto immediatamente prima dell'invio del retry. Non annullare o alterare lo stato della nuova sessione. Conserva le garanzie 001/001b/001c anche con parsing JSON lento, non solo con fetch lento.

## 2. Successo HTTP non equivale a conferma valida del protocollo — ALTA

Attualmente performSave/performRename chiamano confirmPersisted prima di verificare la revisione. HTTP 200 con revision assente o `not-a-revision` disarma beforeunload e può adottare path/revisione non attendibili.

Valida la risposta di successo PRIMA di renderla persistita: JSON valido, successo secondo schema e revisione valida nel formato del protocollo stringa. Non fare conversioni numeriche; un helper condiviso può validare il formato, senza introdurre dipendenze runtime. Un 200 non-JSON, campi incoerenti, success:false o revisione assente/invalida sono errori protocollo, non salvataggi confermati.

Mantieni buffer dirty/testo intatto e status esplicito; nessuna adozione di path/baseline non attendibili, follow-up automatico o force implicito. Una scrittura può essere già avvenuta sul server anche se la risposta è invalida: documenta il caso senza promettere rollback e senza ritentare alla cieca.

## 3. Force soltanto per un conflitto riconosciuto — ALTA

Il save tratta un 409 non-JSON o con conflict sconosciuto come revision_mismatch e offre la sovrascrittura. Questo è un fallback permissivo, non il protocollo strutturato richiesto.

- Solo il conflitto riconosciuto `revision_mismatch` può proporre il normale overwrite.
- `file_missing` resta distinto e non propone force.
- Errori JSON/schema e codici sconosciuti lasciano dirty, errore protocollo e nessun retry/conferma.
- Conserva il limite di un retry esplicito e il consenso one-shot.
- Stessa distinzione nel rename: solo target_exists autorizza il relativo retry, source_changed/source_missing sono errori sorgente, codici ignoti/malformati sono errori protocollo.

Il vecchio test `REVIEW: conflict retry must be bounded to one retry` in review-regressions usa ancora textResponse('conflict',409). Migralo a conflitti JSON validi per continuare a verificare il limite retry; NON usarlo per giustificare un fallback legacy. Le nuove asserzioni per 409 malformati devono restare verdi senza conferme.

## 4. Non nascondere un errore di snapshot init come file vuoto — ALTA

/api/init ignora gli errori di readDiskSnapshot e restituisce 200 con active_file valorizzato, file_content vuoto e file_revision vuota. Il controller lo adotta come documento aperto e pulito. La testata del nuovo protocollo promette uno snapshot valido: un errore di lettura non è un file vuoto.

Il test Go riproduce una sostituzione esterna file -> directory allo stesso path prima di init, per generare un errore stabile e deterministico senza dipendere dai privilegi Unix. Restituisci un errore strutturato 503 `snapshot_unstable`, coerente con /api/file, anziché fingere successo. Non nascondere neanche gli altri errori di lettura: puoi distinguere ulteriormente i codici, ma il test richiede un errore esplicito per questo caso.

Aggiorna il boot frontend per mostrare il fallimento senza dichiarare aperto/pulito il file attivo e senza sostituire digitazione avvenuta durante l'attesa. Anche un init 200 con active_file ma revisione invalida/mancante non deve essere adottato come snapshot valido. Mantieni distinti il file realmente vuoto (fingerprint valido dei byte vuoti) e il fallimento della lettura. Documenta la policy per file attivo non esistente all'avvio, senza introdurre ricreazione automatica di un documento noto eliminato.

## 5. Fixture init per file vuoto — INFRASTRUTTURA TEST

L'harness genera `file_revision: content ? revOf(content) : ""`: un file esistente vuoto riceve baseline assente, mentre il backend Go correttamente restituisce l'hash dei byte vuoti.

Correggi il fake sulla presenza del file/snapshot, non sulla truthiness del contenuto. Il nuovo test apre un file esistente vuoto, digita e salva: oggi riceve 428 dalla stessa fixture perché il boot era errato. Deve salvare senza force con la revisione corretta. Non aggirare l'errore consentendo baseline vuote in produzione.

## Verifiche e consegna

- Tutti i 56 scenari frontend precedenti (migrando soltanto le fixture legacy necessarie) più i 9 nuovi verdi.
- Aggiungi casi su 200 non-JSON/success:false, init fallito con digitazione in volo, conflitto rename sconosciuto, e retry con corpo JSON ritardato dopo cambio sessione.
- Tutti i 46 test Go precedenti più il test init del revisore verdi con race detector; vet, sintassi JS/CJS, diff check ed esclusione asset dev dopo npm ci.
- Documenta modifiche schema/gestione errori e limiti; non modificare le REVIEW storiche.
- Nessun cambiamento a fingerprint/semantica di locking già verificati se non necessario, Host/Origin, read-only, significato Save As vs rename, nuove funzionalità o packaging.
- Nessun commit/push, versione/binario/release. Lascia le modifiche per la revisione indipendente e non procedere al prossimo incarico.
