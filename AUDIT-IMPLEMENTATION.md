# TypeCraft — verifica e piano di implementazione

Baseline: commit `dd1f317` (1.0.3). Documenti esaminati: `REVIEW-1.0.2.md` e `REVIEW-1.0.3.md`.
Questo documento distingue correzioni già presenti, difetti riprodotti e funzionalità proposte: le matrici di confronto con Typora/iA Writer non sono tutte requisiti obbligatori.

## Verifiche eseguite

- Lettura di backend, test, controller frontend, preview, sanitizer, outline, stampa e Makefile; confronto con README e revisioni.
- `go test -race -count=1 -v ./...`: **20 test passati** (il documento 1.0.3 ne menziona 19).
- `go vet ./...`: pulito. `node --check` su tutti i JS: pulito.
- Harness temporaneo Node + jsdom 26 con HTML e script reali, fetch controllato per riprodurre risposte ritardate.
- Probe temporanei Go contro `setupMux()` reale per conflitti, sola lettura e Host.
- `file TypeCraft.AppDir/usr/bin/typecraft`: **Mach-O x86_64**, non eseguibile su questo host Linux.
- Go e jsdom sono stati scaricati esclusivamente in `/tmp/typecraft-review-8ozTSZ`, non aggiunti al progetto.
- Nessuna verifica visuale/browser nativo completa, né prova end-to-end Windows/macOS. Test verdi non equivalgono a certificazione di tutti i flussi.

## Correzioni precedenti effettivamente presenti

Canale single-instance HTTP + SSE, sanitizer e CSP, autosave senza percorsi inventati, beforeunload, export senza Copy, stampa con override delle classi, helper dei percorsi, immagini confinate tramite pathWithin, validazione old_path, conferma sovrascrittura destinazione, preservazione mode POSIX e snapshot launcher. La suite Go copre una parte di queste correzioni; non vanno riscritte indiscriminatamente.

## Problemi prioritari

### P0 — stato asincrono del documento (riprodotto)

`web/static/js/app.js`: saveFile, markSaved, openFile, newDocument, checkExternalChange, fsConfirmAction.

1. Salvataggio del testo A in volo, digitazione di B, risposta di A: UI «Salvato», beforeunload non impedisce la chiusura, ma B non è stato inviato. Il timer successivo può salvare B se si resta nell'app: resta una finestra reale di perdita dati.
2. Salvataggio di `/docs/a.md` in volo, Nuovo documento, risposta di A: currentPath torna di nascosto ad A. Scrivere e salvare il nuovo testo manda effettivamente `/api/save` con il percorso A, pur con titolo «Senza titolo.md».
3. Per lettura statica: risposte open/watchdog/save-as non sono legate a un'identità di sessione e a una revisione del buffer; possono applicarsi fuori ordine. `state.saving` non serializza le richieste e i timer non vengono sistematicamente invalidati ai cambi documento.

Primo incarico: `prompts/001-document-session-safety.md`.

### P0 — hardening dell'handshake/Host (probe riprodotto, exploit browser non eseguito)

`authMiddleware` controlla Origin, non Host. GET `/api/init` con Host `attacker.example` e senza Origin restituisce 200 e token. L'assenza di Origin è normale per alcune richieste GET: il controllo non basta a dimostrare una difesa DNS-rebinding completa. Servono validazione Host/porta all'ingresso e test anche sulle risorse pubbliche, senza rompere launcher e canale interno. Cookie HttpOnly/nonce è un intervento successivo distinto, non una scusa per lasciare il controllo Host incompleto.

### P1 — protocollo conflitti e snapshot iniziale

- Riprodotto sul mux reale: mtime esterno più vecchio della baseline viene accettato da `/api/save` (confronto `>`), sovrascrivendo il contenuto esterno. Anche restore/git/copia con timestamp arretrato deve produrre conflitto.
- `mod_time` è UnixNano int64 serializzato come numero JSON: fuori dal range di precisione degli interi JS; valutare revisione opaca stringa e compatibilità.
- `/api/init` invia contenuto senza revisione; successivo `/api/stat` può associare una versione nuova al vecchio buffer. Correzione da progettare come snapshot coerente, non mero stat aggiuntivo.
- `/api/rename` non controlla revisione sorgente; `overwrite` della destinazione non equivale a consenso per perdere modifiche esterne della sorgente.
- TOCTOU fra verifica e scrittura resta da valutare esplicitamente; non promettere compare-and-swap atomico senza implementarlo.

### P1 — sola lettura e operazioni distruttive

- Riprodotto: file 0444 restituito con `read_only:false`; `/api/save` lo sostituisce con successo se la directory è scrivibile. Serve politica backend oltre a indicatore UI, anche per rename.
- `fsConfirmAction` usa sempre `/api/rename`: «Salva con nome» elimina il sorgente. Separare esplicitamente copia/Save As da rinomina/spostamento, con UX e test dedicati.
- `atomicWrite` preserva mode, non proprietario/ACL/xattr; il report precedente non dimostra preservazione completa dei metadati.
- Gestione symlink nei salvataggi/rinomine e fallimento cancellazione sorgente da specificare; attualmente os.Remove fallito è ignorato.

### P1/P2 — regressioni frontend riprodotte

- Ctrl+Shift+S esegue Salva invece di Salva con nome: la condizione generica viene prima. Analogo difetto statico per Ctrl+Shift+O.
- Task `- [ ] refer to [x] in prose`: il click non cambia lo stato perché il rilevamento cerca `[x]` ovunque nella riga.
- Task in blockquote seguito da task normale: il click sul task citato cambia quello normale. Mappatura DOM/sorgente incompleta anche con checkbox HTML arbitrarie.
- Recinto aperto con tre backtick e chiuso con quattro: la preview ingloba anche il testo successivo come codice. Il parser regex non rispetta la chiusura Markdown valida.
- Link locali: riconoscimento non include `.mdx`; link relativi non gestiti possono navigare l'app. Da verificare/risolvere con policy centralizzata e test.
- Outline riconosce solo recinti con backtick, non quelli con tilde; ancore duplicate e coerenza con preview da verificare.

### Rilascio

Binario locale AppDir ignorato da git, presente ma macOS, non Linux. Makefile contiene percorso assoluto personale per appimagetool e non definisce `install-appdir` citato dalla revisione. Packaging riproducibile da fare dopo i fix, senza distribuire binari obsoleti.

## Funzionalità ancora da pianificare

