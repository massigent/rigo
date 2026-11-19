# TypeCraft 1.0.2 → 1.0.3 — Revisione, bug trovati e corretti

Data: revisione eseguita il 2026-11-13 su copia locale del repo (`~/typecraft-work`), poi sincronizzata.
Metodo: lettura statica di `main.go` (1341 righe), `web/index.html`, `web/static/js/*` (marked 12.0.2
incluso); prove eseguibili locali (harness **Node + jsdom** con il motore vero `livepreview.js` e il
vero `sanitize.js`, più il binario compilato interrogato via HTTP con `curl`); `go vet`, `go test`.

Riferimento esterno usato per decidere *cosa* vale la pena correggere: i bug che Typora ha dovuto
correggere fra 1.12.3 e 1.14.15 (vedi §5) e le promesse scritte nel README di TypeCraft.

---

## 1. Il bug più visibile: i blocchi di codice non esistevano

**Difetto (osservato).** In Live Preview ogni recinto di codice veniva *rimosso* dal Markdown prima di
`marked()` e poi *reinserito come testo Markdown* dopo il parsing:

```js
blocks.push(m);                       // m = "```js\nlet a = 1;\n```"
...
html = restoreCodeBlocks(html, code.blocks);   // reinserisce i backtick dentro l'HTML
```

Riproduzione (Node, motore vero + marked 12.0.2):

```
markdown:  "```js\nlet a = 1;\n```"
output:    <p>```js<br>let a = 1;<br>```</p>
```

Cioè: niente `<pre>`, niente evidenziazione, niente pulsante "Copy" (che cerca `pre > code`),
backtick visibili a schermo. Lo stesso valeva per il codice inline: `` `ls -la` `` restava con i
backtick. Contro la promessa del README ("Blocchi di Codice con Tasto Copia").

**Causa.** `extractCodeBlocks` metteva da parte il *sorgente* invece dell'*HTML*: il segnaposto
sopravviveva al parser e il ripristino iniettava Markdown in un albero già HTML.

**Fix.** Il recinto e il codice inline vengono ora resi in HTML nel momento in cui vengono messi da
parte (`<pre class="code-block"><code class="language-xx">…</code></pre>`, contenuto escapato,
indentazione del recinto normalizzata, recinti non chiusi tollerati). Verificato con il motore e il
sanitizer reali in jsdom:

```
<pre class="code-block"><code class="language-js">let a = 1 &lt; 2 &amp;&amp; "x";</code>
  <button class="btn-copy-code" type="button">Copy</button></pre>
```

## 2. Il buffer senza titolo scriveva un file di nascosto

**Difetto (osservato nel codice, poi verificato in jsdom).** Nel gestore `input` dell'editor:

```js
if (!state.currentPath) {
  state.currentPath = defDir + "/Documento.md";   // percorso inventato
  updateDocTitle();
}
...
state.saveTimer = setTimeout(() => saveFile(true), 600);
```

Quindi: apri TypeCraft, vedi il testo di benvenuto, scrivi **una** lettera → viene creato
`~/Documenti/Documento.md` senza che tu l'abbia mai chiesto, e la sessione successiva lo
sovrascrive. È l'esatto contrario di quanto dichiara il README della 1.0.2 ("un buffer senza titolo
resta senza titolo finché non chiedi tu un percorso"). `saveFile(true)` faceva la stessa cosa.

**Fix.** L'auto-salvataggio non inventa più percorsi: senza un percorso reale non scrive nulla e lo
stato resta `○ Non salvato`; `Ctrl+S` continua a chiedere il nome. Verificato in jsdom: dopo aver
digitato nel documento di benvenuto, **zero** chiamate a `/api/save` e titolo ancora "Senza titolo.md".

## 3. Sicurezza

| Difetto | Perché conta | Fix |
| :--- | :--- | :--- |
| `/api/asset` serviva **qualsiasi** immagine del disco: il commento prometteva "scoped strictly to the document directory" ma non c'era alcun controllo di contenimento | un URL tokenizzato poteva leggere immagini (e `.svg`) fuori dalla cartella del documento | `pathWithin()`: confronto dopo `filepath.Rel` con `EvalSymlinks` (i link che escono sono rifiutati); file non ancora esistenti restano "dentro" e rispondono 404, non 403 |
| `/api/rename` cancellava `old_path` **senza** verificare che fosse un documento Markdown | `old_path=/qualsiasi/file` + una `new_path` valida = cancellazione arbitraria | `old_path` validato con `isSafeMarkdownPath` (403 altrimenti) |
| L'allow-list degli Origin usava `strings.HasPrefix(origin, "http://127.0.0.1")` | `http://127.0.0.1.evil.com` e `http://localhost.evil.com` passavano la difesa anti-DNS-rebinding | `isLocalOrigin()`: `url.Parse` + host esatto (`localhost` o IP loopback) |
| Confronto del token con `==` | confronto non a tempo costante | `subtle.ConstantTimeCompare` |

