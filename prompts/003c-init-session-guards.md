# Incarico 003c — Isolare i risultati tardivi del boot dal documento adottato

Le correzioni richieste in 003b sono state verificate: 48 test Go verdi con race detector/shuffle, vet pulito, 75 frontend verdi, inclusi tutti i test indipendenti precedenti. Conserva fingerprint, locking, validatori, guardie save/rename e gestione file vuoti/mancanti. Non resettare o riscrivere l'implementazione.

Resta UNA causa nell'initApp, riprodotta in cinque varianti: gli effetti documentali dei rami init non valido/503/catch non sono protetti dal contesto del boot.

## Riproduzione

1. /api/init resta in attesa.
2. L'utente crea un nuovo documento, scrive e lo salva con nome `/docs/new.md`. Il server conferma percorso e revisione, la UI mostra «Salvato».
3. Completa la vecchia init:
   - 200 con active_file e revisione invalida;
   - 200 con file_exists:false;
   - 503;
   - errore di rete.

Risultato attuale:
- primi due casi: currentPath e diskRevision vengono azzerati; titolo/percorso diventano Senza titolo pur avendo appena adottato un file reale;
- 503/catch: lo status del documento nuovo viene sostituito dall'errore della richiesta iniziale abbandonata.

Quinta variante: salva con nome il buffer iniziale SENZA premere Nuovo. La sessione numerica non cambia, ma percorso/baseline e generazione delle scritture sì. Anche qui una init invalida tardiva cancella percorso/baseline: il solo confronto docSession non basta.

## Test indipendenti

`tests/frontend/review-init-session.test.cjs`: cinque casi, attualmente 0/5 passati. Usano controller reale ed eventi DOM, senza hook in produzione. Dopo il risultato init verificano anche il salvataggio successivo sul percorso giusto con revisione confermata e force:false.

Non rimuovere/indebolire le asserzioni. Tutti i 75 scenari precedenti devono restare verdi.

## Correzione richiesta

- Definisci esplicitamente quando una risposta init appartiene ancora al contesto documentale di avvio. Proteggi ogni effetto su testo, percorso, baseline, titolo, dirty/status e workspace corrente, in TUTTI i rami: successo valido, snapshot invalido/mancante, errore HTTP e catch.
- Considera sia il cambio sessione sia adozione percorso/baseline e scritture nel frattempo (writeEpoch o garanzia equivalente). Non limitarti al confronto del percorso o della sessione da soli.
- Il caso «solo digitazione durante boot, senza adozione di un altro documento» resta supportato: conserva il testo/dirty e segnala l'errore init come nei test esistenti. Non risolvere saltando genericamente ogni errore dopo qualunque input.
- Non applicare un vecchio active_dir come workspace del documento appena adottato. Metadati globali innocui, come token/recents, possono essere trattati separatamente dagli effetti sul documento; documenta la distinzione.
- Un risultato tardivo non pertinente non cancella percorso/baseline confermati, non riscrive status, non altera timer o flag della sessione corrente e non avvia scritture.
- Conserva avvio normale, documento realmente vuoto, file mancante e init fallito senza interazioni, protezioni beforeunload e apertura/salvataggio legittimi.

## Confini e consegna

Intervento minimo nel controller e test pertinenti. Non cambiare protocollo Go, fingerprint, locking, Host/Origin, token, read-only, semantica rename o packaging. Le correzioni 003b non vanno annullate.

Esegui tutti i 75 frontend precedenti + i 5 nuovi (almeno 80 verdi), 48 Go con race detector/shuffle, vet, sintassi JS/CJS, diff check ed esclusione asset dev dopo npm ci. Riporta file e risultati effettivi.

Nessun commit/push, incremento versione, binario o release. Attendi la revisione prima del prossimo incarico.
