# TypeCraft 1.0.1 → 1.0.2 — Revisione, bug e allineamento a iA Writer / Typora

Data: revisione eseguita su `/home/massimo/Scaricati/software/typecraft`
Metodo: lettura statica del codice di TypeCraft + studio di build reali di **Typora 1.14.9** (Electron,
`.deb` → `/usr/share/typora`) e **iA Writer 8.1.2** (nativo macOS, `.app`) con **CraftAnything**
(`core_target_open`, `js_app_map`, `core_archive_show`, `native_strings_find`), più prove
d'esecuzione locali (`go test -race`, `chromium --headless`).

---

## 1. Cosa ho estratto dai due riferimenti

### 1.1 iA Writer 8.1.2 (nativo, AppKit + Swift)

Evidenze: `Frameworks/Kit.framework/Versions/A/Kit` (stringhe ObjC e chiavi di localizzazione),
`en.lproj/Localizable.strings` (plist binario, 148 chiavi), `iA Writer.sdef`, `Base.lproj/*.nib`.

| Area | Meccanismo osservato |
| :--- | :--- |
| Editor | `IATextController` applica **stili sul testo** (`applyMarkdownStylesInRange:`, `applyCodeStyles…`) — non c'è un pannello di anteprima separato: il Markdown è impaginato *in place* nell'`NSTextView` |
| Focus Mode | `IAEditorPreferences.focusMode` + `focusScope` con **3 scope**: `Focus_Scope_Text`, `Focus_Scope_Paragraph`, `Focus_Scope_Sentence`; funzione pura `_IARangeForFocusScopeInTextWithRange` |
| Typewriter | `typewriterScrollingEnabled` + timer dedicati (`scheduleTypewriterModeCenteringTimer`, `scheduleTypewriterModeScrollingTimer`) |
| Syntax Control | `syntaxControl` + `lastUsedSyntaxControl`; target lessicali = **Nouns, Adjectives, Adverbs, Conjunctions** via `NLTagger` (NaturalLanguage) |
| Style Check | `styleCheck` con categorie **Cliches, Fillers, Redundancies, SentenceCapitalization** (`IALinguisticPattern`) |
| Statistiche | `IATextStats`: `wordCount`, `characterCount`, `characterCountWithoutSpaces`, `sentenceCount`, `readingTimeComponents`, `speakingTimeComponents`, `totalTaskCount`, `completedTaskCount`; l'utente sceglie quali mostrare (`textStatsValues`) |
| Markdown | `headingKind` (ATX/setext), `emphasisKind`, `strongEmphasisKind`, `listBullet`, `orderedListDelimiter`, `tableFormatting`, **`lazyParagraphsEnabled`** (un singolo invio = nuovo paragrafo), `smartPunctuationEnabled`, output differenziato per `Output` / `HTMLOutput` / `PreviewOutput` di autolink, hashtag e wikilink |
| Anteprima/Stampa | `displayMode` (Full / Split), `centerHeadings`, `numberHeadings`, `indentParagraphs`, `invertColors`; stampa con `includeHeader/Footer/TitlePage`, `paperSize`, `orientation`, `scalingFactor` |
| Libreria | `favorites`, `hashtags`, `smart folders` con regole (`ancestorPath`, `parentPath`, `pathExtension`, `dateCreated`, `dateModified`, `kind`, `search` + operatori `is / is not / begins with / ends with / is greater than / in the past N days / matches`) |
| Altro | Authorship (mark/paste per autore, statistiche per autore), backlinks e wikilink, Quick Search con filtri, template con stylesheet, pubblicazione WordPress/Ghost/Micropub, comandi URL |

### 1.2 Typora 1.14.9 (Electron)

Evidenze: `js_app_map` su `/home/massimo/ca/typora` → *Electron app typora 1.14.9: 35 source file,
12 canali IPC, 17 endpoint* (ev `ev_db003945676e83d9588ac9579ba6122c367984b87e8a77c84d4b50c30206bd41`);
`resources/app.asar` → `atom.compiled.dist.jsc` (bytecode V8, non JS leggibile);
`resources/html/content.html`; `resources/locales/Base.lproj/Panel.json` (**500 stringhe**) e
`Menu.json` (**301 stringhe**).

