# TypeCraft ✍️

**Un editor Markdown locale per scrivere senza distrazioni.**

Scrivi in Markdown e passa dal sorgente all’anteprima o alla vista affiancata. Lo scorrimento a macchina da scrivere e la messa a fuoco per frase o paragrafo ti aiutano a restare sul testo. I documenti restano normali file sul disco: non serve un account. Un unico eseguibile Go serve l’interfaccia nel browser.

[Scarica per Linux x86_64](https://github.com/massigent/typecraft/tree/downloads/v1.0.3) · [Note di rilascio](docs/releases/v1.0.3.md) · [English](README.md)

---

## Funzionalità

### Scrittura senza distrazioni
- **Scorrimento Continuo a Macchina da Scrivere**: La riga attiva di scrittura rimane perfettamente fissata al centro dello schermo (a 45vh). Man mano che scrivi o premi invio, il testo scorre morbidamente sotto le tue dita grazie a un algoritmo di centratura in sub-pixel (`requestAnimationFrame` + calcolo esatto del caret tramite *mirror element*).
- **Focus Mode a 3 Livelli (Frase / Paragrafo / Spento)**: Con `Ctrl+D` isoli la frase o il paragrafo che stai componendo. Tutto il testo circostante viene delicatamente attenuato (opacità 30%), eliminando il sovraccarico visivo e focalizzando il flusso di pensiero.
- **Tipografia d'Autore Integrata**: Include i font originali **iA Writer Mono**, **iA Writer Duo** e **iA Writer Quattro**, oltre ai caratteri serif editoriali **EB Garamond** e **Lora**.
- **Feedback Tattile Meccanico (Audio Web API)**: Premi `Ctrl+Alt+T` per attivare il leggero ticchettio sintetico da macchina da scrivere d'epoca e il ritorno a capo a campana (completamente sintetizzato via codice, zero file audio esterni o ritardi).
- **Interfaccia Zen Invisibile**: Quando inizi a scrivere, ogni barra di stato, menu e conteggio svanisce dolcemente. Basta muovere il cursore o premere Esc per riattivare la pulsantiera.

### Markdown e anteprima
- **Live Preview Ibrida Fluida**: Passa istantaneamente dalla modalità pura testo (`Ctrl+1`) all'anteprima formattata (`Ctrl+2`) o alla visualizzazione affiancata sincronizzata (`Ctrl+3`).
- **Elenchi Puntati e Task List Interattive**: I checkbox `- [ ]` e `- [x]` si renderizzano graficamente e sono **cliccabili direttamente a schermo**: cliccando su una casella, il Markdown sottostante si aggiorna in tempo reale salvando il documento!
- **Tabelle Formattate**: Le tabelle Markdown (`| col1 | col2 |`) vengono presentate con bordi arrotondati, testate distinte e righe alternate zebrate.
- **Blocchi di Codice con Tasto Copia**: Evidenziazione sintattica pulita con pulsante "Copy" rapido incorporato.
- **Formule Matematiche**: Il TeX inline `$E=mc^2$` e in blocco `$$\int f(x)dx$$` è protetto dal parsing Markdown e mostrato come sorgente TeX formattato. *KaTeX non è ancora incluso nel binario (vedi Roadmap): le formule non vengono impaginate.*
- **Immagini Locali**: `![alt](./img.png)` viene risolto rispetto alla cartella del documento e servito dall'app (niente immagini rotte né percorsi indovinati).
- **Indice Dinamico (Outline TOC)**: Barra laterale scorrevole (`Ctrl+Shift+O`) che estrae in tempo reale la gerarchia dei titoli da `# H1` a `###### H6`, permettendo di saltare all'istante a qualsiasi sezione.

### Uso locale
- **Un eseguibile Go:** non richiede Electron o Node.js. L’interfaccia usa il browser.
- **Avvio desktop:** usa la modalità finestra autonoma dei browser compatibili oppure apre il browser di sistema.
- **Protezione dei file:** il salvataggio sostituisce il file atomicamente, rileva le modifiche esterne e rispetta la sola lettura. «Salva con nome» crea una copia; il titolo permette di rinominare o spostare il file.

---

## 🎨 4 Temi d'Autore

1. **☀️ iA Clean (Chiaro)**: Carta bianco puro con inchiostro scuro e accento ciano elettrico iA.
2. **📜 Sepia Paper (Caldo)**: Tonalità carta antica rilassante per gli occhi durante le lunghe sessioni notturne.
3. **🌙 Typora Night (Ardesia)**: Grigio fumo scuro ad alto contrasto per ambienti poco illuminati.
4. **⬛ OLED Pure Black**: Nero assoluto (`#000000`) per display moderni con accento azzurro fluorescente.

---

## ⌨️ Scorciatoie da Tastiera

| Scorciatoia | Funzione |
| :--- | :--- |
| **Ctrl + S** (o Cmd+S) | Salva file istantaneamente |
| **Ctrl + Shift + S** | Salva con nome (scegli un nuovo percorso) |
| **Ctrl + O** (o Cmd+O) | Apri file Markdown da disco |
| **Ctrl + N** (o Cmd+N) | Nuovo documento vuoto |
| **Ctrl + P** | Stampa / Salva come PDF (anteprima sempre renderizzata) |
| **Ctrl + D** (o Cmd+D) | Alterna Focus Mode: Spento ➔ Frase ➔ Paragrafo |
| **Ctrl + T** (o Cmd+T) | Alterna scorrimento fisso Macchina da Scrivere |
| **Ctrl + Alt + T** | Attiva / disattiva suono meccanico tasti |
| **Ctrl + Shift + O** | Apri / Chiudi Indice Documento (Outline) |
| **Ctrl + 1** | Modalità Focus Raw (Scrittura pura iA Writer) |
| **Ctrl + 2** | Modalità Live Preview (Anteprima formattata Typora) |
| **Ctrl + 3** | Modalità Dual Split (Editor + Anteprima affiancati) |
| **Ctrl + B** | Grassetto (`**testo**`) |
| **Ctrl + I** | Corsivo (`*testo*`) |
| **Ctrl + U** | Sottolineato (`<u>testo</u>`) |
| **Ctrl + K** | Inserisci Link (`[testo](url)`) |
| **F11** | Modalità Zen Schermo Intero |
| **Esc** | Chiudi menu, cassetti o ripristina HUD |

---

## 🚀 Compilazione ed Esecuzione

### Esecuzione Immediata (Linux):
```bash
./typecraft
```
Oppure aprendo direttamente un file markdown specifico:
```bash
./typecraft ~/Documenti/Articolo.md
```

### Compilazione per Tutte le Piattaforme:
Grazie a Go e al `Makefile` configurato:
```bash
# Compilazione per la piattaforma corrente
make build

# Cross-compilazione per tutte le piattaforme (Linux amd64/arm64, macOS amd64/arm64, Windows x64)
make cross-compile
```
I binari compilati saranno posizionati nella cartella `dist/`:
- `typecraft-linux-amd64`
- `typecraft-linux-arm64`
- `typecraft-macos-amd64`
- `typecraft-macos-arm64`
- `typecraft-windows-amd64.exe`

### Creazione dell'AppImage (Linux):
`make appimage` richiede `appimagetool` nel `PATH` (oppure `APPIMAGETOOL=/percorso/appimagetool`).
Compila sempre un binario Linux amd64 ELF aggiornato, prepara desktop file, icona e `AppRun` in una
cartella temporanea privata sotto `dist/` e pubblica `dist/TypeCraft-x86_64.AppImage` solo a build riuscita:

```bash
make appimage

# Override facoltativi
make appimage APPIMAGETOOL=/percorso/appimagetool DIST_DIR=release
```

`make install-appdir` compila un binario Linux amd64 aggiornato in
`TypeCraft.AppDir/usr/bin/typecraft` per i test locali del desktop; l'AppImage non usa questo file.
In caso di errore la staging e l'AppImage parziale vengono rimosse, lasciando intatto l'artefatto precedente.

### Pacchetti Linux nativi (x86_64)

`make deb` usa `dpkg-deb`, `make rpm` usa `rpmbuild`; `make linux-packages` crea tutti e tre i formati in `dist/`. I target non installano dipendenze sul sistema.

```bash
# Ubuntu
sudo apt install ./dist/typecraft_1.0.3-1_amd64.deb

# Fedora
sudo dnf install ./dist/typecraft-1.0.3-1.x86_64.rpm

# AppImage (non richiede installazione)
chmod +x dist/TypeCraft-x86_64.AppImage
./dist/TypeCraft-x86_64.AppImage
```

Su un sistema senza FUSE, avvia l'AppImage con `APPIMAGE_EXTRACT_AND_RUN=1`. Dopo aver installato il DEB o l'RPM, cerca **TypeCraft** nel menu applicazioni o esegui `typecraft`.

### Opzioni da Riga di Comando:
- `./typecraft [file.md]` : Apre immediatamente il file indicato.
- `./typecraft [cartella]` : Apre la cartella come spazio di lavoro (workspace).
- `./typecraft -port 8080` : Imposta una porta fissa invece della selezione automatica.
- `./typecraft --no-browser` : Avvia solo il motore server locale (ideale per server o sessioni remote).
- `./typecraft -version` : Mostra la versione installata.

---

## 🔧 Novità della 1.0.2

Revisione condotta confrontando il codice con build reali di iA Writer e Typora:

**Correttezza e sicurezza dei dati**
- **L'inoltro a istanza singola ora funziona**: aprendo un secondo file dal file manager il nuovo processo usciva e la finestra già aperta non ne sapeva nulla (il percorso veniva scritto come testo grezzo sulla porta HTTP). Ora l'istanza primaria lo riceve su un canale di controllo autenticato e la UI apre il file via Server-Sent Events.
- **Chiudere la finestra non blocca più l'avvio**: il server restava acceso senza interfaccia, quindi ogni avvio successivo (doppio clic sull'AppImage, icona del menu) rispondeva "già in esecuzione" e non mostrava nulla. Ora un avvio senza finestre collegate riapre la UI.
- **Il Markdown viene sanitizzato prima del rendering**: `marked` lasciava passare l'HTML grezzo, quindi un documento aperto da qualsiasi cartella poteva eseguire script nell'origine dell'app — che detiene il token dell'API file. Ora gira una allow-list rigida (tag, attributi, schemi URL, niente `on*`, niente `style`), più CSP, `Referrer-Policy: no-referrer` e `X-Frame-Options: DENY`.
- **La stampa dalla modalità Focus non produce più una pagina bianca** (`.pane.hidden` vinceva sulla regola di stampa) e il layout di stampa non viene più tagliato a una schermata.
- **L'export HTML** non contiene più i pulsanti "Copy" dei blocchi di codice e non esporta più un'anteprima vuota o vecchia.
- **L'auto-salvataggio non apre più il dialogo "Salva con nome"** sul documento di benvenuto; un buffer senza titolo resta senza titolo finché non chiedi tu un percorso, e un conflitto su disco durante l'auto-salvataggio non blocca più con un modale.
- **Le modifiche non salvate sono protette** da un guardiano `beforeunload`.

