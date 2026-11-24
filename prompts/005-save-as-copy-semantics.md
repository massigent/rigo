# Incarico 005 — Separare Salva con nome da Rinomina/Sposta

## Stato e obiettivo

001–004 approvati nel perimetro verificato. Baseline di test dopo revisione 004b: 62 Go e 93 frontend. Lavora sull'albero esistente senza reset, commit/push, variazioni versione, binari o release; preserva le revisioni storiche.

Difetto già registrato nell'audit: il normale «Salva con nome» usa /api/rename con old_path valorizzato e quindi elimina il sorgente. Il 004 ha introdotto una copia sicura soltanto per documenti protetti; ora occorre distinguere esplicitamente le intenzioni, non riscrivere il sistema documentale.

## Semantica richiesta

- **Salva**: salva il documento corrente con le precondizioni esistenti; se senza percorso, apre la scelta del primo percorso; se protetto, offre la copia come già previsto.
- **Salva con nome…**: scrive il testo corrente del buffer a un percorso diverso, preserva il sorgente e adotta la copia soltanto dopo conferma di scrittura valida. Il contenuto sorgente può differire dal buffer dirty: la copia usa il buffer, non una rilettura del file.
- **Salva una copia…** del documento protetto: stesso principio, conserva la dicitura esplicita e il documento originale; adozione della copia scrivibile soltanto dopo risposta valida.
- **Rinomina/Sposta…**: operazione esplicitamente distinta, resta soggetta a revisione sorgente, protezione read-only, consenso destinazione ed esiti parziali 004b. Il click sul titolo può rimanere questa operazione purché titolo del dialogo/pulsante/tooltip la descrivano senza ambiguità. Non aggiungere un secondo file browser.
- Dopo copia riuscita, gli edit successivi e gli edit fatti durante la richiesta vengono salvati sulla copia, mai spediti di nascosto al vecchio percorso.

L'autosave esistente può avere già scritto il sorgente prima dell'operazione; non promettere di annullare scritture già inviate. La copia non deve introdurre ulteriori scritture o rimozioni del sorgente. Serializza le richieste già in volo e cancella/coalesci gli autosave non ancora inviati nel contesto corretto, come negli incarichi precedenti.

## Backend e destinazione equivalente al sorgente

È possibile riusare il percorso creazione `old_path:""`, ma una copia deve avere un'intenzione e un contesto sorgente espliciti sufficienti a impedire di sovrascrivere proprio l'originale.

- Rifiuta la copia se la destinazione identifica il sorgente: stesso percorso pulito, equivalenze risolvibili attraverso symlink e identità di file esistente. Per hard link è accettabile il rifiuto conservativo come alias del sorgente, documentandolo.
- Il controllo deve essere anche backend, non soltanto confronto JS di stringhe. Per esempio, aggiungi al protocollo di copia un campo sorgente distinto da old_path, oppure un endpoint dedicato; scegli la soluzione minima e documentala. Non cambiare revisioni/hash né indebolire /api/save o /api/rename.
- Il contesto sorgente della copia serve a evitare alias, non autorizza alcuna sua modifica/rimozione e non richiede che il suo contenuto sia ancora uguale alla vecchia baseline. È lecito copiare il buffer mentre il file originale è cambiato o è scomparso: l'originale non deve essere toccato. Se l'identità non è verificabile per un errore operativo, fallisci in modo esplicito invece di assumere diversità.
- Stesso percorso come destinazione della copia: rifiuto chiaro «scegli un altro nome/percorso», nessun fallback silenzioso a save o rename. Rinomina same-path resta compatibile con i test precedenti.
- Destinazione diversa già esistente: consenso esplicito e one-shot, solo per target_exists riconosciuto; nessun force sul sorgente. Destinazione protetta rifiutata anche con overwrite:true.
- Conserva il guard Host/Origin globale e auth; nessuna mutazione di activePath/recents su rifiuto. Copia riuscita aggiorna stato/recents secondo le regole esistenti. Nessuna rimozione sorgente nel ramo copia.
- Non estendere questo incarico alla policy generale di salvataggio ATTRAVERSO symlink né alla preservazione completa ACL/owner/xattr: qui serve evitare alias tra sorgente e destinazione di una copia.

