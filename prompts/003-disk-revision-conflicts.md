# Incarico 003 — Revisioni disco e conflitti senza perdita silenziosa

Gli incarichi 001 (sessioni/scritture asincrone) e 002 (Host/Origin) sono approvati nel perimetro verificato. Parti dal working tree attuale, senza reset. Leggi AUDIT-IMPLEMENTATION.md e codice/test reali. Questo incarico riguarda backend e integrazione frontend del protocollo dei conflitti, non nuove funzionalità.

## Problemi già verificati

- /api/save confronta `diskMod > req.ModTime`: modifiche con timestamp arretrato vengono sovrascritte. Un contenuto diverso con timestamp uguale non viene rilevato.
- UnixNano int64 in numeri JSON eccede la precisione intera JS: non è una revisione affidabile end-to-end.
- /api/init restituisce contenuto senza revisione; un successivo stat può attribuire al vecchio testo la baseline di una modifica esterna nuova.
- /api/rename non verifica la revisione sorgente. La conferma di sostituzione della destinazione non autorizza a perdere modifiche esterne del sorgente.

## Obiettivo e protocollo

Introduci una revisione disco **stringa opaca**, derivata dal contenuto effettivamente letto (per esempio SHA-256), distinta dalla revisione numerica del buffer client. Non usare Number/parseInt/BigInt o confronti d'ordine per le revisioni disco.

Una revisione di contenuto non è una generazione storica: una sequenza A -> B -> A può produrre la stessa revisione; documentalo. Non dichiarare di rilevare tutte le sostituzioni di inode se il contenuto è identico.

1. /api/init e /api/file restituiscono contenuto + revisione dello STESSO snapshot. Mai leggere il contenuto e associargli in un secondo momento una baseline di un'altra versione. Usa un helper condiviso; se rilevi una lettura instabile, ritenta in modo limitato o segnala errore, senza loop infiniti.
2. /api/stat restituisce la revisione affidabile del disco senza inviare tutto il contenuto. Per rilevare cambiamenti a mtime/size identici non basta una cache basata soltanto su quei metadati: valuta esplicitamente il costo I/O e documenta la soluzione. Mtime/size possono restare metadata, non criterio di integrità.
3. /api/save accetta una precondizione di revisione (nome consigliato `expected_revision`) e risponde con la revisione del contenuto effettivamente salvato. File esistente diverso dalla baseline -> 409; file atteso ma eliminato -> conflitto, non ricreazione automatica. Risposte di conflitto strutturate, con codice distinguibile.
4. Per scrivere un file esistente serve una revisione valida oppure un **force esplicito one-shot**. Baseline mancante o malformata non significa «forza». Puoi rispondere 428/400 secondo il caso. Non preservare il vecchio bypass silenzioso `mod_time:0`; documenta l'eventuale rottura dei client API legacy. La UI incorporata viene aggiornata insieme al backend.
5. Il force è consentito solo per il tentativo save autorizzato dall'utente dopo un conflitto. Non impostare flag persistenti o baseline fittizie nella sessione. Mantieni limite di un retry e protezione dirty/beforeunload dopo errori.
6. /api/rename verifica la revisione sorgente PRIMA di creare/scrivere la destinazione o rimuovere il sorgente, anche per old_path == new_path. Sorgente cambiato o sparito -> conflitto distinto da «destinazione esistente», nessun file modificato/rimosso e nessun cambiamento di stato attivo/recents. Il flag overwrite della destinazione NON scavalca questa verifica.
7. Per la UI, conflitto sorgente rename non deve aprire la conferma «esiste già un file con questo nome» né ritentare con overwrite:true. Lascia buffer dirty/testo intatto e mostra un errore pertinente. In questo incarico non introdurre force della sorgente rename: l'utente può annullare e risolvere tramite il normale salvataggio/apertura.
8. Primo salvataggio senza sorgente (/api/rename con old_path vuoto) resta possibile: nuova destinazione assente, o sostituzione destinazione dopo conferma esplicita come ora. Non cambiare la semantica copia/rinomina in questo incarico.
9. Confronto e scrittura devono essere serializzati tra le richieste del processo per evitare che due save concorrenti con la stessa baseline passino entrambi. Copri anche save contro rename. Una soluzione semplice esplicita è preferibile a locking sofisticato non verificato. Questo non è un compare-and-swap atomico rispetto ad altri programmi: descrivi onestamente la finestra residua fra verifica e sostituzione sul filesystem.