**Funzionalità corrette**
- **Le checkbox delle task list cambiano solo il marcatore giusto**: ogni task Markdown è mappata tramite l'albero di token di Marked al preciso marcatore nel buffer (liste puntate, numerate, annidate, in citazione e task duplicate, incluso `[X]`). `[x]` nel testo, HTML dell'autore, codice inline/recintato/indentato e preview stale non possono spostare o autorizzare un edit; i click ignorati non sporcano il documento e le task in sola lettura sono disabilitate.
- **Segno di spunta visibile** (un `::after` su un `<input>` non viene mai renderizzato) e **il Focus Mode non fa più scivolare il testo** rispetto al caret (la riga evidenziata aveva un peso maggiore, che cambia la larghezza dei glifi).
- **I link si aprono nel browser esterno** invece di far navigare via l'editor, e i link ad altri file `.md` locali si aprono dentro TypeCraft.
- **Immagini locali** risolte rispetto al documento (`/api/asset`), con segnaposto per le immagini mancanti.
- **Math** viene messo da parte prima del parsing Markdown, quindi `$x_1 * y_2$` non viene più trasformato in enfasi; le formule in blocco non lasciano più paragrafi vuoti.
- **Tema, font, typewriter, focus e suono vengono ripristinati** nell'interfaccia all'avvio.
- **Percorsi Windows**: titoli, recenti e "salva con nome" non si rompono più sul separatore `\`.
- **Le scorciatoie grassetto/corsivo/link preservano l'undo** (`execCommand` invece di sovrascrivere `.value`).
- **I documenti vuoti si aprono vuoti** invece di essere sostituiti dal testo di benvenuto.
- Le estensioni `.mkd/.mdwn/.mdx` appaiono ora nell'albero dei file (l'API le accettava ma la lista le nascondeva).

**Ingegneria**
- Il server guadagna `ReadHeaderTimeout`/`IdleTimeout`, header di sicurezza e gli endpoint `/api/events`, `/api/asset`, `/api/internal/open`.
- 6 nuovi test di regressione (`go test -race`).

---

## 🔧 Novità della 1.0.3

Revisione condotta sul codice con prove eseguibili (motore reale in jsdom + binario interrogato via HTTP).
Dettaglio completo in `REVIEW-1.0.3.md`.

**Bug visibili**
- **I blocchi di codice ora sono blocchi di codice**: in Live Preview il codice veniva staccato dal Markdown, poi reimmesso come *sorgente*, quindi a schermo comparivano i backtick letterali (` ```js ` dentro un `<p>`) senza `<pre>`, senza evidenziazione e senza pulsante "Copy". Ora il recinto viene reso in HTML al momento dello stacco: `<pre class="code-block"><code class="language-xx">`, con contenuto escapato e recinti non chiusi tollerati. Anche il codice inline ha il suo `<code>`.
- **Il documento senza titolo non scrive più file di nascosto**: la prima digitazione sul testo di benvenuto creava `~/Documenti/Documento.md` e le sessioni successive lo sovrascrivevano. Ora l'auto-salvataggio non inventa percorsi, lo stato resta `○ Non salvato` e `Ctrl+S` chiede il nome.
- **`Ctrl+Alt+T` (suono) funziona anche su macOS**: con Option premuto `e.key` è `†`, la scorciatoia non scattava mai; ora usa `e.code`.

