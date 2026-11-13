# TypeCraft ✍️

**L'editor Markdown minimalista, senza distrazioni e ad alte prestazioni per tutte le piattaforme.**

TypeCraft unisce la pura concentrazione e la celebre **modalità macchina da scrivere con Focus Mode** di **iA Writer** con l'eccezionale **Live Preview ibrida** di **Typora**, poggiando sulla solidissima architettura **single-binary a zero dipendenze** collaudata in **PubCraft**.

---

## 🌟 La Sintesi Perfetta

### Da iA Writer:
- **Scorrimento Continuo a Macchina da Scrivere**: La riga attiva di scrittura rimane perfettamente fissata al centro dello schermo (a 45vh). Man mano che scrivi o premi invio, il testo scorre morbidamente sotto le tue dita grazie a un algoritmo di centratura in sub-pixel (`requestAnimationFrame` + calcolo esatto del caret tramite *mirror element*).
- **Focus Mode a 3 Livelli (Frase / Paragrafo / Spento)**: Con `Ctrl+D` isoli la frase o il paragrafo che stai componendo. Tutto il testo circostante viene delicatamente attenuato (opacità 30%), eliminando il sovraccarico visivo e focalizzando il flusso di pensiero.
- **Tipografia d'Autore Integrata**: Include i font originali **iA Writer Mono**, **iA Writer Duo** e **iA Writer Quattro**, oltre ai caratteri serif editoriali **EB Garamond** e **Lora**.
- **Feedback Tattile Meccanico (Audio Web API)**: Premi `Ctrl+Alt+T` per attivare il leggero ticchettio sintetico da macchina da scrivere d'epoca e il ritorno a capo a campana (completamente sintetizzato via codice, zero file audio esterni o ritardi).
- **Interfaccia Zen Invisibile**: Quando inizi a scrivere, ogni barra di stato, menu e conteggio svanisce dolcemente. Basta muovere il cursore o premere Esc per riattivare la pulsantiera.

### Da Typora:
- **Live Preview Ibrida Fluida**: Passa istantaneamente dalla modalità pura testo (`Ctrl+1`) all'anteprima formattata (`Ctrl+2`) o alla visualizzazione affiancata sincronizzata (`Ctrl+3`).
- **Elenchi Puntati e Task List Interattive**: I checkbox `- [ ]` e `- [x]` si renderizzano graficamente e sono **cliccabili direttamente a schermo**: cliccando su una casella, il Markdown sottostante si aggiorna in tempo reale salvando il documento!
- **Tabelle Formattate**: Le tabelle Markdown (`| col1 | col2 |`) vengono presentate con bordi arrotondati, testate distinte e righe alternate zebrate.
- **Blocchi di Codice con Tasto Copia**: Evidenziazione sintattica pulita con pulsante "Copy" rapido incorporato.
- **Formule Matematiche**: Il TeX inline `$E=mc^2$` e in blocco `$$\int f(x)dx$$` è protetto dal parsing Markdown e mostrato come sorgente TeX formattato. *KaTeX non è ancora incluso nel binario (vedi Roadmap): le formule non vengono impaginate.*
- **Immagini Locali**: `![alt](./img.png)` viene risolto rispetto alla cartella del documento e servito dall'app (niente immagini rotte né percorsi indovinati).
- **Indice Dinamico (Outline TOC)**: Barra laterale scorrevole (`Ctrl+Shift+O`) che estrae in tempo reale la gerarchia dei titoli da `# H1` a `###### H6`, permettendo di saltare all'istante a qualsiasi sezione.

### Dall'Ingegneria di PubCraft:
- **Binario Unico Portatile**: Nessuna dipendenza da Electron, Node.js o librerie C pesanti. Un solo file eseguibile compilato in Go che racchiude interamente l'interfaccia web e i font.
- **Avvio Istantaneo (< 50 ms)** e consumo di memoria irrisorio (< 25 MB RAM).
- **Gestione Documento in Stile macOS / PubCraft**: Cliccando sul nome del file nella barra superiore Zen HUD (o con `Ctrl+Shift+S`) si apre il selettore interattivo per rinominare o salvare con nome: navigazione completa tra le cartelle su disco con breadcrumb cliccabili, scorciatoie rapide (📁 Workspace, 📄 Documenti, 🖥️ Scrivania, 📥 Download, 🏠 Home), pulsante per creare nuove cartelle e filtro di ricerca in tempo reale.
- **Finestra Desktop Nativizzata**: Rileva automaticamente Google Chrome, Chromium, Brave o Microsoft Edge per avviare TypeCraft in modalità `--app` a finestra indipendente senza cornici da browser (oppure nel browser di sistema).
- **Salvataggio Atomico & Sicurezza Locale**: Nessun cloud forzato. I file restano tuoi sul tuo disco, con salvataggio atomico a due fasi (file `.tmp` e rename) per garantire zero perdite di dati anche in caso di interruzione improvvisa.

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
- **Le checkbox delle task list sono davvero cliccabili**: `marked` emette input `disabled`, che non generano mai l'evento `click`; inoltre il gestore contava anche i `[x]` nel testo normale e poteva barrare la riga sbagliata. Entrambi corretti.
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
- **Token confrontato a tempo costante** (`subtle.ConstantTimeCompare`).

**Dati**
- **Il salvataggio conserva i permessi del file** (prima ogni save trasformava un `0644`/`0640` in `0600`) e fa `fsync` anche sulla cartella.
- **"Salva con nome" non sovrascrive più in silenzio**: il backend risponde `409` e sostituisce solo dopo conferma (`overwrite: true`).
- **L'estensione scritta non viene più riscritta a forza** (il bug che Typora ha corretto in 1.13.7): estensioni non Markdown = `400` con l'elenco ammesso, con una domanda esplicita solo quando sembra davvero un tipo di file.
- **Watchdog delle modifiche esterne** (`/api/stat`, ogni 5 s, il bug Typora 1.13.7): se il buffer è pulito si ricarica (`● Ricaricato dal disco`), se stai scrivendo mostra `⚠️ Cambiato su disco` senza toccare una riga; e un file aperto all'avvio legge subito il proprio `mtime`, quindi il primo auto-salvataggio non salta più il controllo di conflitto.

**Ingegneria**
- 6 nuovi test di regressione (19 in totale, `go test ./...` verde, `go vet` pulito).

---

## 🗺️ Roadmap (gap rispetto a iA Writer / Typora)

- Includere KaTeX per l'impaginazione reale delle formule (e Mermaid per i diagrammi).
- Trova & sostituisci nel documento (con regex) e obiettivo di parole.
- Syntax Control / Style Check (l'analisi grammaticale via NLP non è portabile in Go; un controllo a dizionario di cliché/filler è fattibile).
- Editing tabelle (aggiungi/rimuovi riga e colonna), drag & drop immagini.
- Libreria/cartelle in sidebar con pin e filtri smart (`#tag`), export PDF/DOCX via Pandoc.