KaTeX offline (poi Mermaid opzionale), trova/sostituisci interno, editing tabelle (oggi c'è solo inserimento del modello), metriche selezionabili e obiettivo parole, Style Check leggero IT/EN, preferenze server persistenti, cookie/nonce e workspace root configurabile, preferenza hard line breaks. Non implementarle tutte nello stesso incarico.

## Revisione indipendente della prima implementazione — DA CORREGGERE

La suite consegnata passa 30/30; i 20 test Go passano con race detector e vet è pulito. Il revisore ha però aggiunto cinque casi in `tests/frontend/review-regressions.test.cjs`: tutti falliscono sulla prima implementazione.

- Callback di save e rename accodate vengono eseguite anche dopo invalidazione della sessione, perché manca il controllo prima dell'invio fetch.
- Il consenso al force-save azzera stabilmente currentModTime: dopo un retry fallito gli autosave successivi bypassano il controllo conflitti. Fix possibile nel solo client, senza cambiare protocollo.
- Due 409 consecutivi generano un terzo POST e una seconda conferma, anziché fermarsi dopo un retry.
- L'alert di errore rename può comparire nella nuova sessione quando il corpo errore arriva in ritardo.
- Suite collocata sotto web/tests: `go:embed web` incorpora anche le dipendenze npm. Dopo npm ci, go list elenca 1293 file di sviluppo embedded (1286 di node_modules), 13.564.948 byte totali. Spostare i test fuori dall'albero web e verificarne l'esclusione con dipendenze installate.

Correzioni dettagliate: `prompts/001b-document-session-review-fixes.md`. Nessuna approvazione o avanzamento alle funzionalità successive finché questi punti non passano la revisione.

## Revisione della correzione 001b — cinque fix verificati, incarico 001 ancora aperto

- Suite consegnata: 42/42 passati, inclusi i cinque test indipendenti precedenti.
- Go: 21 test passati con race detector (incluso controllo esclusione asset dev); vet pulito; sintassi JS/CJS e diff check puliti.
- Dopo npm ci: EmbedFiles 15, asset dev 0. I test e node_modules sono ora correttamente fuori dall'albero web.
- Nuova race riprodotta: stat/file watchdog già in volo -> Ctrl+S senza nuova digitazione -> conflitto e overwrite autorizzato -> risposta watchdog pre-scrittura prima della risposta save. Il client può mostrare il vecchio snapshot esterno, disco contiene il testo salvato, ma status è «Salvato» e beforeunload non protegge. La nuova baseline può nascondere la divergenza alle letture successive.
- Aggiunti due test indipendenti in `tests/frontend/review-watchdog-write.test.cjs`: entrambi falliscono (varianti risposta stat e risposta file). La persistenza su disco finto viene simulata prima della risposta save.

La verifica positiva dei cinque fix 001b non basta quindi a chiudere l'incarico 001. Correzione circoscritta in `prompts/001c-watchdog-write-race.md`. Nessuna modifica del revisore all'implementazione di produzione.

## Revisione finale 001c — INCARICO 001 APPROVATO nel perimetro verificato

- Riletti controller, writeEpoch, confirmPersisted e test aggiunti: nessun ulteriore difetto bloccante individuato nel perimetro dell'incarico.
- Suite frontend rieseguita dal revisore dopo npm ci: **46/46 passati**, inclusi i sette test indipendenti precedenti. Hash del file review-watchdog-write invariato (`cd2e6d7dfb92db761c4286147544a1e5`).
- Due ulteriori probe indipendenti temporanei passati: stat e file in volo, scrittura iniziata e già terminata con errore prima della risposta watchdog; vecchio snapshot scartato grazie all'epoch, successivo poll non contestato ancora funzionante.
- Go: **21 test passati con race detector**, vet pulito. Sintassi JS/CJS e diff check puliti.
- Verifica embed dopo npm ci: **15 asset, zero file dev**.

Approvazione limitata alla gestione asincrona delle sessioni/scritture nel controller e alle regressioni riprodotte. Non è un'approvazione di rilascio o una certificazione browser/native/multipiattaforma. Restano i problemi di backend, sicurezza, read-only, semantica Save As e packaging già elencati. Le richieste già inviate possono avere effetti sul server anche dopo cambio sessione; protocollo conflitti invariato.

Prossimo incarico: `prompts/002-local-http-boundary.md` (Host/Origin e handshake locale, senza migrazione cookie/nonce).

## Revisione incarico 002 — DA CORREGGERE (parser)

Verificati guard globale e composizione main: securityHeaders -> boundary -> mux. I 30 test Go consegnati passano con race detector (anche tre ripetizioni con shuffle), vet pulito; suite frontend 46/46 verde. La policy generale e il collegamento allo stack sono corretti.

Tre sottocasi indipendenti contro listener reale falliscono in `http_boundary_review_test.go`:

1. Host `[::ffff:127.0.0.1]:porta` ammesso, contrariamente alla allow-list dichiarata senza IPv6: net.ParseIP().String() collassa il literal mapped a IPv4 prima del controllo.
2. Origin `http://[::ffff:7f00:1]:porta` ammesso con Host `127.0.0.1:porta`, contrariamente al requisito same-origin: la normalizzazione degli indirizzi non equivale a identità dell'origine browser.
3. Origin `http://127.0.0.1:porta#` ammesso: url.Parse non conserva un frammento vuoto nei campi controllati.

Tutti e tre restituiscono 200 e token da /api/init. Non è un exploit browser DNS-rebinding dimostrato né prova di accesso da hostname esterno; è una violazione riprodotta della policy richiesta. Correzione circoscritta: `prompts/002b-authority-origin-parser-fixes.md`. Il revisore non ha modificato codice di produzione.

## Revisione finale 002b — INCARICO 002 APPROVATO nel perimetro verificato

- Riletti parser authority, Origin e collegamento al guard globale: i literal bracketed non vengono più convertiti in IPv4; il delimitatore di frammento è rifiutato anche quando vuoto.
- Test indipendente del revisore rieseguito sul listener reale: **3/3 sottocasi passati**, senza indebolimento delle asserzioni.
- Suite Go completa con race detector e shuffle: **31 test passati**; vet pulito.
- Frontend dopo npm ci: **46/46 passati**; sintassi JS/CJS e diff check puliti.
- Esclusione asset dev: test Go passato, EmbedFiles **15**, dev **0**.

Approvazione del confine Host/Origin secondo la policy IPv4 loopback dichiarata, non prova di un exploit browser completo né isolamento da processi locali dello stesso utente. Restano le attività cookie/nonce, read-only, protocollo conflitti, semantica Save As e packaging già registrate.

Prossimo incarico: `prompts/003-disk-revision-conflicts.md`, per revisioni disco affidabili e snapshot iniziali coerenti. Nessuna modifica del revisore al codice di produzione.

## Revisione indipendente 003 — DA CORREGGERE (integrazione protocollo)

I 46 test Go consegnati passano con race detector e shuffle, vet pulito; suite frontend consegnata 56/56 verde. Verificati fingerprint, precondizioni, sorgente rename prima degli effetti e serializzazione di processo. La migrazione dei test indipendenti mantiene le proprietà principali, ma un caso retry usa ancora il vecchio 409 testuale e va migrato anziché mantenerne il fallback permissivo.

Nuovi test indipendenti:
- `tests/frontend/review-revision-protocol.test.cjs`: 9/9 falliti sulla consegna.
- `disk_revision_review_test.go`: errore snapshot init ignorato, test fallito sul listener reale.

Difetti riprodotti:
1. Dopo await res.json() nei primi rami 409 manca il ricontrollo sessione. Save può mostrare dialoghi/status vecchi; rename target_exists può inviare overwrite:true dopo Nuovo, sovrascrivendo la destinazione e rimuovendo il vecchio sorgente.
2. HTTP 200 senza revisione valida pulisce il buffer/disarma beforeunload e può adottare path non confermati. Manca la validazione prima di confirmPersisted.
3. Save 409 sconosciuto/non-JSON viene trattato come conflitto da forzare anziché errore protocollo.
4. Init ignora readDiskSnapshot fallito e risponde 200 con percorso attivo, testo e revisione vuoti. Una sostituzione esterna file -> directory rende il caso deterministico.
5. Fixture init usa la truthiness del contenuto per decidere la revisione: file vuoto esistente riceve baseline vuota invece dell'hash dei byte vuoti. È un difetto della fixture, non del digest Go.

Correzioni circoscritte in `prompts/003b-protocol-review-fixes.md`. Il revisore ha aggiunto test e documentazione, senza modificare la produzione. L'incarico 003 non è ancora approvato.

## Revisione 003b — correzioni verificate, resta la guardia del boot

- 48 test Go passati con race detector/shuffle, vet pulito; 75 frontend passati dopo npm ci, inclusi i nove casi indipendenti precedenti. Test init del revisore ed esclusione asset dev passati; sintassi JS/CJS e diff check puliti.
- Riletti validatori e rami 200/409: le cause della revisione 003b sono corrette.
- Nuova verifica sul boot: /api/init pendente -> Nuovo/digitazione/Salva con nome riuscito -> vecchia init invalida/mancante/503/errore rete. Nei rami invalido/mancante vengono azzerati percorso e baseline del documento adottato; nei rami HTTP/catch lo status viene sostituito dall'errore vecchio.
- Anche senza Nuovo, Save As del buffer iniziale può adottare un percorso nella stessa docSession: un controllo solo sulla sessione non basta.
- Aggiunti cinque test indipendenti in `tests/frontend/review-init-session.test.cjs`, tutti falliti sulla consegna; preservano anche baseline e successivo salvataggio ordinario sul percorso giusto.

Una causa circoscritta ancora da correggere in initApp; incarico 003 non ancora approvato. Istruzioni: `prompts/003c-init-session-guards.md`. Il revisore non ha modificato la produzione.

## Revisione finale 003c — INCARICO 003 APPROVATO nel perimetro verificato

- Riletti bootDocumentCurrent/bootTextUntouched e tutti i rami initApp. Gli effetti documentali sono isolati dai metadati globali; il controllo comprende percorso, baseline, revisione persistita e writeEpoch oltre alla sessione.
- Suite frontend rieseguita dal revisore dopo npm ci: **82/82 passati**, inclusi i cinque test indipendenti del boot e i nove del protocollo. Scenari precedenti conservati.
- Suite Go completa con race detector/shuffle: **48 test passati**; vet pulito. Test init del revisore ed esclusione asset dev ripetuti con successo.
- Sintassi JS/CJS e diff check puliti; EmbedFiles dopo installazione npm: **15**, asset dev **0**.

Approvazione del protocollo revisioni e della sua integrazione nel perimetro verificato. Non è una certificazione di rilascio o browser nativo. Restano fingerprint non storico (A->B->A coincide), costo O(size) del poll, torn read in condizioni esterne avverse e finestra TOCTOU rispetto a processi esterni, come documentato. Nessuna promessa di CAS filesystem atomico.

Prossimo incarico: `prompts/004-read-only-protection.md`, per impedire che salvataggi atomici aggirino i file in sola lettura. Il revisore non ha modificato il codice di produzione.

## Revisione incarico 004 — DA CORREGGERE (errori operativi)

- 55 test Go consegnati passati con race detector/shuffle, vet pulito; 89 frontend passati dopo npm ci. Verificati policy mode/accesso effettivo, controlli force/overwrite, copia con sorgente vuoto e guardie UI principali.
- Aggiunti due test indipendenti in `read_only_review_test.go`, entrambi falliti:
  1. Rename da directory sorgente 0555 verso destinazione scrivibile: file 0644 passa il preflight, destinazione scritta, os.Remove fallito ignorato; API 200 e stato attivo/recents avanzati benché il sorgente rimanga. Riprodotto con utente non privilegiato, non soltanto simulato.
  2. PathError EROFS mappato a 500 write_failed invece di 403 write_forbidden. È una verifica del mapping errno, non una prova su mount read-only reale.
- Aggiunto test frontend indipendente `tests/frontend/review-read-only.test.cjs`, fallito: Save As di documento normale dirty verso destinazione protetta annulla l'autosave ma lascia l'indicatore «Salvataggio…» dopo il rifiuto.

Correzioni mirate in `prompts/004b-permission-failure-review.md`. Necessario segnalare onestamente eventuali esiti parziali della rinomina senza promettere rollback atomico. Nessuna modifica del revisore alla produzione; incarico 004 non ancora approvato.

## Revisione finale 004b — INCARICO 004 APPROVATO nel perimetro verificato

- Riletti preflight della directory, gestione reale Stat/Remove, mapping errori EROFS e rami frontend di rifiuto/partial. Nessun falso successo o aggiornamento di stato/recents nel ramo di rimozione fallita; nessun rollback della destinazione.
- I tre test indipendenti che bloccavano il 004 passano senza indebolimento delle asserzioni.
- Aggiunta prova indipendente sul listener reale in `read_only_review_test.go`: directory sorgente 0577, il preflight grossolano passa ma il proprietario non può rimuovere il file. Destinazione esistente sovrascritta, sorgente conservato, risposta 403 write_forbidden/partial:true/success:false con path destinazione; stato attivo/recents invariati. Prova reale senza race o hook produzione, non solo test del helper.
- Aggiunta prova frontend indipendente in `tests/frontend/review-read-only.test.cjs` per partial 500 generico: buffer/path/dirty conservati, nessun retry, esito parziale presente nei dettagli dell'alert. Nota UX non bloccante: diversamente dal 403 dedicato, il 500 usa ancora messaggio generico con dettagli JSON; uniformare il messaggio leggibile nel successivo incarico sulle operazioni file.
- Suite Go finale del revisore con race detector/shuffle: **62 test passati**, zero fallimenti/skip; vet pulito. Frontend dopo npm ci: **93/93 passati** (92 consegnati + ulteriore prova indipendente). Sintassi JS/CJS e diff check puliti.
- Esclusione asset dev dopo npm ci: test Go passato, 15 asset/zero file dev. Compilazioni Windows e Darwin amd64 rieseguite dal revisore con artefatti temporanei fuori repository e rimossi: entrambe passate, non equivalgono a esecuzione nativa.

Approvazione limitata alla policy read-only, alla copia protetta e agli errori operativi verificati su Linux/Go e jsdom. Restano ACL/sticky bit/attributi/Windows nativi non certificati, preflight consultivo e TOCTOU esterno; rinomina non transazionale fra due percorsi, con esito parziale esplicito quando necessario. Nessuna modifica del revisore al codice di produzione.

Prossimo incarico: `prompts/005-save-as-copy-semantics.md`, per separare Salva con nome da Rinomina/Sposta senza alterare le garanzie approvate.

## Revisione indipendente 005 — DA CORREGGERE (copia rifiutata e alias)

- Rieseguiti i 67 test Go consegnati con race/shuffle e i 103 frontend dopo npm ci: tutti passati. Riletti modalità rename/saveAs/saveCopy, shortcut, payload source_path, guardie asincrone, gestione partial e backend alias.
- Nuovo test indipendente `tests/frontend/review-save-as-copy.test.cjs`, quattro varianti tutte fallite: edit durante copia pendente riarmano il debounce; se copia rifiutata prima dello scatto (500 I/O, 409 same-source, 403 destinazione protetta o overwrite negato), il timer successivo invia /api/save al vecchio percorso e sovrascrive l'originale. È una richiesta inviata dopo il rifiuto, non un effetto inevitabile di un autosave già in volo.
- Nuovi test real-stack in `save_as_copy_review_test.go`, entrambi falliti:
  1. Destinazione symlink ciclico: errore ELOOP dello stat destinazione ignorato; risposta 200 e symlink sostituito senza identità verificata/consenso. Richiesto errore esplicito senza effetti.
  2. Sorgente symlink verso target mancante: copia sul referente non riconosciuta come alias; API 200 ricrea il documento originale attraverso il link. Richiesto copy_same_source, non creazione del target.
- Suite completa inclusi i casi aggiunti: **Go 67 passati / 2 falliti**, **frontend 103 passati / 4 falliti**. Vet, sintassi JS/CJS, diff check e test esclusione asset dev passati.

Incarico 005 non ancora approvato. Correzione circoscritta in `prompts/005b-copy-failure-autosave-aliases.md`. Nessuna modifica del revisore alla produzione; il prossimo incarico resta sospeso finché questi casi non passano.

## Revisione indipendente 005b — DA CORREGGERE (identità dei percorsi e consenso)

- I sei casi indipendenti precedenti passano, senza modifiche alle asserzioni. Verificati la serializzazione del preflight sotto `diskWriteMu`, i rami di cleanup, l'isolamento del nuovo documento e il follow-up sulla copia confermata. Aggiunto un caso frontend passato: il debounce scatta e coalesca durante la prima richiesta; dopo consenso, il retry fallisce mentre un altro debounce è pendente. Nessun salvataggio al sorgente, nessun ulteriore retry, buffer dirty preservato.
- Tre nuove prove in `save_as_copy_review_test.go`, sul listener reale, tutte fallite con HTTP 200: (1) link relativo con `..` dentro una directory symlink, risolto dalla directory lessicale anziché da quella effettiva: il referente esistente dell'originale viene sovrascritto; (2) referente del sorgente con prefisso symlink e più componenti mancanti: il confronto perde il prefisso canonico e la copia ricrea cartella e originale; (3) destinazione distinta con symlink dangling: `Stat` vede il referente assente e il backend sostituisce la directory entry senza consenso. Tutti e tre fanno avanzare lo stato attivo.
- Suite finale del revisore: **Go 71 passati / 3 falliti / 0 skip** con race/shuffle su Linux non privilegiato; **frontend 112 passati / 0 falliti** in jsdom (19 mirati). Vet, sintassi, diff check e test embed dopo npm ci passati: 15 asset, zero dev. Nessuna certificazione browser/native e nessuna modifica del revisore al codice di produzione.

L'incarico 005 non è approvato. Correzione circoscritta al backend copia: `prompts/005c-copy-path-identity-and-consent.md`. Il 006 resta sospeso.

## Revisione indipendente 005c — DA CORREGGERE (accessibilità del sorgente)

- I tre casi che bloccavano il 005c passano insieme agli altri test indipendenti precedenti, senza indebolirne le asserzioni. Verificati la risoluzione fisica dei componenti e il consenso per la sostituzione di una entry dangling distinta.
- Nuova prova sul listener reale, `TestReviewCopyCannotReplaceDirectoryLinkNeededBySource` in `save_as_copy_review_test.go`: il referente del sorgente e quello della destinazione sono diversi, ma la entry destinazione è un symlink di directory attraversato dal sorgente. Con overwrite esplicito il backend restituisce 200, sostituisce il link e aggiorna lo stato attivo. I byte del referente dell'originale sono intatti, ma il sorgente non è più apribile (`ENOTDIR`). Il confronto dei referenti finali non è sufficiente a preservare l'accesso al sorgente.
- Riesecuzione indipendente: **Go 77 passati / 1 fallito / 0 skip** con race/shuffle, **frontend 112/112** dopo npm ci (19 mirati), vet, sintassi, diff check ed embed passati (15 asset, zero dev). Nessuna modifica del revisore al codice di produzione.

Il 005 non è approvato. Correzione circoscritta: `prompts/005d-copy-source-link-dependency.md`. Il 006 resta sospeso.

## Revisione finale 005d — INCARICO 005 APPROVATO nel perimetro verificato

- Verificato nel codice il controllo della entry di destinazione (genitori risolti, link finale non seguito) contro i link attraversati per aprire il sorgente, distinto dal confronto dei referenti. I controlli girano sotto `diskWriteMu`, prima degli effetti, anche con overwrite. Il caso indipendente che interrompeva l'accesso all'originale passa; passa anche la variante con alias del genitore. Confermati i rifiuti precedenti e il successo con overwrite di una destinazione dangling indipendente. Asserzioni indipendenti preservate.
- Riesecuzione indipendente: **79 Go passati** con race/shuffle (17 mirati), **112 frontend passati** dopo npm ci (19 mirati), zero fallimenti/skip nelle suite. Vet, sintassi JS/CJS/MJS, diff check ed embed passati: **15 asset, zero dev**.
- Approvazione limitata alla separazione copia/rinomina, alla gestione delle risposte e ai controlli di identità, consenso e protezione nei casi verificati su Linux/Go e jsdom. Non è filesystem CAS, certificazione browser/native/multipiattaforma o approvazione di rilascio. Nessuna modifica del revisore al codice di produzione.

Prossimo incarico, bug di integrità del buffer: `prompts/006-task-source-mapping.md`. Parsing dei recinti/outline, link/shortcut e packaging restano distinti.

## Regola di consegna

Un incarico alla volta. L'agente implementa con test riproducibili; il revisore controlla diff e test indipendentemente. Nessun incremento versione, packaging o approvazione basata soltanto sul resoconto dell'agente.

## Incarico 003 — revisioni disco e conflitti (implementato)

### Schema API
- `/api/init`: `file_content` e `file_revision` derivano dalla **stessa** `readDiskSnapshot` (niente stat successivo che possa associare una revisione nuova al testo vecchio). `file_revision` è vuota se il file non esiste.
- `/api/file`: `{path, content, revision, mod_time, read_only}` — contenuto e revisione dalla stessa snapshot.
- `/api/stat`: `{path, exists, revision, mod_time, size}`. Risponde 200 anche se il file manca (`exists:false`, `revision:""`). Legge e calcola SHA-256 del file a ogni chiamata.
- `/api/save` body: `{path, content, expected_revision, force}` (il legacy `mod_time` è accettato nel JSON ma ignorato). 200 `{success, path, revision, mod_time}`; 409 `{success:false, error:"conflict", conflict:"revision_mismatch"|"file_missing", path, revision}`; 428 `revision_required`; 400 `invalid_revision`; 500 `write_failed`; 503 `snapshot_unstable`.
- `/api/rename` body: `{old_path, new_path, content, expected_revision, overwrite}`. La revisione sorgente è verificata **prima** di creare/scrivere la destinazione o rimuovere il sorgente, anche per `old_path == new_path`; `overwrite` non la scavalca. 409 con `source_changed`, `source_missing` o `target_exists`; 428/400 come sopra. `old_path == ""` (nuovo documento) non richiede baseline e mantiene la semantica Save As esistente.

### Snapshot e revisione
`readDiskSnapshot`: `open` → `fstat` prima → lettura completa → `fstat` dopo → `stat` del path. Se size/mtime cambiano durante la lettura, o il path non punta più allo stesso inode, la lettura è ritentata fino a 3 volte e poi rifiutata con `snapshot_unstable` (503), senza loop. La revisione è `sha256:<64 hex>` dei byte **effettivamente letti**: contenuto e revisione descrivono sempre la stessa snapshot. È un'impronta di **contenuto**, non una generazione storica: A→B→A produce la stessa revisione e una sostituzione con byte identici (nuovo inode/mtime) non è un cambiamento di contenuto.

### Coordinamento delle scritture
`diskWriteMu` serializza l'intera sequenza lettura-verifica-scrittura di `/api/save` e `/api/rename` nello stesso processo: due save con la stessa baseline non possono passare entrambi, e save/rename sono ordinati fra loro. **Non è un compare-and-swap atomico**: fra la verifica e `atomicWrite` (tmp + fsync + rename + fsync della directory) un programma esterno può cambiare il file e la nostra scrittura vince senza conflitto (TOCTOU residuo, non eliminabile senza lock di filesystem condivisi). Il lock copre un processo: il single-instance evita due istanze dell'app, non altri editor.

### Costi I/O
- `/api/stat` legge e hasha l'intero file a ogni poll (O(size) per finestra ogni 5 s, solo mentre il documento è visibile). Una cache basata solo su mtime/size è stata scartata perché non rileva modifiche con metadata identici.
- `/api/init` e `/api/file`: una lettura + hash.
- `/api/save` e `/api/rename`: una lettura + hash di verifica, poi scrittura atomica.

### Limiti espliciti
- Impronta di contenuto, non generazione né tracking di inode: A→B→A coincide; nessuna dichiarazione di rilevare ogni sostituzione di inode a byte identici.
- Scrittura in-place di un programma esterno con stessa size/mtime durante la lettura: i retry su `fstat` riducono la finestra ma non garantiscono l'assenza di torn read.
- TOCTOU fra verifica e sostituzione atomica rispetto a programmi esterni (descritto sopra).
- `force` copre solo il tentativo autorizzato dopo un conflitto e **non** resuscita un file eliminato; i client API legacy che inviavano solo `mod_time` (0 incluso) ricevono 428 e devono leggere una revisione.
- Frontend: la baseline arriva da `init`/`file`/save/rename confermati; il watchdog non aggiorna la baseline senza una rilettura coerente con la stessa revisione. I test indipendenti 001b/001c sono stati migrati da `mod_time` a `expected_revision`/`force` conservando gli stessi scenari e proprietà.

## Incarico 003b — correzioni di integrazione (implementato)

- **/api/init** non maschera più un errore di `readDiskSnapshot`: risponde `503 snapshot_unstable` (stessa forma di `/api/file`) invece di un 200 con contenuto vuoto e revisione vuota. Il nuovo campo `file_exists` distingue un file realmente vuoto (true + revisione dei byte vuoti) da un file attivo sparito (false, `file_revision:""`).
- **Frontend, boot**: un init fallito (non-2xx) mostra `⚠️ Impossibile leggere il documento attivo` e non sostituisce il testo digitato durante l'attesa. Un init 200 con `active_file` ma revisione invalida/mancante, o con `file_exists:false`, non viene adottato come documento aperto e pulito: il buffer resta senza path (nessun `Ctrl+S` verso un percorso indovinato, nessuna ricreazione automatica). `updateDocTitle` riflette lo stato reale.
- **Validazione delle risposte di scrittura**: un 200 conta come conferma solo con JSON valido, `success:true` e `revision` conforme a `sha256:<64 hex>`; un 200 non-JSON, `success:false`, revisione assente/invalida o campi incoerenti è un errore di protocollo (`⚠️ Risposta del server non valida`): buffer dirty, nessuna adozione di path/baseline, nessun follow-up automatico, nessun force implicito. Se il server ha già scritto, non c'è rollback e il client non ritenta alla cieca.
- **Force solo per conflitti riconosciuti**: nel save solo `409 revision_mismatch` può proporre l'overwrite one-shot; `file_missing` resta distinto; 409 non-JSON/codici sconosciuti sono errori di protocollo senza conferma. Nel rename solo `target_exists` autorizza il retry `overwrite:true`; `source_changed`/`source_missing` restano errori sorgente; codici ignoti/malformati sono errori di protocollo. Il limite di un retry e il consenso one-shot sono invariati.
- **Ricontrollo del contesto dopo ogni JSON**: `performSave` e `performRename` verificano `sameDocument` dopo il parsing differito del corpo (200 e 409) e immediatamente prima del retry, quindi un corpo lento non può mostrare conferme, cambiare lo status o inviare un POST distruttivo per una sessione abbandonata. La migrazione ha toccato solo le fixture: `review-regressions` «conflict retry bounded» ora usa conflitti JSON validi invece di `textResponse(409)` (il testo 409 non è più consenso), mentre `review-revision-protocol.test.cjs` (revisore) e `revision-protocol-003b.test.cjs` coprono corpi differiti, 200 invalidi, init fallito con digitazione in volo e conflitti sconosciuti.
- **Fixture**: l'harness calcola `file_revision`/`file_exists` dalla presenza della snapshot, non dalla truthiness del contenuto (un file esistente vuoto ha la revisione dei byte vuoti).

## Incarico 003c — risultati tardivi di `/api/init` (implementato)

La prima handshake può tornare dopo che l'utente ha adottato un altro documento (Nuovo, apertura, **Save As nella stessa `docSession`**) o ha scritto. Il confronto della sola `docSession`, o del solo percorso, non bastava: Save As non cambia la sessione ma cambia percorso/baseline, e una scrittura muove la generazione.

- `bootDocumentCurrent(boot)`: `sameDocument` **e** `currentPath`, `diskRevision`, `savedRevision`, `writeEpoch` invariati rispetto alla cattura del boot. Decide se la risposta tardiva descrive ancora il documento sullo schermo (status/titolo/workspace possono essere toccati).
- `bootTextUntouched(boot)`: `bufferRevision` e contenuto invariati. Solo insieme a `bootDocumentCurrent` autorizza a sostituire o ripristinare il buffer (adozione del file, welcome text, reset di percorso/baseline).
- Tutti i rami di `initApp` (successo con file valido/vuoto, revisione invalida, `file_exists:false`, risposta non-2xx, eccezione di rete) applicano effetti documentali solo se `bootDocumentCurrent`; nessuno azzera percorso/baseline o riscrive lo status di un documento adottato nel frattempo e nessuno avvia scritture.
- Solo digitazione durante il boot (nessun documento adottato): il buffer resta senza titolo e dirty, il testo non viene sostituito, e per un init fallito/invalido l'errore viene mostrato come prima (comportamento 003b conservato).
- `active_dir` viene applicato come workspace solo se `bootDocumentCurrent`; token, `default_dir` e recents sono metadati globali innocui e vengono applicati sempre, separatamente dagli effetti sul documento.
- Il file realmente vuoto (revisione valida dei byte vuoti) resta adottabile; file mancante, snapshot illeggibile o revisione non valida non vengono mai presentati come documento aperto/pulito.

## Incarico 004 — protezione dei documenti in sola lettura (implementato)

### Policy backend
`writeProtection(path, snapshot)` è la policy applicativa condivisa da save, rename e metadati:
- file esistente con `mode & 0222 == 0` → **protetto** (`no_write_bits`), anche quando un processo privilegiato potrebbe sostituire l'inode via `rename(2)` (il salvataggio atomico non apre il file in scrittura);
- altrimenti un controllo di accesso effettivo (`open O_WRONLY` senza scrivere né troncare, chiusura immediata) intercetta EACCES/EROFS (`access_denied`/`write_unavailable`).
- Nessuna prova modifica contenuto, permessi, mtime o owner; nessun `chmod`/ripristino per aggirare il rifiuto.
- `read_only` è metadato di policy, **non** parte della fingerprint di contenuto: un file vuoto protetto resta una snapshot valida (hash dei byte vuoti + `read_only:true`).

**Limiti dichiarati**: `mode.Perm()` non esprime ACL Windows/POSIX, gruppi o mount option oltre la vista del processo. Per questi casi la protezione è consultiva e decide l'errore effettivo al momento della scrittura (`403 write_forbidden`). Non è una verifica ACL/Windows completa.

### API
- `/api/init`, `/api/file`, `/api/stat`: `read_only` + `read_only_reason` (consultivo). `/api/stat` ricalcola la policy a ogni poll, quindi rileva un cambio di permessi anche con contenuto/revisione identici. Assenza ed errore di lettura restano distinti.
- `/api/save`: `403 {error:"read_only", path, revision}` dopo la snapshot e **prima** dei controlli di conflitto; `force:true` scavalca un conflitto di contenuto, mai la protezione. Errori di permessi alla scrittura → `403 write_forbidden` (mai successo).
- `/api/rename`: `403 read_only` sul sorgente protetto prima di creare cartelle/destinazione/rimuovere (anche `old_path == new_path` e con `overwrite:true`); `403 read_only` su una destinazione esistente protetta anche con `overwrite:true` e `old_path` vuoto; `write_forbidden` per errori operativi. La **copia** usa `old_path:""`: il sorgente non viene mai scritto né rimosso. Revisioni, conflitti strutturati e `diskWriteMu` restano invariati.

### UI
- Editor `readOnly` + indicatore distinto `🔒 Sola lettura` / `🔒 Sola lettura — modifiche non salvate` (classe `readonly`).
- Blocchi programmatici: `replaceRange` (toolbar, formattazione, inserimento tabelle), `applyFormatting`, `insertMarkdownTable`, checkbox delle task in preview (`livePreview.readOnly`).
- Autosave sospeso senza dialoghi; quando la protezione compare durante l'editing il timer pendente viene cancellato, testo/revisioni/dirty/`beforeunload` restano intatti e non parte alcuna scrittura. Al ritorno scrivibile l'editor si sblocca senza salvare.
- `read_only` entra in `captureContext`/`unchangedSince` e nel watchdog: risposte tarde di stat/file non bloccano/sbloccano il documento nuovo; un `403 read_only` in volo blocca l'editor, mantiene il dirty e non diventa un conflitto da forzare.
- **Salva una copia**: su un documento protetto, `Ctrl+S`/«Salva con nome» apre il browser file in modalità copia (titolo esplicito, nome suggerito `*-copia.md`) e invia `/api/rename` con `old_path:""`; solo una conferma valida adotta percorso/revisione della copia e riabilita l'editing. Destinazione protetta rifiutata. Il Save As/rinomina dei documenti normali **non cambia** semantica (distinzione transitoria documentata).

### Test aggiunti
- Go (7): metadati 0444 su init/file/stat, save negato anche con force (bytes/mode/mtime/attivo/recents invariati), rename di sorgente protetto (stesso path/overwrite/cartella annidata) senza effetti, destinazione protetta con `overwrite:true` e `old_path` vuoto, copia da sorgente protetto, 0644/0640 normali con mode preservato, stat rileva il chmod con contenuto identico, errore di permessi alla scrittura → `write_forbidden` (skip mirato se root), file vuoto protetto valido.
- Frontend (7): documento protetto bloccato e senza edit/autosave, apertura/New/vecchio stat, dirty→readonly con autosave pendente e ritorno scrivibile, `403 read_only` in volo senza force, salva copia con sorgente intatto, destinazione protetta, risposta copia tardiva.

## Incarico 004b — errori operativi di permesso (implementato)

- **Rimozione del sorgente mai ignorata**: `sourceRemovalPreflight` rifiuta (`403 write_forbidden`) **prima** di creare cartelle o destinazione quando la directory del sorgente non ha bit di scrittura (POSIX; su Windows i bit sono sintetici e decide `os.Remove`). Dopo la scrittura, `removeSourceEntry` verifica `os.Stat`/`os.Remove`: un fallimento non produce mai 200. La risposta è strutturata con `error` (`write_forbidden` per permessi/EROFS, `write_failed` per I/O generico), `partial:true`, `path` della destinazione e messaggio «destination written, source not removed». Nessun aggiornamento di `activePath`/`activeDir`/recents, nessun rollback della destinazione (potrebbe cancellare il lavoro di un altro processo), sorgente preservato. La preflight non elimina il TOCTOU: se il permesso cambia dopo, l'errore operativo viene riportato con l'esito parziale.
- **EROFS**: `isReadOnlyFilesystem` (build tag: Unix `errors.Is(err, syscall.EROFS)`, Windows `false`) riconosce il filesystem read-only anche incapsulato in `*os.PathError`; `writeFailureStatus` mappa EACCES/EPERM/EROFS su `403 write_forbidden` e lascia gli errori di I/O generici a `500 write_failed`. Call site: save, rename (cartelle, destinazione, rimozione sorgente).
- **UI**: ogni rifiuto della rinomina chiude lo stato transitorio «Salvataggio…». Destinazione protetta → `⚠️ Destinazione in sola lettura` (sorgente editabile e dirty, nessun force, path/baseline invariati); sorgente protetto → indicatore `🔒 Sola lettura`; errore operativo → `⚠️ Scrittura non consentita`; esito parziale (`partial:true`) → `⚠️ Rinomina incompleta — sorgente non rimosso` con alert che dice che la destinazione è stata scritta e il sorgente no, senza promettere rollback. Nessun retry automatico.
- **Limiti**: non esiste una transazione atomica fra due percorsi; un fallimento dopo la scrittura della destinazione lascia due copie (segnalate, nessun rollback distruttivo). ACL Windows/POSIX e mount option non sono ispezionati: decide l'errore reale alla scrittura.

## Incarico 005 — Salva con nome ≠ Rinomina/Sposta (implementato)

- **Semantica**: «Salva con nome…» (menu e `Ctrl/Cmd+Shift+S`) scrive il **buffer corrente** in un nuovo percorso e **non rimuove** il sorgente; adotta la copia solo su conferma valida. «Salva una copia…» (documento protetto) ha la stessa semantica con dicitura esplicita. Il click sul titolo e il pulsante del dialogo sono «Rinomina/Sposta»: operazione distinta, soggetta a revisione sorgente, read-only, consenso destinazione ed esiti parziali 004b. Nessun secondo file browser.
- **Protocollo copia**: `/api/rename` accetta `source_path` quando `old_path` è vuoto. Il backend rifiuta con `409 {error:"conflict", conflict:"copy_same_source"}` una destinazione che identifica il sorgente: stesso percorso pulito, equivalenza via symlink (`copyIdentityPath`, dedicata alla copia) o stesso file esistente (`os.SameFile`, che copre conservativamente anche gli hard link). Sorgente mancante = copia dal buffer lecita; identità non verificabile per errore operativo = `503 snapshot_unstable` esplicito. La copia non scrive/rimuove mai il sorgente, non richiede la sua baseline e non tocca activePath/recents sui rifiuti. `old_path` valorizzato = rinomina, invariata (revisione, read-only, overwrite destinazione, esito parziale).
- **Controller/UI**: modalità distinte `rename` / `saveAs` / `saveCopy` (payload e testi, non solo il pulsante); `Ctrl+Shift+S` controllato **prima** di `Ctrl+S`; `Ctrl+S` resta Salva; titolo cliccabile = Rinomina/Sposta (per un buffer senza percorso apre il primo salvataggio). La copia conserva `old_path:""`, invia `source_path`, usa il buffer (non una rilettura del file), si serializza dietro le scritture in volo e adotta percorso/revisione solo su risposta valida. Edit durante/dopo la copia finiscono sulla copia tramite il follow-up esistente; nessuna scrittura al vecchio percorso. Annullamento/errore rete chiudono l'indicatore transitorio. `partial` è riconosciuto indipendentemente dallo status (403 e 500/altro) con messaggio locale + messaggio del server; nessun rollback/retry.
- **Limiti**: nessuna transazione atomica fra i due percorsi; la copia può coesistere con un sorgente cambiato o sparito (voluto, si copia il buffer); gli hard link sono rifiutati come alias per scelta conservativa; la policy generale di scrittura attraverso symlink e la preservazione ACL/owner/xattr restano fuori da questo incarico.

## Incarico 005b — copia non confermata e identità degli alias (implementato)

- **Debounce dopo copia non confermata**: quando una copia (`old_path` vuoto + `source_path`) fallisce — I/O 500, `copy_same_source`, `target_exists` negato, 403 read-only, 200 malformato, `partial`, errore di rete — `discardPendingAutosave` cancella il timer creato durante la copia e i flag `saveQueued`/follow-up, **solo** nel contesto ancora corrente (stessa `docSession` e stesso percorso). Gli edit restano nel buffer, dirty e `beforeunload` attivi, con status non transitorio. La pulizia è limitata al ramo copia: una **rinomina** fallita lascia il documento sul sorgente, quindi il normale autosave può riprendere come in 001. Un errore tardivo di un documento abbandonato non tocca timer/stato del nuovo; un nuovo edit riattiva l'autosave e `Ctrl+S` esplicito continua a funzionare. Sul percorso positivo (copia confermata) gli edit durante la richiesta sono salvati sulla copia, mai sul vecchio percorso; il caso difensivo "stale" non esegue follow-up.
- **Identità della copia su entrambi i lati**: `copyIdentityPath` (dedicata; `resolveForCompare` resta invariata per il confinamento degli asset) risolve catene di symlink con limite di 40 hop, link relativi/assoluti, directory symlink e target mancanti; ELOOP/EACCES/I/O sono restituiti come errore esplicito (`503 snapshot_unstable`), mai degradati a confronto lessicale. Il confronto usa path canonici + `os.SameFile` (hard link, filesystem case-insensitive, bind mount dello stesso inode). Un sorgente realmente assente resta copiabile; una destinazione realmente assente resta lecita; un loop di symlink in destinazione o un link dangling del sorgente verso un target assente vengono rifiutati (503 rispettivamente `copy_same_source`) **prima di ogni effetto**. Il preflight gira dentro `diskWriteMu`, ma non è un CAS del filesystem: mutazioni esterne fra verifica e scrittura restano possibili.
- **Test**: 2 Go (revisore) + 2 nostri (loop del sorgente, catena dangling breve, alias tramite directory symlink) e 4 frontend (revisore) + 4 nostri (errore di rete con Ctrl+S/nuovo edit, 200 malformato senza flush, partial con timer pendente e ripartenza su nuovo edit, errore tardivo che non cancella il debounce del nuovo documento).

## Incarico 005c — identità dei percorsi e consenso nella copia (implementato)

- **Risoluzione fisica dei symlink**: `copyIdentityPath` percorre i componenti del percorso invece di applicare `filepath.Join/Clean` al testo restituito da `Readlink`. Un target relativo è interpretato dalla directory **fisica** del link (symlink di directory inclusi) e `..` viene applicato dopo i symlink che lo precedono; un componente symlink prima di `..` non viene quindi ridotto lessicalmente. Quando un componente manca, il prefisso già risolto resta fisico e i componenti restanti sono applicati lessicalmente: `entry/missing/original.md` con `entry -> real` identifica `real/missing/original.md`, non il percorso lessicale. Limite finito di 40 hop; ciclo o errore operativo (ELOOP/EACCES/I/O) → `503 snapshot_unstable`; l'assenza reale di sorgente o destinazione resta lecita. `resolveForCompare` resta invariata per il confinamento degli asset.
- **Consenso per una destinazione dangling distinta**: nel solo flusso copia (`old_path` vuoto + `source_path`) il controllo `target_exists` usa `os.Lstat`: una directory entry esistente, anche un symlink con referente mancante, richiede `overwrite:true`. Alias, identità non verificabile e destinazione distinta protetta restano rifiutati prima del consenso, anche con overwrite. Con consenso esplicito viene sostituita la **entry** (il link), non il referente: il referente non viene creato e il sorgente non è toccato. Rinomina e Save As senza sorgente mantengono la policy precedente basata su `os.Stat`, fuori dal perimetro di questo incarico.
- **Test**: i 3 casi Go del revisore ora passano; aggiunti 3 test nostri (target con symlink prima di `..`, prefisso esistente di un target dangling, consenso/overwrite esplicito di una destinazione dangling distinta). Suite: **77 Go top-level, 0 fallimenti, 0 skip** con race/shuffle; **112 frontend, 0 fallimenti, 0 skip** dopo `npm ci`; vet, sintassi JS/CJS, diff check ed embed puliti.
- **Limiti**: la verifica resta un preflight sotto `diskWriteMu`, non un CAS del filesystem: un processo esterno può ancora mutare i percorsi fra verifica e `atomicWrite`. I test symlink sono saltati su Windows e non c'è esecuzione nativa Windows/macOS.

## Incarico 005d — Preservare i link necessari per aprire il sorgente (implementato)

- **Entry del sorgente = entry della destinazione**: `copyIdentityPathWithLinks` restituisce, oltre al referente risolto, i path canonici delle **entry symlink realmente attraversate** dal percorso sorgente, comprese quelle incontrate dentro un target di `Readlink`. `copyEntryIdentityPath` risolve i genitori della destinazione con lo stesso resolver finito ma **non segue il link finale**; `copyDestinationReplacesSourceLink` confronta le entry (path canonico + `os.SameFile` su `Lstat`, quindi alias della directory genitore e stesso inode) e rifiuta `409 copy_same_source` **prima di ogni effetto**, anche con `overwrite:true`. Il controllo resta distinto dal confronto dei referenti già presente.
- **Nessun allargamento**: la modifica è solo nel preflight del flusso copia; rename/save, confinamento degli asset e policy generale dei symlink restano invariati. La copia verso una destinazione indipendente e l'overwrite esplicito del link dangling distinto del 005c restano leciti. Il preflight gira sotto `diskWriteMu`, ma non è un CAS del filesystem.
- **Test**: il caso del revisore `TestReviewCopyCannotReplaceDirectoryLinkNeededBySource` ora passa; aggiunto `TestCopyRejectsDestinationThroughParentAliasOfSourceLink` (destinazione indicata attraverso un alias della directory genitore). Suite: **79 Go top-level, 0 fallimenti, 0 skip** con race/shuffle; **112 frontend, 0 fallimenti, 0 skip** dopo `npm ci`; vet, sintassi JS/CJS, diff check ed embed puliti.
- **Limiti**: mutazioni esterne fra preflight e `atomicWrite` restano possibili; i test symlink sono saltati su Windows e non c'è esecuzione nativa Windows/macOS.

## Incarico 006 — Mappatura affidabile delle checkbox Markdown (implementato)

- **Mappatura dal parser, non dall'indice DOM**: `livepreview.js` usa l'albero di token di Marked e i suoi `raw` per calcolare la posizione esatta del marcatore `[ ]`/`[x]`/`[X]` di ogni task. I riferimenti vengono tradotti attraverso mappe di contenuto per blockquote (prefissi `>` rimossi) e list item (rientro di continuazione rimosso), quindi liste puntate, numerate, annidate, in citazione e task duplicate conservano il proprio marcatore. Se un token non è localizzabile, se il numero/stato delle task non coincide fra sorgente mascherato e testo effettivamente renderizzato, o se il conteggio DOM non coincide, **nessuna checkbox diventa interattiva**: nessun fallback per indice o similarità di testo.
- **Provenienza della checkbox**: solo il renderer `checkbox` di Marked riceve un id per-render non prevedibile; le checkbox scritte nell'HTML del documento non hanno quel binding. Il sanitizzatore non è stato allentato e gli id sono rimossi subito dopo il binding. L'associazione vive in una `WeakMap`, non in classi o attributi controllabili dall'autore.
- **Stale/read-only/input**: il click richiede generazione del render corrente, nodo ancora nel container e `editor.value === renderedText`; un render nuovo riarma le task. Testo digitato durante il debounce, cambio documento (anche con testo identico) e nodi vecchi non modificano nulla. Il click valido sostituisce un solo carattere del marcatore, conserva il resto del buffer e invia **un** normale evento `input`, lasciando dirty/autosave/beforeunload al controller; la preview non salva direttamente. In sola lettura le checkbox sono `disabled` e il handler non edita.
- **Test**: nuovo `tests/frontend/task-checkbox-mapping.test.cjs` con 6 prove (marker `[x]` nel testo e `[X]`, blockquote/lista/numerata/annidata/duplicati, HTML e codice, debounce stale, cambio documento con testo identico, read-only contro scrittura con un solo input e autosave normale).
- **Limiti**: verifica jsdom, non browser nativo; il layout e il comportamento reale di click/tastiera non sono certificati. La mappatura è volutamente fail-closed su documenti in cui Marked non permette di localizzare il `raw` del token o in cui il sorgente mascherato e il testo renderizzato divergono nel numero/stato delle task. Go resta invariato (79 test).

## Revisione indipendente 006 — INCARICO 006 APPROVATO nel perimetro verificato

- **Metodo**: revisione del diff (`web/static/js/livepreview.js`, integrazione in `app.js`, `tests/frontend/task-checkbox-mapping.test.cjs`) e nuova suite indipendente `tests/frontend/review-task-checkbox-mapping.test.cjs` (11 prove) che usa controller, pagina, Marked e sanitizzatore reali in jsdom. Nessuna modifica al codice di produzione, nessun test esistente modificato o indebolito. Le asserzioni confrontano il **buffer completo**, non un estratto di riga.
- **1. Mappatura**: verificato che ogni checkbox domini esattamente il proprio marcatore in entrambe le direzioni, con `[x]`/`[X]` nel testo della stessa riga, task duplicate, liste puntate/numerate (`)` e `.`), annidate, in blockquote (anche annidati) e combinazioni blockquote + rientro + righe di continuazione. L'unica differenza ammessa nel click inverso è `[X]` → `[x]` (lo stato è normalizzato: il contratto fissa lo stato, non il case). In più, un fuzz indipendente con oracolo sulle label dei `<li>` ha eseguito **1787 click su task reali e 151 su checkbox d'autore** su 600 documenti generati (quote, liste, continuazioni, recinti, codice inline, math, HTML): **0 associazioni errate**.
- **2. Provenienza**: checkbox HTML d'autore (anche con `class="task-checkbox"`, `checked`, `disabled`, `tabindex="-1"`, `id` arbitrari e `id` che imita il prefisso pubblico `tc-task-*`) non modificano il buffer, non emettono `input`, non rendono dirty e non spostano l'associazione delle task vere (verificato con input prima, tra, dentro un item e dentro una citazione). Marker in prosa, codice inline, recintato e indentato non partecipano alla mappatura. Nessun fallback per indice DOM o similarità: la nona associazione incerta non esiste, si annulla l'intero binding.
- **3. Invalidazione**: click con preview in debounce (modifica di pari lunghezza altrove nella riga), su nodo staccato, su nodo di un render precedente e dopo cambio documento **con testo identico** in entrambe le direzioni: buffer invariato, zero `input`, nessun dirty, nessuna scrittura. Dopo il render corrente la task valida torna interattiva e il flusso prosegue (150 ms preview, 600 ms autosave, una sola scrittura con revisione attesa).
- **4. Read-only e flusso input**: in sola lettura le checkbox sono `disabled` e anche un `MouseEvent` inviato programmaticamente non modifica il buffer (guardia nel handler, oltre al `disabled`), nessun `input`, nessun `/api/save` anche dopo 1,2 s. Un click valido emette **esattamente un** `input`, non salva dalla preview, arma dirty/beforeunload/autosave e produce una sola `POST /api/save` con contenuto e `expected_revision` corretti. Un click ignorato non altera lo status, non rende dirty un documento pulito e non scrive.
- **Comandi rieseguiti**: `npm ci` + `npm test` in `tests/frontend` → **129 passati / 0 falliti / 0 skip** (118 consegnati + 11 del revisore, 6 esecuzioni con fuzz esterno non versionato); `go vet ./...` pulito; `go test -race -shuffle=on -count=1 ./...` → **79 passati / 0 falliti / 0 skip** (seed `1795535177954062534`); `TestEmbeddedWebAssetsExcludeDevFiles` dopo `npm ci` → PASS, **15 asset, zero file di sviluppo** in `web/`; `node --check` su tutti i `.js` di `web/static/js` e sui `.cjs` di `tests/frontend` (nessun `.mjs` presente) pulito; `git diff --check` pulito. Go non era installato nella macchina di revisione: usata toolchain temporanea `go1.22.12` (coerente con `go.mod`) sotto `/tmp`, nessuna modifica al repository; Docker non accessibile all'utente, quindi nessuna esecuzione containerizzata.
- **Limite osservato (non bloccante)**: con una lista annidata seguita da una riga di continuazione *lazy* meno rientrata del contenuto del genitore — caso minimo `1. [ ] a\n   - [ ] b\n c` (e la variante in blockquote) — Marked rende entrambe le task ma il localizzatore del `raw` fallisce e il render resta **fail-closed**: nessuna checkbox diventa interattiva, buffer/input/dirty/scritture invariati. È il comportamento previsto dal contratto («se la mappatura non è certa, nessuna modifica») e non produce edit errati; le checkbox restano però abilitate e silenziosamente inerti (rifinitura UX, fuori dal perimetro di integrità). Le forme realistiche (continuazione al rientro del genitore o del contenuto, liste loose, annidamenti multipli) sono interattive e mappate correttamente.
- **Non eseguito / non certificato**: nessuna prova in browser nativo (jsdom non riproduce layout, hit-testing, attivazione dei controlli `disabled` né tastiera): l'attivazione reale del click resta non certificata. Nessuna esecuzione su Windows/macOS. Non sono stati verificati recinti/outline, link/shortcut, backend, packaging o versioning, per esplicito perimetro.
- **Verdetto**: **006 APPROVATO nel perimetro verificato**.

## Incarichi 007–009 — Bug rimanenti implementati e verificati

- **007 — Recinti e outline**: Marked decide apertura/chiusura dei recinti, incluso il delimitatore più lungo, tilde, citazioni, liste e recinti non chiusi. Il renderer mantiene classi CSS/lingua e pulsante Copy; la copia conserva il testo del codice, righe vuote comprese. L'outline usa i token di Marked (anche Setext) e risale alla posizione nel buffer prima delle sostituzioni math; titoli omonimi restano distinguibili e gli ID generati sono univoci, stabili e compatibili con il sanitizzatore. Nessun edit con checkbox non mappate: ora sono anche visibilmente disabilitate, compreso il caso lazy annotato dal revisore del 006. Prove in `tests/frontend/fences-outline.test.cjs`.
- **008 — Link e shortcut**: i click, incluso il tasto centrale, non navigano la finestra dell'editor. I frammenti scorrono solo nella preview senza cambiare cronologia; link esterni supportati si aprono con `noopener,noreferrer`. I documenti locali, inclusi `.mdx` e `file:///` senza authority, si aprono tramite il controller. Il percorso viene decodificato una sola volta: i frammenti letterali vengono scartati e le query locali, i percorsi di rete e i link non supportati non vengono aperti. `Ctrl/Cmd+Shift+O` seleziona l'outline o lo chiude se già visibile; `Ctrl/Cmd+O` resta Apri. Prove in `tests/frontend/preview-links.test.cjs` e `tests/frontend/outline-shortcut.test.cjs`.
- **009 — Packaging**: `make appimage` cerca `appimagetool` nel `PATH` o usa `APPIMAGETOOL=…`, compila un ELF Linux amd64 nuovo e lo prepara in uno staging privato sotto `DIST_DIR`. Pubblica l'output solo a successo e non tocca l'artefatto precedente su errore. `make install-appdir` aggiorna il binario locale ignorato in `TypeCraft.AppDir/`; l'AppImage non lo usa. `tests/packaging-smoke.sh` verifica struttura, architettura, pubblicazione e pulizia con packager simulato. Il binario storico e l'AppImage preesistente non sono stati toccati.
- **Verifica integrata**: dopo `npm ci`, **146 test frontend** passati (17 nuovi); **79 test Go** con `-race -shuffle=on -count=1`; zero fallimenti o skip. `go vet`, sintassi JS/CJS e shell, `git diff --check`, esclusione degli asset di sviluppo (15 asset embedded) e smoke test packaging passati. Cross-build verificati per Linux amd64/arm64, macOS amd64/arm64 e Windows amd64, con artefatti temporanei rimossi; `install-appdir` provato in copia isolata.
- **Limiti della verifica 007–009**: verifica frontend in jsdom, non in browser nativo; cross-build non equivalenti a esecuzione nativa. In quella fase `appimagetool` non era disponibile. Nessun incremento versione o rilascio; funzionalità opzionali fuori perimetro.

## Pacchetti Linux x86_64 — build locale 1.0.3

- `make deb`, `make rpm` e `make linux-packages` generano i pacchetti con `dpkg-deb`, `rpmbuild` e `appimagetool`. I formati nativi includono binario, desktop entry, icona e licenze; non eseguono script di installazione aggiuntivi.
- Generati in `dist/`: `typecraft_1.0.3-1_amd64.deb`, `typecraft-1.0.3-1.x86_64.rpm` e `TypeCraft-x86_64.AppImage`. `dist/SHA256SUMS` verificato con `sha256sum -c`. AppImage costruita con l'`appimagetool` ufficiale 1.9.1 e un runtime Type 2 verificato con il digest pubblicato da GitHub.
- Verificati metadati, dipendenza `xdg-utils`, digest RPM, struttura estratta, ELF x86-64 e risposta `-version` in tutti e tre i formati. Per ciascuno il server reale si è avviato in un HOME temporaneo e ha aperto un documento Markdown verificato via HTTP locale. L'AppImage è stata eseguita con `APPIMAGE_EXTRACT_AND_RUN=1`.
- Non eseguita un'installazione completa in Fedora/Ubuntu nativi, né una prova FUSE o desktop grafica. I pacchetti sono locali, non firmati e non pubblicati.