**Sicurezza**
- **`/api/asset` confinato alla cartella del documento**: serviva qualsiasi immagine del disco (anche `.svg`) pur dichiarando il contrario; ora usa `pathWithin()` con risoluzione dei symlink.
- **`/api/rename` non cancella più file arbitrari**: `old_path` deve essere un documento Markdown.
- **Difesa anti-DNS-rebinding corretta**: `http://127.0.0.1.evil.com` e `http://localhost.evil.com` passavano il controllo a prefisso; ora si confronta l'host esatto.
- **Confine Host/Origin completato**: ogni richiesta — pagina, `/static/*`, handshake `/api/init`, API con token, `/api/events`, `/api/internal/open` e percorsi sconosciuti — deve usare l'authority effettiva del listener (`127.0.0.1:<porta>` o `localhost:<porta>`, hostname senza distinzione di maiuscole). Un token valido non autorizza un Host estraneo: un nome da DNS-rebinding che risolve su 127.0.0.1 riceve `403` prima che venga servito qualsiasi contenuto o token. Se `Origin` è presente deve essere same-origin (stesso schema, host e porta; niente userinfo, path, query, frammenti o valori multipli); se manca, la richiesta passa solo dopo un Host valido e richiede comunque il token dell'API (o il control secret del canale interno). `Forwarded`/`X-Forwarded-*` non danno fiducia e i rifiuti conservano gli header di sicurezza. È un confine loopback locale, non un isolamento da altri processi dello stesso utente.
- **Token confrontato a tempo costante** (`subtle.ConstantTimeCompare`).