## Controller e UI

- Distingui chiaramente modalità e payload di copia/Save As e rinomina, senza dipendere solo dal testo del pulsante o dalla presenza di readOnly.
- Ctrl/Cmd+Shift+S deve aprire Salva con nome per un documento normale (non essere intercettato dal ramo Ctrl/Cmd+S). Ctrl/Cmd+S resta Salva. Preserva la copia per read-only; non estendere questa attività agli altri shortcut non pertinenti.
- Conserva docSession, writeEpoch, bufferRevision/savedRevision, guardie dopo parsing, coda scritture e adozione solo su risposta valida.
- Errore, conflitto, annullamento, risposta malformata o tardiva: non pulire il buffer, non adottare la destinazione, non spostare baseline, non inviare scritture al vecchio percorso tramite callback stale.
- Termina gli indicatori transitori anche sui percorsi di annullamento/errore rete pertinenti al flusso modificato. In 004b il partial 403 ha un messaggio dedicato; il partial 500 resta un errore con dettagli JSON contenenti l'esito. Nel riordinare questi rami, riconosci partial indipendentemente dallo status e conserva l'informazione «destinazione scritta, sorgente non rimosso» in un messaggio leggibile, senza rollback o retry automatico.
- Non introdurre un'opzione «copia senza adozione» o una seconda preferenza di autosave: sono funzionalità diverse.

## Test richiesti

Estendi backend reale e controller reale/harness, senza debug hook produzione:

1. Salva con nome normale dirty: nuovo file contiene buffer, vecchio file conservato, nuovo percorso adottato e baseline valida. Salvataggio successivo scrive solo la copia.
2. Rinomina esplicita: sorgente rimosso soltanto in caso di successo completo; precondizioni e partial conservati.
3. Copia protetta conservata; nessuna richiesta autosave/dialogo automatico sul sorgente protetto.
4. Destinazione esistente: annulla e conferma; nessuna rimozione del sorgente in entrambi i casi; destinatario read-only non sovrascritto.
5. Copia sullo stesso percorso, percorso con segmenti equivalenti e symlink/hard link disponibili: rifiuto prima degli effetti, sorgente e stato invariati. Skip mirati dove non supportato.
6. Buffer diverso dal sorgente; sorgente esternamente cambiato/mancante: nuova copia preserva il buffer e non altera il sorgente.
7. Save in volo, poi copia; edit durante copia; copia in coda poi Nuovo/apertura; corpo risposta tardivo dopo cambio documento; successi malformati. Conserva le proprietà asincrone degli incarichi 001–003.
8. Shortcut Ctrl/Cmd+Shift+S vs Ctrl/Cmd+S; titoli/pulsanti distinguono Salva con nome e Rinomina/Sposta.
9. Partial 403 e 500: messaggio leggibile, niente adozione, dirty preservato quando già dirty, nessun retry/rollback.

Mantieni gli scenari e le asserzioni di sicurezza dei 62 Go/93 frontend. È legittimo migrare aspettative che codificavano l'errata cancellazione del sorgente in Salva con nome, ma indica esattamente quali e perché; non eliminare la copertura della rinomina esplicita, ora distinta.

## Consegna

Aggiorna README IT/EN e audit con semantica e limiti effettivi. Esegui Go race/shuffle/vet, frontend dopo npm ci, sintassi JS/CJS, diff check ed esclusione asset dev dopo installazione. Compilazione incrociata non equivale a esecuzione nativa.

Nessun intervento su parser Markdown/task/outline, funzionalità offline, packaging, cookie o altre voci dell'audit. Riporta modifiche, comandi/esiti e limiti; attendi revisione indipendente prima del prossimo incarico.