## Integrazione con il controller approvato

- La baseline iniziale arriva dallo snapshot /api/init; elimina il meccanismo che la ricava da un successivo stat del vecchio buffer.
- Inserisci la revisione disco stringa nel contesto delle operazioni e nei controlli pertinenti, conservando docSession, bufferRevision/savedRevision, writeEpoch, coda e coalescing.
- Durante digitazione in volo, una risposta save aggiorna la baseline della versione effettivamente scritta ma NON rende pulito il testo nuovo; il follow-up usa la revisione appena confermata.
- Una rename accodata dietro un save riuscito della stessa sessione deve usare la baseline confermata da quel save, non quella obsoleta catturata prima dell'attesa. Conserva identità del documento e snapshot del testo; evita falsi conflitti o riacquisizioni cieche della revisione disco che mascherino modifiche esterne.
- Stat/watchdog non aggiornano la baseline del buffer a una revisione diversa senza una rilettura coerente del relativo contenuto. Le risposte tarde restano invalide dopo scritture/sessioni/revisioni intervenute.
- Nessun fallback di compatibilità nel client che trasformi revisioni assenti/invalide in salvataggi forzati. Un errore protocollo lascia dirty e status esplicito.

## Test obbligatori

Go sullo stack reale con boundary valido e fixture isolate (nessun browser, HOME o recents reali):
- modifica esterna con mtime più vecchio e con stesso mtime/size -> conflitto, disco intatto;
- contenuto identico e metadata cambiati: comportamento di fingerprint documentato, niente falso conflitto di contenuto;
- revisione opaca integra nel round-trip JSON, baseline mancante/invalida rifiutata, legacy mod_time:0 non bypassa;
- eliminazione esterna non ricreata silenziosamente;
- due save contemporanei sulla stessa baseline con contenuti diversi -> uno solo accettato; save/rename coordinati;
- sorgente rename cambiato/sparito, anche con overwrite:true o old_path == new_path -> nessuna modifica destinazione/sorgente/active/recents;
- destinazione già esistente resta protetta; creazione iniziale senza sorgente e overwrite destinazione confermato continuano a funzionare;
- errore scrittura non dichiarato successo, force esplicito limitato al tentativo autorizzato.

Frontend e integrazione:
- modifica fra init e vecchio stat non può più timbrare il buffer vecchio con revisione nuova;
- baseline da init/file, nuovo protocollo nei payload, conflitti save/rename distinti, errori e force one-shot;
- digitazione durante save, follow-up e save -> rename accodata usano revisioni corrette;
- modifica esterna a metadata uguali viene rilevata; buffer dirty non viene sostituito;
- conserva TUTTI i 46 scenari frontend approvati e i test di confine HTTP/asset dev. Le fixture/asserzioni del vecchio protocollo possono essere migrate alla revisione stringa, ma non eliminare scenari o indebolire le proprietà di sicurezza. Spiega le migrazioni dei test indipendenti in consegna.

## Confini e consegna

Non cambiare Host/Origin, token/cookie/nonce, read-only, symlink policy, owner/ACL/xattr, significato Save As vs rename, layout, nuove funzionalità o packaging. Se trovi un vincolo fuori perimetro, documentalo senza promettere garanzie impossibili. Non alterare le REVIEW storiche. Aggiorna documentazione pertinente e audit dei limiti del nuovo protocollo.

Esegui Go race/vet, suite frontend con npm ci, sintassi di ogni JS/CJS, git diff --check ed esclusione asset dev dopo installazione npm. Riporta schema API, strategia snapshot/locking, risultati reali, costi I/O e limite TOCTOU esterno. Nessun commit/push, versione/binario/release. Attendi la revisione.