## 4. Dati, permessi e modifiche esterne

- **Salvataggio atomico che cambiava i permessi**: `os.CreateTemp` crea `0600`, quindi ogni salvataggio
  trasformava un documento `0644` (o `0640` su cartella condivisa) in `0600`, e perdeva owner/xattr.
  Ora `atomicWrite` conserva il modo del file esistente (o `0644` se è nuovo) e fa `fsync` anche sulla
  cartella dopo il rename.
- **Sovrascrittura silenziosa in "Salva con nome"**: scegliere il nome di un documento già esistente lo
  sostituiva senza chiedere. Ora il backend risponde `409` e sostituisce solo con `overwrite: true`,
  che la UI manda dopo una conferma esplicita.
- **Estensione riscritta a forza** (il bug che Typora ha corretto in 1.13.7): `new_path` non Markdown
  veniva silenziosamente trasformato in `.md`. Ora il backend risponde `400` con l'elenco delle
  estensioni ammesse, e la UI chiede `"Note v1.2"` → `Note v1.2.md` (è un titolo) ma per
  `doc.fountain` fa una domanda esplicita invece di rinominare di nascosto.
- **Nessun avviso di modifica esterna**: il documento poteva essere cambiato da un'altra macchina su una
  cartella condivisa, da git o da un altro editor; TypeCraft se ne accorgeva solo al salvataggio, e a
  quel punto la scelta era "sovrascrivi o perdi". Aggiunti `/api/stat` e un watchdog da 5 s: se il
  buffer è pulito ricarica (`● Ricaricato dal disco`), se stai scrivendo mostra `⚠️ Cambiato su disco`
  e **non** tocca una sola riga di quello che hai digitato. Inoltre un file aperto all'avvio ora legge
  subito il proprio `mtime`, quindi il primo auto-salvataggio non salta più il controllo di conflitto.

## 5. Due piccole cose prese dal changelog di Typora

- `Ctrl+Alt+T` (suono) non ha mai funzionato su macOS: con Option premuto `e.key` diventa `†`. Ora la
  scorciatoia usa `e.code === "KeyT"`.
- Il token in query string e il rendering della stampa erano già a posto dalla 1.0.2; verificato che
  l'export HTML non porti dietro i pulsanti "Copy".

## 5-bis. Data race nel launcher

`handleInternalOpen` lanciava `go openDesktopWindow(primaryURL(), appMode)` e quella goroutine leggeva
ancora i global `appToken`/`primaryPort`: con `go test -race` il detector segnalava la corsa. Ora il
controllore fa uno snapshot (`url, forceApp, token`) prima di avviare la goroutine e
`openDesktopWindow` riceve il token come parametro. `go test -race ./...` è pulito.

## 6. Verifiche eseguite

- `go vet ./...` pulito, `go test ./...` → **19 test verdi** (13 preesistenti + 6 nuovi:
  `isLocalOrigin` con host civetta, `pathWithin` con symlink e file mancanti, contenimento di
  `/api/asset`, `rename` che rifiuta `old_path` non Markdown e sovrascrittura senza flag, permessi
  preservati, `/api/stat`).
- Harness jsdom con i file **reali** (`marked.min.js`, `sanitize.js`, `livepreview.js`, `app.js`):
  recinti → `<pre><code>`, codice inline → `<code>`, `<script>` e `onerror` eliminati, tabella resa,
  checkbox abilitate, math inline/blocco protetti, nessun `<p>` vuoto residuo, titoli con `id`.
- Binario compilato e interrogato via HTTP: `/api/stat` 200, asset fuori cartella 403 / dentro 200 /
  mancante 404, rename con `old_path` non Markdown 403, sovrascrittura senza flag 409 (file intatto),
  con flag 200, Origin civetta 403, salvataggio che conserva `-rw-r-----`.

## 7. Cosa resta aperto (non toccato di proposito)

- KaTeX/Mermaid non sono inclusi: le formule sono mostrate come sorgente TeX (come dichiarato).
- Nessuna gestione di `.md` aperti in sola lettura: `FileResponse.ReadOnly` è sempre `false`.
- Il versioning del binario AppDir (`TypeCraft.AppDir/usr/bin/typecraft`) non è stato rigenerato: va
  rifatto con `make build`/`make install-appdir` al prossimo rilascio.