**Dati**
- **Il salvataggio conserva i permessi del file** (prima ogni save trasformava un `0644`/`0640` in `0600`) e fa `fsync` anche sulla cartella.
- **"Salva con nome" non sovrascrive più in silenzio**: il backend risponde `409` e sostituisce solo dopo conferma (`overwrite: true`).
- **L'estensione scritta non viene più riscritta a forza** (il bug che Typora ha corretto in 1.13.7): estensioni non Markdown = `400` con l'elenco ammesso, con una domanda esplicita solo quando sembra davvero un tipo di file.
- **Watchdog delle modifiche esterne** (`/api/stat`, ogni 5 s, il bug Typora 1.13.7): se il buffer è pulito si ricarica (`● Ricaricato dal disco`), se stai scrivendo mostra `⚠️ Cambiato su disco` senza toccare una riga.
- **Salvataggi e conflitti usano revisioni opache di contenuto** (`sha256:<hex>` dei byte del file) invece dei timestamp: una modifica esterna viene rilevata anche con `mtime` e dimensione identici, un salvataggio con baseline vecchia riceve un `409` strutturato (mai una sovrascrittura silenziosa), un file eliminato su disco non viene ricreato e una rinomina verifica prima la revisione sorgente. `mod_time` resta metadato; i timestamp interi fuori precisione non sono più la baseline. `/api/stat` ora calcola l'hash del file a ogni poll (una lettura per finestra ogni 5 s): è il costo per rilevare modifiche con metadata identici. I client API legacy che inviavano solo `mod_time` devono leggere una revisione e mandare `expected_revision` (altrimenti `428 revision_required`).
- **I documenti in sola lettura sono protetti dal backend, non solo dalla UI**: un file senza bit di scrittura (o senza accesso effettivo in scrittura per il processo) viene esposto come `read_only` e non può essere salvato, rinominato o sostituito dal salvataggio atomico, nemmeno con un override esplicito di un conflitto di contenuto; anche una destinazione protetta viene rifiutata. L'editor si blocca (toolbar, tabelle e checkbox delle task comprese), l'autosave è sospeso e il comando esplicito **Salva una copia** crea un nuovo documento con `old_path` vuoto, senza mai modificare o cancellare l'originale. I bit POSIX sono la policy applicativa; ACL Windows/POSIX oltre la vista del processo restano consultive e si manifestano come errore `write_forbidden` al momento della scrittura (anche un filesystem read-only, `EROFS`). Una rinomina richiede il diritto di rimuovere il file dalla directory di origine, non solo l'accesso in scrittura al file: se la destinazione è stata scritta ma il sorgente non può essere rimosso, la risposta è un errore esplicito di **esito parziale** (sorgente conservato, nessun rollback automatico, nessun passaggio del documento attivo), mai un falso successo.
- **Salva con nome non sposta più il file**: «Salva con nome» (`Ctrl/Cmd+Shift+S` o il menu) scrive il buffer corrente in un nuovo percorso e lascia intatto il sorgente; solo «Rinomina / Sposta» (click sul titolo) sposta il file, e solo a successo completo. Il salvataggio con nome invia un `source_path` esplicito e il backend rifiuta una destinazione che identifica il sorgente (stesso percorso, alias symlink, stesso file/hard link), quindi una copia non può mai sovrascrivere l'originale (catene di symlink, link dangling, cartelle symlink e hard link vengono rifiutati o falliscono in modo esplicito; il dialogo suggerisce un nome `*-copia.md`). Una destinazione che è una entry symlink attraversata dal percorso sorgente (per esempio una cartella link necessaria per raggiungere l'originale) viene rifiutata come `copy_same_source` anche se i referenti finali sono diversi o è attivo `overwrite`. I target relativi sono risolti dalla directory fisica del link, comprese le cartelle symlink e il prefisso esistente di un percorso mancante; una destinazione distinta la cui entry esiste ma il cui referente manca richiede comunque un consenso esplicito all'overwrite. Annullare o una destinazione negata lascia intatti sorgente e buffer dirty, e gli edit digitati mentre una copia non confermata era pendente restano nel buffer invece di finire con l'autosave sul sorgente. All'avvio un file attivo illeggibile viene segnalato invece di apparire come documento vuoto e pulito, e una risposta del server non conforme al protocollo lascia il buffer dirty con un avviso esplicito (nessuna adozione di percorso/baseline, nessun retry alla cieca).

**Ingegneria**
- Suite di regressione corrente: 79 test Go di primo livello (`go test -race -shuffle=on ./...`) e
  118 test frontend dopo `npm ci`; `go vet`, sintassi JS/CJS/MJS e `git diff --check` puliti.
- La verifica dell'identità della copia è un preflight serializzato con le scritture di questo
  processo, **non** un CAS del filesystem: un processo esterno può ancora mutare i percorsi fra la
  verifica e la scrittura atomica. Le catene di symlink sono limitate (40 hop) e gli hard link sono
  rifiutati conservativamente come alias.

---

## 🗺️ Roadmap (gap rispetto a iA Writer / Typora)

- Includere KaTeX per l'impaginazione reale delle formule (e Mermaid per i diagrammi).
- Trova & sostituisci nel documento (con regex) e obiettivo di parole.
- Syntax Control / Style Check (l'analisi grammaticale via NLP non è portabile in Go; un controllo a dizionario di cliché/filler è fattibile).
- Editing tabelle (aggiungi/rimuovi riga e colonna), drag & drop immagini.
- Libreria/cartelle in sidebar con pin e filtri smart (`#tag`), export PDF/DOCX via Pandoc.
