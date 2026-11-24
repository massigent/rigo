# Incarico 001 — Integrità dello stato asincrono del documento

Lavora nel repository TypeCraft. Implementa SOLO questo incarico; un revisore esterno controllerà codice, diff e test. Leggi `AUDIT-IMPLEMENTATION.md`, le due REVIEW e il codice effettivo. Non trattare i report come prova che tutto funzioni.

## Obiettivo

Impedire che timer e risposte HTTP appartenenti a un vecchio documento o a una vecchia versione del testo alterino il documento corrente, dichiarino salvate modifiche non persistite o provochino scritture sul percorso sbagliato.

## Bug già riprodotti

1. Apri A, modifica il testo, avvia Salva e ritarda la risposta. Digita altro testo, poi completa il primo salvataggio: attualmente compare «Salvato» e `beforeunload` non protegge il testo nuovo, benché non sia stato inviato.
2. Salva A con risposta ritardata, crea un nuovo documento e completa la risposta di A: `state.currentPath` torna di nascosto ad A. Digitando e salvando il nuovo documento si sovrascrive A, pur con titolo «Senza titolo.md».

Punti principali: `web/static/js/app.js`, in particolare state, input/autosave, saveFile, markSaved, openFile, newDocument, checkExternalChange, refreshModTime e fsConfirmAction.

## Requisiti

- Introduci un'identità/generazione della sessione documento e una revisione del buffer, oppure una soluzione equivalente chiaramente documentata. Il solo confronto del percorso non basta: riaprire lo stesso file deve invalidare le operazioni della vecchia sessione.
- Ogni operazione asincrona cattura prima dell'await contesto, percorso e, quando serve, revisione/contenuto. Prima di applicare una risposta verifica che sia ancora pertinente. Valido anche per messaggi di errore, conferme tardive e blocchi finally.
- La risposta a un salvataggio rende pulito SOLO il contenuto effettivamente confermato dal server. Se nel frattempo si è scritto, il buffer resta dirty, l'avviso di chiusura resta attivo e il testo più recente viene salvato successivamente senza sovrapposizioni incontrollate.
- Serializza/coalesci i salvataggi pertinenti della stessa sessione. Un booleano che salta semplicemente i salvataggi durante una richiesta può perdere l'ultima modifica: deve esistere una strategia esplicita per il lavoro pendente. Non creare retry infiniti su errori/conflitti.
- Al cambio documento invalida autosave e operazioni precedenti. Una risposta vecchia non può ripristinare path, mtime, titolo, preview baseDir, stato dirty o status del nuovo documento. AbortController può aiutare, ma abortire un fetch non garantisce che il server non abbia già scritto.
- Aperture concorrenti fuori ordine: l'ultima apertura accettata deve vincere. Anche una modifica digitata mentre un'apertura è in volo deve essere protetta: annulla l'applicazione o chiedi nuovamente conferma; non perderla silenziosamente. La cancellazione di una conferma non deve cambiare il documento corrente.
- Watchdog: non applicare stat/contenuto se sono cambiati sessione o revisione mentre le richieste erano in volo. Non sostituire testo locale, neanche se il documento ora è pulito per un altro salvataggio.
- Applica le stesse garanzie al flusso Salva con nome esistente: niente risposta tardiva che prende possesso di un'altra sessione, niente falso pulito se si è digitato durante la richiesta, niente vecchio autosave che ricrea il sorgente dopo una rinomina. Coordina queste scritture con quelle ordinarie e impedisci invii duplicati.
- Conserva l'autosave senza dialoghi e senza percorsi inventati, le conferme sui conflitti, la protezione beforeunload e l'apertura via SSE.

## Test obbligatori e riproducibili nel repository

Aggiungi una suite frontend con Node e jsdom (o strumento equivalente leggero), dipendenze dev dichiarate e lockfile. Usa il controller reale, non una copia delle funzioni. Controlla fetch con promise differite e timer deterministici; niente attese lunghe/flaky e niente hook di debug pubblici in produzione.

Copri almeno:
1. Digitazione durante salvataggio: resta dirty e beforeunload protegge; al termine viene persistita anche l'ultima versione e solo allora risulta salvata.
2. Risposta di A dopo Nuovo: il nuovo buffer resta senza percorso e non scrive su A.
3. Risposta di A dopo apertura B: nessuna alterazione di B.
4. Due aperture completate in ordine inverso e modifica locale durante apertura.
5. Stat/rilettura watchdog vecchi dopo cambio documento e dopo digitazione/salvataggio intervenuti nel frattempo.
6. Autosave pendente invalidato al cambio documento; riapertura dello stesso percorso con nuova sessione.
7. Salvataggi ripetuti, errori e conflitti: nessuna falsa pulizia, scrittura fuori ordine o retry incontrollato.
8. Salva con nome/rinomina in volo, digitazione e cambio documento; coordinamento col salvataggio ordinario senza ricreazione del vecchio file.
9. Buffer senza titolo: zero autosave e nessun dialogo; regressione del flusso SSE con modifiche locali.

## Confini dell'incarico

Non aggiungere KaTeX, Mermaid o altre funzionalità. Non cambiare in questo incarico il protocollo backend mtime, la semantica copia/rinomina, la gestione read-only, l'autenticazione o le scorciatoie: sono attività separate già registrate nell'audit. Non fare refactoring estetici estesi. Se scopri un vincolo backend che impedisce un requisito, fermati e documentalo con una riproduzione: non dichiarare risolto ciò che non lo è.

Non aggiornare versione o binari, non creare release, non fare commit/push automatici. Non modificare le REVIEW storiche né cancellare test. L'app finale resta offline e senza dipendenze runtime Node.

## Consegna

Esegui `go test -race ./...`, `go vet ./...`, la nuova suite frontend e `git diff --check`. Riporta comandi e risultati effettivi, file modificati, architettura scelta, rischi residui e scenari non verificati. Se uno strumento manca dichiaralo: non inventare esiti. Documenta un comando unico per rieseguire i test frontend. Lascia tutte le modifiche nel repository per la revisione.
