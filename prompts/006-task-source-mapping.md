# Incarico 006 — Mappatura affidabile delle checkbox Markdown

Baseline approvata dopo 005d: 79 Go, 112 frontend. Lavora sul working tree esistente senza reset, commit/push, incremento versione, binari o release. Non modificare `REVIEW-1.0.2.md`, `REVIEW-1.0.3.md` o indebolire test esistenti.

## Problema e perimetro

In `web/static/js/livepreview.js`, il controller associa l'n-esima checkbox DOM all'n-esima riga che combacia con una regex indipendente dal parser. Inoltre legge `[x]` in tutta la riga invece che nel marcatore della task. L'audit ha riprodotto `- [ ] refer to [x] in prose` e il click su una task in blockquote che cambia una task normale. Anche input HTML del documento e preview in ritardo possono alterare la corrispondenza. Correggi in un solo incarico la mappatura, la provenienza e l'invalidazione; non riscrivere il parser dei recinti o l'outline, non cambiare shortcut/link locali, backend, packaging o funzioni opzionali.

## Contratto

- Rendi interattive solo le checkbox emesse per task Markdown che puoi associare senza ambiguità a un preciso marcatore del buffer che ha prodotto la preview. HTML del documento, classi o attributi scritti dall'utente non devono poter essere interpretati come autorizzazione a modificare il buffer. Non allentare il sanitizzatore/CSP. Se la provenienza o la mappatura non è certa, non modificare nulla: niente fallback per indice DOM o ricerca di testo simile.
- Il click cambia solo lo stato nel marcatore iniziale a cui appartiene la checkbox, non il testo della riga o di altre task. Supporta i casi che Marked rende come task per liste puntate, numerate, annidate e in citazione, comprese task con testo duplicato e marker `[X]`. Paragrafi con `[x]`, esempi in codice inline, recintato o indentato e HTML non devono spostare la mappatura o creare un edit. Preserva il resto del buffer, inclusi spazi e righe.
- Un evento da preview stale (buffer cambiato prima del render, documento sostituito, o nodo di un render non più attivo) non deve modificare il documento. Dopo il render corrente le task valide funzionano di nuovo. Mantieni anche il blocco programmatico read-only: nessun edit e nessuna scrittura; rendi le checkbox non editabili quando protette.
- Una modifica valida passa per il normale flusso input del controller una sola volta, conservando sessioni, dirty/beforeunload e autosave. Nessuna richiesta di salvataggio diretta dalla preview. Un click ignorato non deve marcare il buffer dirty o riarmare l'autosave.

## Prove richieste

Usa il controller, l'HTML e Marked reali nel harness `tests/frontend`, senza debug hook in produzione. Verifica la checkbox bersaglio nel DOM e il testo completo a valle. Copri almeno:

1. Click in entrambe le direzioni su una task seguita da `[x]` nel testo, incluso `[X]` come stato iniziale.
2. Blockquote, lista normale, numerata, annidata e task duplicate: cliccare ogni tipo cambia solo il suo marcatore.
3. Checkbox HTML prima e fra task vere, anche con gli stessi attributi pubblici usati dalla preview: il click non modifica il buffer e non altera l'associazione delle task vere. Esempi in codice e testo normale con marker simili non partecipano alla mappatura.
4. Digitazione durante il debounce della preview, poi click sulla vecchia checkbox: nessun edit attribuibile al click. Ripeti dopo il render per verificare che la task sia interattiva. Prova anche il cambio documento, compreso il ritorno a un buffer con testo identico, per evitare che l'uguaglianza del solo testo mantenga valido un vecchio nodo.
5. Read-only con task realmente presente nel DOM, niente edit o `/api/save`; caso scrivibile con un solo input, dirty e autosave coerenti. Per i click ignorati, verifica nessun input/dirty/scrittura indebiti.

Riesegui Go race/shuffle, vet, frontend dopo `npm ci`, sintassi JS/CJS/MJS, `git diff --check` ed esclusione asset dev dopo npm ci. Test e dipendenze restano fuori da `web/`. Riporta comandi, esiti e limiti (jsdom non equivale a verifica browser nativa). Fermati alla consegna, senza iniziare l'incarico successivo.