Architettura: il documento **è** il renderer — `<div id="write" contenteditable>` con blocchi "raw"
(`md-rawblock-panel`) per math/codice, tracker di riga/colonna per le tabelle, caret fittizio
(`#typora-caret`), container di auto-suggest, pannello di zoom.

Funzionalità chiave (dal menu + preferenze): Focus Mode, **Typewriter Mode** ("Always keep caret in
middle of screen"), Source Code Mode, Readonly Mode, Find & Replace (case/word/regex), outline
collassabile, YAML front matter, tabelle con righe/colonne (add/delete/move), math (MathJax 4) e
diagrammi (Mermaid/sequence/flowchart), immagini (copia in `./assets`, `${filename}.assets`, upload
via PicGo/iPic/uPic, ridimensionamento, "switch image syntax"), export HTML/PDF/docx/epub/latex/opml
via Pandoc + export personalizzati, HTML block in iframe con auto-height, "word count popover"
(parole/righe/caratteri/minuti + selezione), GitHub-style alert (`> [!NOTE]`), smart punctuation,
auto-pair, spell check, lettura 120/240/382 wpm, status bar, toolbars, temi light/dark.

---

## 2. Bug trovati in TypeCraft

Legenda: 🔴 critico · 🟠 alto · 🟡 medio · ⚪ basso

| # | Sev | Dove | Sintomo | Causa | Stato |
| :-: | :-: | :--- | :--- | :--- | :--- |
| 1 | 🔴 | `main.go` `tryForwardToPrimary` | Apri un `.md` dal file manager mentre TypeCraft è aperto: il nuovo processo esce e **il file non si apre da nessuna parte** | Il percorso veniva scritto come testo grezzo sulla porta HTTP dell'istanza primaria; nessuno leggeva quel canale. Verificato: `active_file` resta vuoto | ✅ Corretto (canale di controllo autenticato + SSE) |
| 2 | 🔴 | `livepreview.js` `render` | Un `.md` contenente `<img src=x onerror=…>`, `<script>` o `[x](javascript:…)` **esegue codice nell'origine dell'app**, che detiene il token con cui si leggono/scrivono file `.md/.txt` sul disco | `marked` v12 non sanifica e l'HTML veniva assegnato a `innerHTML`; nessuna CSP | ✅ Corretto (allow-list + CSP/Referrer/X-Frame) |
| 3 | 🟠 | `livepreview.js` + `app.css` | **Le checkbox delle task list non si possono cliccare** | `marked` emette `<input disabled type="checkbox">`; un controllo `disabled` non genera l'evento `click`. Verificato con node su `marked.min.js` | ✅ Corretto |
| 4 | 🟠 | `livepreview.js` `handleTaskCheckboxClick` | Cliccando un task si poteva **barrare la riga sbagliata** (o nessuna) | Contava `[x]` ovunque nella riga (anche in prosa o codice inline) invece di usare lo stesso criterio di `marked` (`^\s*([-*+]|\d+[.)])\s+\[[ xX]\]`), più cicli morti rimasti | ✅ Corretto |
| 5 | 🟠 | `app.css` `@media print` | Stampare in modalità Focus produceva **pagina bianca**; in Live la stampa veniva **tagliata** a una schermata | `.pane.hidden{display:none!important}` (2 classi) batteva `.preview-pane{display:block!important}` (1 classe); `.preview-scroll-wrapper` restava `height:100%; overflow:auto` | ✅ Corretto |
| 6 | 🟠 | `app.js` `exportStandaloneHtml` | L'HTML esportato conteneva i **pulsanti "Copy"** dei blocchi di codice | Usava `previewContent.innerHTML` dopo che `attachCopyCodeButtons` aveva iniettato i bottoni | ✅ Corretto (clone + strip) |
| 7 | 🟠 | `app.js` `initApp` + autosave | Scrivendo nel documento di benvenuto, **ogni 1,5 s comparve il dialogo "Salva con nome"** | Il benvenuto aveva `currentPath = "Benvenuto.md"` e il timer di autosave chiamava `saveFile()` → `promptSaveAs()` | ✅ Corretto |
| 8 | 🟠 | `app.js` | Chiudendo la finestra con modifiche recenti, i dati si perdevano senza avviso | Nessun `beforeunload` | ✅ Corretto |
| 9 | 🟠 | `livepreview.js` | Click su un link nell'anteprima: **l'editor naviga via** (perdendo lo stato) e il `?token=` finisce nel `Referer` verso il sito esterno | Nessuna gestione dei link | ✅ Corretto (browser esterno + `no-referrer`) |
| 10 | 🟡 | `app.js` `updateDocTitle`, `promptSaveAs`, `renderRecents`, export | Su **Windows** titoli, recenti e "salva con nome" si rompono | `split("/")` e `lastIndexOf("/")` su percorsi `C:\…` | ✅ Corretto (`baseName`/`dirOf`) |
| 11 | 🟡 | `app.css` `.focus-current` | Con Focus Mode attivo il testo visibile **scivola rispetto al caret** | `font-weight:500` sulla frase attiva cambia la larghezza dei glifi rispetto al `<textarea>` | ✅ Corretto |
| 12 | 🟡 | `app.css` checkbox `:checked::after` | Il segno di spunta **non si vedeva mai** | `::after` non viene renderizzato su un `<input>` (elemento sostituito) in Chrome | ✅ Corretto (SVG in `background-image`) |
| 13 | 🟡 | `app.js` `initApp` | Gli indicatori mostravano i valori di default anche con typewriter/focus/suono attivi da `localStorage` | `applyMode()` non aggiornava le etichette | ✅ Corretto (`syncToggleUI`) |
| 14 | 🟡 | `app.js` `initApp` | Un file **legittimamente vuoto** veniva sostituito dal testo di benvenuto | Condizione `file_content !== ""` invece di `active_file` | ✅ Corretto |
| 15 | 🟡 | `livepreview.js` `preprocessMath` | `$x_1 * y_2$` veniva **mangiato da Markdown** (enfasi) e le formule non erano mai impaginate | La math veniva inserita come HTML *prima* del parsing; e **KaTeX non è incluso** nel bundle (README lo dichiarava) | ✅ Corretto il parsing; ❌ KaTeX ancora assente (README ora è onesto) |
| 16 | 🟡 | `livepreview.js` `initMarked` | Nessun `id` sui titoli → ancore del TOC rotte nell'export | `headerIds`/`mangle` sono opzioni **rimosse** in marked v5+ (marcate v12: nessun effetto) | ✅ Corretto (renderer custom + slugify) |
| 17 | 🟡 | `livepreview.js` | Le **immagini locali** (`![x](./img.png)`) erano sempre rotte | Nessun endpoint per gli asset; `src` relativo risolto contro `127.0.0.1:porta` | ✅ Corretto (`/api/asset`) |
| 18 | 🟡 | `app.js` `wrapSelection` | Ctrl+B/I/K **azzeravano la cronologia undo** e perdevano la selezione | `editor.value = …` ricostruito a mano | ✅ Corretto (`execCommand` + selezione preservata) |
| 19 | ⚪ | `main.go` `isMarkdown` vs `isSafeMarkdownPath` | `.mkd` apribile via API ma **invisibile** nell'albero; `.mdwn/.mdx` non supportati | Due elenchi di estensioni diversi | ✅ Unificato |
| 20 | ⚪ | `main.go` | Nessun timeout HTTP (`ReadHeaderTimeout`), nessun header di sicurezza | – | ✅ Aggiunti |
| 21 | ⚪ | `main.go` | Codice morto: `getDefaultSaveDir` mai usato, `/api/export/html` mai chiamato dal client, `SaveResponse` "per compat" | – | ✅ `getDefaultSaveDir` ora usato per `default_dir` |
| 22 | ⚪ | `livepreview.js` | Paragrafi vuoti (`<p></p>`) attorno alle formule in blocco; stili dei bottoni "Copy" iniettati inline via JS | – | ✅ Corretto (CSS + pulizia) |
| 23 | 🔴 | `main.go` `handleInternalOpen` | Dopo aver **chiuso la finestra**, ogni nuovo avvio (doppio clic sull'AppImage, icona, `typecraft file.md`) rispondeva "già in esecuzione" e non apriva **niente**: il server restava vivo senza UI e l'inoltro non riapriva mai una finestra | L'inoltro pubblicava solo l'evento SSE, ma senza finestra collegata non c'era nessun ascoltatore | ✅ Corretto (se non ci sono finestre collegate l'istanza primaria riapre la UI) |

Note aggiuntive non bloccanti:

- Il token viene passato in query string (`?token=`): finisce nella cronologia e in qualunque log locale.
  Con `Referrer-Policy: no-referrer` il leak esterno è chiuso, ma un cookie `HttpOnly`+`SameSite=Strict`
  sarebbe meglio (richiede però il fetch con credenziali: lavoro separato).
- `/api/init` è pubblico (necessario per l'handshake) e restituisce il token: raggiungibile solo da
  localhost e non leggibile cross-origin, ma un endpoint a nonce monouso sarebbe più solido.
- `/api/workspace` elenca qualsiasi cartella del disco (protetta da token): valutare un `root` fissato
  alla cartella del documento.
- `marked` è configurato con `breaks: true`: un singolo invio diventa `<br>`. iA Writer lo rende
  opzionale (`lazyParagraphsEnabled`) e Typora lo espone come preferenza: candidato a impostazione.

---

## 3. Cosa è stato modificato (1.0.2)

**Backend (`main.go`, `main_test.go`)**
- `forwardToPrimary`: HTTP POST a `/api/internal/open` con segreto per-run (lock file `0600`,
  JSON `{port, control}`); il primario attiva il file e lo pubblica su **SSE** `/api/events`.
- Nuovo `/api/asset` (solo estensioni immagine, `Content-Type` corretto, CSP `sandbox` per SVG, limite 64 MB).
- `securityHeaders`: CSP, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `nosniff`.
- `http.Server` con `ReadHeaderTimeout` (10 s) e `IdleTimeout` (120 s).
- Estensioni markdown unificate (`.md .markdown .txt .mdown .mkd .mdwn .mdx`).
- `InitResponse.default_dir` per pre-compilare "Salva con nome".
- 6 test di regressione (inoltro/contenuto del canale di controllo, hub SSE, estensioni, immagini, header).

**Frontend**
- `web/static/js/sanitize.js` — **nuovo**: allow-list di tag/attributi/schemi URL, blocco di `on*`,
  `style`, `srcset`, `data:text/html`, `<iframe>/<svg>/<object>`, `javascript:` anche offuscato.
- `web/static/js/livepreview.js` — riscritto: sanitizzazione, checkbox abilitati, toggle task corretto,
  math protetta, immagini locali, link esterni/locali, heading id, copy button via CSS, pulizia `<p>` vuoti.
- `web/static/js/app.js` — autosave solo su file esistenti, `beforeunload`, SSE, `baseName`/`dirOf`
  cross-platform, ripristino toggle, export senza bottoni, `printDocument()` unico, Ctrl+P / Ctrl+Shift+S,
  undo preservato, `default_dir`.
- `web/static/css/app.css` — `@media print` corretto, checkmark SVG, stili math/`btn-copy-code`/`img-missing`,
  `.focus-current` senza cambio di peso.
- `web/index.html` — include `sanitize.js`.
- `README.md` / `README.it.md` — claim KaTeX corretto, sezione "Novità 1.0.2", Roadmap.

**Verifiche**
- `go vet ./...` pulito, `go test -race ./...` verde (11 test).
- End-to-end con curl: inoltro a istanza singola → evento SSE → `active_file` aggiornato;
  `/api/asset` 200 su PNG e 400 su `/etc/hosts`; header di sicurezza presenti; `/api/internal/open` 403 senza segreto.
- Render in Chromium headless: i 3 attacchi non eseguono (`window.__xss === 0`), 2 checkbox abilitati,
  immagini riscritte su `/api/asset`, math `x_1 * y_2` intatta, `h1#xss-test` generato, `onclick` rimosso.
- Build: `make build`, `make cross-compile` (linux amd64/arm64, macos amd64/arm64, windows amd64) e
  AppImage ricostruita in `dist/TypeCraft-x86_64.AppImage`.

---

## 4. Matrice di parità

| Capacità | TypeCraft 1.0.2 | iA Writer | Typora |
| :--- | :--- | :--- | :--- |
| Typewriter scrolling centrato | ✅ rAF sub-pixel | ✅ | ✅ |
| Focus Mode | ✅ frase/paragrafo (dimming) | ✅ testo/paragrafo/frase | ✅ paragrafo/frase |
| Live preview in-place | ⚠️ pannello separato (Focus/Live/Dual) | ✅ stile sul testo | ✅ contenteditable |
| Sanitizzazione dei documenti | ✅ allow-list | ✅ (nativo) | ✅ (hardening post-CVE) |
| Task list cliccabili | ✅ | ✅ | ✅ |
| Tabelle | ✅ resa | ✅ resa + editing | ✅ editing completo |
| Math | ⚠️ TeX non impaginato | ⚠️ base | ✅ MathJax 4 |
| Diagrammi (Mermaid) | ❌ | ❌ | ✅ |
| Immagini locali | ✅ `/api/asset` | ✅ | ✅ (+ copia/upload) |
| Outline | ✅ | ✅ | ✅ collassabile |
| Statistiche | ✅ parole/caratteri/frasi/lettura/eloquio/media | ✅ + task completati, scelta metriche | ✅ + righe, selezione |
| Style Check / Syntax Control | ❌ | ✅ (NLP) | ❌ |
| Trova & sostituisci | ❌ (solo Ctrl+F del browser) | ✅ | ✅ regex |
| Export | ⚠️ HTML + print/PDF | ✅ HTML/PDF/docx | ✅ + Pandoc (epub/latex/…) |
| Libreria / tag / smart folder | ❌ (albero + recenti) | ✅ | ✅ file tree |
| Single binary offline | ✅ ~8 MB | – (nativo) | ❌ (~250 MB) |

---

## 5. Prossimi passi consigliati (in ordine di valore/costo)

1. **KaTeX nel bundle** (~1 MB) + Mermaid opzionale: chiude il gap più visibile e rende vere le
   formule (oggi solo "TeX formattato").
2. **Trova & sostituisci interno** (case/word/regex) con evidenziazione nel testo: è l'assenza più
   fastidiosa per l'uso quotidiano.
3. **Editing tabelle** (aggiungi/rimuovi riga e colonna, Tab tra celle) — Typora è il riferimento.
4. **Word count target + metriche selezionabili** (come `textStatsValues` di iA Writer) e conteggio
   che ignora la sintassi Markdown.
5. **Style Check "leggero"**: liste di cliché/filler/ripetizioni per l'italiano e l'inglese
   (dizionari statici, nessun NLP): 80% del valore di iA Writer con 5% del costo.
6. **Impostazioni persistenti lato server** (`~/.typecraft/settings.json`) invece del solo
   `localStorage`, così tema/font/modalità valgono anche in modalità app senza profilo dedicato.
7. **Token via cookie `HttpOnly`** + nonce su `/api/init`, e `root` di workspace configurabile.
8. Pulizia del repository: `dist/Ferrite-x86_64.AppImage` e `squashfs-root/`, `usr/bin/ferrite`,
   `Ferrite-master/` sono residui di un altro progetto (e di un'altra licenza).
