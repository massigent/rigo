// TypeCraft — Core Application Controller

(function () {
  "use strict";

  // Elements
  const editor = document.getElementById("editor");
  const focusBackdrop = document.getElementById("focusBackdrop");
  const editorScrollWrapper = document.getElementById("editorScrollWrapper");
  const previewContent = document.getElementById("previewContent");
  const previewScrollWrapper = document.getElementById("previewScrollWrapper");
  const rawPane = document.getElementById("rawPane");
  const previewPane = document.getElementById("previewPane");

  // HUD & UI Elements
  const docTitle = document.getElementById("docTitle");
  const docTitleBtn = document.getElementById("docTitleBtn");
  const saveStatus = document.getElementById("saveStatus");
  const statWords = document.getElementById("statWords");
  const statReadTime = document.getElementById("statReadTime");
  const focusDimLabel = document.getElementById("focusDimLabel");
  const typewriterLabel = document.getElementById("typewriterLabel");
  const fontCurrentLabel = document.getElementById("fontCurrentLabel");
  const themeCurrentIcon = document.getElementById("themeCurrentIcon");

  // Status bar
  const statusCursorPos = document.getElementById("statusCursorPos");
  const statusChars = document.getElementById("statusChars");
  const statusSentences = document.getElementById("statusSentences");
  const statusParagraphs = document.getElementById("statusParagraphs");
  const statusFocusIndicator = document.getElementById("statusFocusIndicator");
  const statusTypewriterIndicator = document.getElementById("statusTypewriterIndicator");
  const statusFilePath = document.getElementById("statusFilePath");

  // Drawer
  const sideDrawer = document.getElementById("sideDrawer");
  const drawerOverlay = document.getElementById("drawerOverlay");
  const btnToggleDrawer = document.getElementById("btnToggleDrawer");
  const btnCloseDrawer = document.getElementById("btnCloseDrawer");
  const tabOutline = document.getElementById("tabOutline");
  const tabFiles = document.getElementById("tabFiles");
  const tabRecents = document.getElementById("tabRecents");
  const panelOutline = document.getElementById("panelOutline");
  const panelFiles = document.getElementById("panelFiles");
  const panelRecents = document.getElementById("panelRecents");
  const outlineList = document.getElementById("outlineList");
  const fileTree = document.getElementById("fileTree");
  const recentsList = document.getElementById("recentsList");

  // Dropdowns
  const btnFontMenu = document.getElementById("btnFontMenu");
  const fontMenu = document.getElementById("fontMenu");
  const btnThemeMenu = document.getElementById("btnThemeMenu");
  const themeMenu = document.getElementById("themeMenu");
  const btnActionsMenu = document.getElementById("btnActionsMenu");
  const actionsMenu = document.getElementById("actionsMenu");

  // Modals
  const statsModal = document.getElementById("statsModal");
  const statsPill = document.getElementById("statsPill");
  const statsModalClose = document.getElementById("statsModalClose");

  // File System Modal (Finder / macOS Save As / Open)
  const fsModal = document.getElementById("fsModal");
  const fsModalTitle = document.getElementById("fsModalTitle");
  const btnFsClose = document.getElementById("btnFsClose");
  const fsFileNameSection = document.getElementById("fsFileNameSection");
  const fsFileNameInput = document.getElementById("fsFileNameInput");
  const fsBreadcrumbs = document.getElementById("fsBreadcrumbs");
  const btnFsUp = document.getElementById("btnFsUp");
  const btnFsNewFolder = document.getElementById("btnFsNewFolder");
  const fsFilterInput = document.getElementById("fsFilterInput");
  const fsList = document.getElementById("fsList");
  const fsSelectedPath = document.getElementById("fsSelectedPath");
  const btnFsCancel = document.getElementById("btnFsCancel");
  const btnFsConfirm = document.getElementById("btnFsConfirm");
  const fsQuickBtns = document.querySelectorAll(".fs-quick-btn");

  // State
  //
  // Document-session protocol (why this is not just a `saving` boolean):
  // every asynchronous operation (open, save, Save As/rename, watchdog)
  // captures the values below *before* awaiting and re-checks them before it
  // is allowed to touch the document. A response that no longer matches is
  // discarded, including its error messages and its `finally` bookkeeping.
  //
  // - docSession identifies the document on screen and is bumped whenever a
  //   different document is adopted. Comparing paths is not enough: reopening
  //   the same file must invalidate the operations of the previous session.
  // - bufferRevision counts edits; savedRevision is the newest revision the
  //   server confirmed. A save only cleans the text it actually sent, so
  //   typing during a request keeps the buffer dirty and beforeunload active.
  // - Writes are serialised through `writeChain` and an in-flight save is
  //   coalesced: further requests set `saveQueued` and exactly one follow-up
  //   pass sends the newest buffer after the current write succeeds. The write
  //   never bypasses the chain, so a late autosave cannot recreate the source
  //   file after a rename moved it.
  let state = {
    currentPath: "",
    // Opaque content revision of the disk file the buffer was last aligned
    // with (sha256:<hex> from /api/init, /api/file, a confirmed save or rename).
    // It is compared for equality only: never parsed as a number and never
    // compared by order. "" means "no baseline known" (brand-new file).
    diskRevision: "",
    // Backend write policy for the current document (not part of the content
    // fingerprint). See applyReadOnly().
    readOnly: false,
    readOnlyReason: "",
    defaultDir: "",
    isDirty: false,
    viewMode: "raw", // "raw" | "live" | "split"
    theme: "ia-light",
    font: "ia-mono",
    saveTimer: null,
    typingTimer: null,
    previewTimer: null,
    statsTimer: null,
    appToken: "",
    eventSource: null,
    watchTimer: null,
    remoteChanged: false,

    // Document identity / plumbing (see the block comment above).
    docSession: 0,
    bufferRevision: 0,
    savedRevision: 0,
    saveInFlight: null,        // { session, revision, promise }
    renameInFlight: null,      // { session, revision, promise }
    saveQueued: false,         // one more pass is owed: the newest buffer
    saveQueuedExplicit: false, // that pending pass was requested by the user
    saveQueuedForce: false,    // that pending pass carries a one-shot overwrite consent
    openSeq: 0,                // the newest accepted open request wins
    // Monotonic generation of write activity (save or rename requested or
    // confirmed). A watchdog read captures it and must discard its answer if it
    // moved meanwhile: a write can start *after* the read and complete before
    // the answer is applied, without touching buffer revisions or mtime yet.
    writeEpoch: 0,
  };

  // Serialiser for document writes. A step never rejects the chain: each one
  // reports its own failure through the status line.
  let writeChain = Promise.resolve();

  function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => {}, () => {});
    return run;
  }

  // Snapshot of everything a late response must still match.
  function captureContext() {
    return {
      session: state.docSession,
      path: state.currentPath,
      diskRevision: state.diskRevision,
      readOnly: state.readOnly,
      revision: state.bufferRevision,
      savedRevision: state.savedRevision,
      content: editor.value,
      writeEpoch: state.writeEpoch,
    };
  }

  function sameDocument(ctx) {
    return !!ctx && ctx.session === state.docSession;
  }

  // Disk revisions are opaque strings from the server ("sha256:<64 lowercase
  // hex>"). The client validates the *format* only: it never parses them as
  // numbers and never compares them by order.
  const DISK_REVISION_RE = /^sha256:[0-9a-f]{64}$/;

  function validDiskRevision(rev) {
    return typeof rev === "string" && DISK_REVISION_RE.test(rev);
  }

  // A successful write must confirm the protocol: JSON object, success flag and
  // a valid disk revision. An optional path must be a non-empty string. Anything
  // else is a protocol error, never a saved document.
  function isWriteSuccess(data) {
    return !!data && typeof data === "object"
      && data.success === true
      && validDiskRevision(data.revision)
      && (data.path === undefined || (typeof data.path === "string" && data.path.length > 0));
  }

  // Same document, same path, same text, no write confirmed and no write
  // started/queued in the meantime.
  function unchangedSince(ctx) {
    return sameDocument(ctx)
      && ctx.path === state.currentPath
      && ctx.diskRevision === state.diskRevision
      && ctx.readOnly === state.readOnly
      && ctx.revision === state.bufferRevision
      && ctx.savedRevision === state.savedRevision
      && ctx.writeEpoch === state.writeEpoch
      && ctx.content === editor.value;
  }

  // ---- Boot (/api/init) context -------------------------------------------
  // The first handshake can come back after the user already adopted another
  // document. The docSession number alone is not enough: Save As inside the
  // same session changes path and disk baseline, and any write moves the write
  // generation. `bootDocumentCurrent` decides whether the late answer still
  // talks about the document on screen (status/title/workspace may apply);
  // `bootTextUntouched` decides whether it may replace or reset the buffer.
  // Token and recents are global metadata and are always applied.
  function bootDocumentCurrent(boot) {
    return sameDocument(boot)
      && state.currentPath === boot.path
      && state.diskRevision === boot.diskRevision
      && state.savedRevision === boot.savedRevision
      && state.writeEpoch === boot.writeEpoch;
  }

  function bootTextUntouched(boot) {
    return state.bufferRevision === boot.revision && editor.value === boot.content;
  }

  // Adopt a new document identity. Timers and queued writes of the previous
  // document are dropped before the buffer changes, so nothing that was
  // scheduled for the old document can save into the new one.
  function beginDocumentSession() {
    state.docSession += 1;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    state.saveQueued = false;
    state.saveQueuedExplicit = false;
    state.saveQueuedForce = false;
    state.remoteChanged = false;
    return state.docSession;
  }

  function writePendingForCurrentSession() {
    return (state.saveInFlight && state.saveInFlight.session === state.docSession)
      || (state.renameInFlight && state.renameInFlight.session === state.docSession);
  }

  // ------------------------------------------------------------- Read-only mode
  //
  // The backend is the authority: `read_only` from /api/init, /api/file and
  // /api/stat says whether this app will replace the file (no POSIX write bits,
  // or no effective write access for the process). While it is true the editor
  // is read-only and every programmatic edit path is blocked; autosave is
  // suspended and the indicator is distinct from "Saved". A protected document
  // can still be copied explicitly (the copy flow sends old_path:"", so the
  // source is never written or removed).
  function applyReadOnly(on, reason) {
    const next = !!on;
    state.readOnly = next;
    state.readOnlyReason = reason || "";
    if (editor) editor.readOnly = next;
    if (window.livePreview) {
      if (typeof window.livePreview.setReadOnly === "function") window.livePreview.setReadOnly(next);
      else window.livePreview.readOnly = next;
    }
    if (next) {
      // No pending autosave may write into a protected file.
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
      updateReadOnlyStatus();
      return;
    }
    // Unlocked: restore the status that describes the buffer, unless a write is
    // in flight (its transient status must not be overwritten).
    if (state.saveInFlight || state.renameInFlight) return;
    if (state.isDirty) {
      setSaveStatus(state.currentPath ? "○ Modificato" : "○ Non salvato", "unsaved");
    } else {
      setSaveStatus("● Salvato", "saved");
    }
  }

  // Shows the read-only indicator when it applies; returns true if it did, so
  // callers can fall back to their normal save status.
  function updateReadOnlyStatus() {
    if (!state.readOnly) return false;
    setSaveStatus(state.isDirty ? "🔒 Sola lettura — modifiche non salvate" : "🔒 Sola lettura", "readonly");
    return true;
  }

  // Basename that works with POSIX and Windows separators (split("/") broke
  // every title/save path on Windows).
  function baseName(p) {
    const parts = String(p == null ? "" : p).split(/[\\/]/);
    return parts[parts.length - 1] || "";
  }

  function apiHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (state.appToken) h["X-Typecraft-Token"] = state.appToken;
    return h;
  }

  // Tokenised URL for the transports that cannot set headers (EventSource and
  // <img> elements). Plain fetches authenticate with the header instead, so the
  // token never lands in URLs, browser history or server logs.
  function apiUrl(p) {
    if (!state.appToken) return p;
    const sep = p.includes("?") ? "&" : "?";
    return p + sep + "token=" + encodeURIComponent(state.appToken);
  }

  // GET-style fetch with header authentication.
  function apiGet(path) {
    const h = {};
    if (state.appToken) h["X-Typecraft-Token"] = state.appToken;
    return fetch(path, { headers: h });
  }

  // Exposed for the preview engine (local images need the tokenised URL:
  // <img> cannot set headers, unlike every fetch call).
  window.tcApiUrl = apiUrl;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // Engines
  window.typewriter = new TypewriterEngine(editor, focusBackdrop);
  window.focusDim = new FocusDimEngine(editor, focusBackdrop);
  window.livePreview = new LivePreviewEngine(editor, previewContent);
  window.outline = new OutlineEngine(editor, outlineList, editorScrollWrapper);

  // ------------------------------------------------------------- Initialization
  async function initApp() {
    loadPreferences();
    bindEvents();
    setupDropdowns();
    setupModals();
    // Token passato dal backend via ?token= (openDesktopWindow) o via /api/init.
    try {
      const qp = new URLSearchParams(window.location.search).get("token");
      if (qp) state.appToken = qp;
    } catch (_) {}

    // /api/init can be slow: remember the buffer it is describing so a late
    // answer cannot silently replace text typed while it was loading.
    const boot = captureContext();
    try {
      const res = await fetch("/api/init");
      if (res.ok) {
        const data = await res.json();
        // Harmless global metadata: not tied to the document on screen.
        if (data.token) state.appToken = data.token;
        if (data.default_dir) state.defaultDir = data.default_dir;
        renderRecents(data.recents || []);

        // A late answer that no longer belongs to the on-screen document must
        // not touch its text, path, baseline, title, status or workspace.
        const current = bootDocumentCurrent(boot);
        const untouched = current && bootTextUntouched(boot);

        if (!data.active_file) {
          // Welcome text is not a file: it must never be auto-saved, otherwise
          // every keystroke popped the "Save as" dialog after 1.5s.
          if (untouched) {
            beginDocumentSession();
            editor.value = getWelcomeMarkdown();
            state.currentPath = "";
            state.diskRevision = "";
            state.bufferRevision = 0;
            markBufferClean(true, "● Salvato");
            applyReadOnly(false);
          }
        } else if (data.file_exists !== false && validDiskRevision(data.file_revision)) {
          // A real document is open (even if it is empty: an existing empty file
          // has the valid revision of the empty bytes). Content and revision come
          // from the same server snapshot, so there is no later stat that could
          // stamp the old text with a newer revision.
          if (untouched) {
            beginDocumentSession();
            editor.value = data.file_content || "";
            state.currentPath = data.active_file;
            state.diskRevision = data.file_revision;
            state.bufferRevision = 0;
            markBufferClean(true, "● Salvato");
            applyReadOnly(data.read_only === true, data.read_only_reason);
          }
        } else if (untouched) {
          // The active file exists but the snapshot is not trustworthy, or the
          // file disappeared before launch. Never adopt it as an open, clean
          // document (that would also make a later save recreate a known-deleted
          // file).
          editor.value = getWelcomeMarkdown();
          state.currentPath = "";
          state.diskRevision = "";
          setSaveStatus(data.file_exists === false
            ? "⚠️ Il documento attivo non esiste piu'"
            : "⚠️ Revisione del documento non valida", "unsaved");
        } else if (current) {
          // Only the buffer was typed in: keep the text, but the boot failure is
          // still this (still untitled) document's warning.
          setSaveStatus(data.file_exists === false
            ? "⚠️ Il documento attivo non esiste piu'"
            : "⚠️ Revisione del documento non valida", "unsaved");
        }
        if (current) {
          updateDocTitle();
          if (data.active_dir) {
            loadWorkspace(data.active_dir);
          }
        }
      } else {
        // A read failure (503 snapshot_unstable) is not an empty document. The
        // handshake still delivers the session token with the error, so the UI
        // keeps its credentials (the launcher URL no longer carries them).
        const errData = await res.json().catch(() => null);
        if (errData && typeof errData.token === "string" && errData.token) {
          state.appToken = errData.token;
        }
        const current = bootDocumentCurrent(boot);
        const untouched = current && bootTextUntouched(boot);
        if (untouched) {
          editor.value = getWelcomeMarkdown();
        }
        if (current) {
          updateDocTitle();
          setSaveStatus("⚠️ Impossibile leggere il documento attivo", "unsaved");
        }
      }
    } catch (e) {
      console.warn("Init fallback:", e);
      const current = bootDocumentCurrent(boot);
      if (current && bootTextUntouched(boot)) {
        editor.value = getWelcomeMarkdown();
      }
      if (current) {
        updateDocTitle();
        setSaveStatus("⚠️ Avvio incompleto — ricarica", "unsaved");
      }
    }

    applyTheme(state.theme);
    applyFont(state.font);
    applyViewMode(state.viewMode);
    window.focusDim.applyMode();
    window.livePreview.setBaseDir(state.currentPath ? dirOf(state.currentPath) : "");
    window.livePreview.onLocalLink = (p) => openFile(p);

    syncToggleUI();
    subscribeEvents();
    updateAll();
    // The initial baseline came with /api/init (content + revision of the same
    // snapshot), so there is no follow-up stat that could pair an old buffer with
    // a newer disk revision.
    startExternalWatch();
    window.typewriter.centerCaret(true);
    editor.focus();
  }

  function dirOf(p) {
    const s = String(p || "");
    const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i > 0 ? s.slice(0, i) : "";
  }

  // Reflect persisted switches (typewriter / focus / sound) in the HUD instead
  // of showing the hardcoded defaults on every launch.
  function syncToggleUI() {
    if (window.focusDim) updateFocusDimUI(window.focusDim.mode);
    if (window.typewriter) {
      document.body.classList.toggle("typewriter-active", !!window.typewriter.enabled);
      updateTypewriterUI(window.typewriter.enabled);
    }
    const audioBtn = document.getElementById("btnAudioToggle");
    if (audioBtn && window.typewriterAudio) {
      audioBtn.classList.toggle("active", !!window.typewriterAudio.enabled);
    }
  }

  // A second launch forwards its file over SSE: open it in this window.
  function subscribeEvents() {
    if (!("EventSource" in window) || !state.appToken) return;
    try {
      state.eventSource = new EventSource(apiUrl("/api/events"));
      state.eventSource.addEventListener("open", (ev) => {
        let path = "";
        try { path = JSON.parse(ev.data); } catch (_) { return; }
        if (path === "__FOCUS__") {
          window.focus();
          editor.focus();
          return;
        }
        if (path && path !== state.currentPath) openFile(path);
      });
      state.eventSource.onerror = () => {
        // The browser reconnects on its own; nothing to do.
      };
    } catch (_) {}
  }

  function getWelcomeMarkdown() {
    return `# Benvenuto in TypeCraft ✍️

L'editor Markdown minimalista definitivo per tutte le piattaforme.
Unisce l'immersione profonda della **macchina da scrivere** e del **Focus Mode** di *iA Writer* con l'eleganza dell'**editing Live Preview** di *Typora*.

---

## 🎯 Il Meglio di Due Mondi

1. **Macchina da Scrivere Autentica (iA Writer)**:
   - La linea attiva rimane comodamente **fissata al centro** dello schermo.
   - Prova a digitare: la pagina scorre sotto le tue dita in modo fluido.
   - Suono meccanico opzionale: premi \`Ctrl+Alt+T\` per sentire il tocco tattile.

2. **Focus Mode a Sfocatura Graduale (iA Writer & PubCraft)**:
   - Premi \`Ctrl+D\` per attivare il Focus Mode.
   - Scegli tra **Focus Frase** (isola il singolo pensiero) o **Focus Paragrafo**.
   - Tutto il testo circostante viene dolcemente sfocato per azzerare ogni distrazione.

3. **Live Preview Ibrida & Tabelle (Typora)**:
   - Premi \`Ctrl+2\` per passare all'anteprima fluida, o \`Ctrl+3\` per la vista Dual Split.
   - Elenchi puntati interattivi con checkbox cliccabili:
     - [x] Analisi profonda di iA Writer e Typora
     - [x] Studio dell'architettura single-binary di PubCraft
     - [ ] Scrivere la prossima grande opera in Markdown
   - Formattazione istantanea di tabelle:

| Funzione | TypeCraft | iA Writer | Typora |
| :--- | :--- | :--- | :--- |
| Typewriter Centered | ✅ Fluido rAF | ✅ Presente | ⚠️ Rigido |
| Focus Frase/Paragrafo | ✅ 3 Livelli | ✅ Presente | ❌ Assente |
| Live Preview Typora | ✅ Istantaneo | ❌ Separato | ✅ Leader |
| Dimensione Binario | ⚡ <15 MB | ~30 MB | >250 MB |

---

## ⌨️ Scorciatoie da Tastiera Rapide

- **Ctrl+S**: Salva file istantaneamente
- **Ctrl+D**: Alterna Focus Mode (Spento / Frase / Paragrafo)
- **Ctrl+T**: Alterna scorrimento Macchina da Scrivere
- **Ctrl+1 / Ctrl+2 / Ctrl+3**: Focus Raw / Live Preview / Dual Split
- **Ctrl+Shift+O**: Apri/Chiudi Indice Documento (Outline TOC)
- **F11**: Modalità Zen Schermo Intero

*Inizia a scrivere cancellando questo testo o aprendo un tuo file dal menu in alto a destra.*
`;
  }

  // ------------------------------------------------------------- Preferences
  function loadPreferences() {
    state.theme = localStorage.getItem("typecraft.theme") || "ia-light";
    state.font = localStorage.getItem("typecraft.font") || "ia-mono";
    state.viewMode = localStorage.getItem("typecraft.viewMode") || "raw";
  }

  function applyTheme(themeName) {
    state.theme = themeName;
    localStorage.setItem("typecraft.theme", themeName);
    document.body.className = document.body.className
      .replace(/theme-[a-z0-9-]+/g, "")
      .trim();
    document.body.classList.add(`theme-${themeName}`);

    const icons = {
      "ia-light": "☀️",
      "sepia": "📜",
      "typora-night": "🌙",
      "oled-black": "⬛",
    };
    if (themeCurrentIcon) themeCurrentIcon.textContent = icons[themeName] || "☀️";
  }

  function applyFont(fontName) {
    state.font = fontName;
    localStorage.setItem("typecraft.font", fontName);
    document.body.className = document.body.className
      .replace(/font-[a-z0-9-]+/g, "")
      .trim();
    document.body.classList.add(`font-${fontName}`);

    const labels = {
      "ia-mono": "Mono",
      "ia-duo": "Duo",
      "ia-quattro": "Quattro",
      "garamond": "Garamond",
      "lora": "Lora",
      "system-sans": "Sans",
    };
    if (fontCurrentLabel) fontCurrentLabel.textContent = labels[fontName] || "Font";

    if (window.typewriter) {
      window.typewriter.invalidate();
      window.typewriter.centerCaret(true);
    }
    if (window.focusDim) window.focusDim.render();
  }

  function applyViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem("typecraft.viewMode", mode);

    document.body.classList.remove("mode-raw", "mode-live", "mode-split");
    document.body.classList.add(`mode-${mode}`);

    document.querySelectorAll(".mode-tab-btn").forEach((btn) => btn.classList.remove("active"));

    if (mode === "raw") {
      document.getElementById("btnModeRaw")?.classList.add("active");
      rawPane.classList.remove("hidden");
      previewPane.classList.add("hidden");
      editor.focus();
    } else if (mode === "live") {
      document.getElementById("btnModeLive")?.classList.add("active");
      rawPane.classList.add("hidden");
      previewPane.classList.remove("hidden");
      window.livePreview.render(editor.value);
    } else if (mode === "split") {
      document.getElementById("btnModeSplit")?.classList.add("active");
      rawPane.classList.remove("hidden");
      previewPane.classList.remove("hidden");
      window.livePreview.render(editor.value);
      editor.focus();
    }
  }

  // ------------------------------------------------------------- Events Binding
  function bindEvents() {
    // Editor input
    editor.addEventListener("input", () => {
      if (state.readOnly) return; // defense in depth: the editor is readOnly and all programmatic paths are guarded
      pokeHud();
      markDirty();
      updateAll();
      window.typewriter.centerCaret(false);
      window.focusDim.render();

      clearTimeout(state.saveTimer);
      state.saveTimer = null;
      if (!state.currentPath) {
        // A buffer that has never been given a name must stay nameless: the old
        // code invented "<documenti>/Documento.md" here, so the first keystroke
        // on the welcome screen silently wrote a file to disk and every later
        // session overwrote it. Autosave waits for a real path; Ctrl+S asks.
        setSaveStatus("○ Non salvato", "unsaved");
        return;
      }

      setSaveStatus("● Salvataggio...", "saving");
      state.saveTimer = setTimeout(() => {
        state.saveTimer = null;
        saveFile(true);
      }, 600);
    });

    // Keystroke sound & navigation
    editor.addEventListener("keydown", (e) => {
      pokeHud();

      // Audio feedback
      if (window.typewriterAudio && window.typewriterAudio.enabled) {
        if (e.key === "Enter") {
          window.typewriterAudio.playReturn();
        } else if (e.key === " ") {
          window.typewriterAudio.playSpace();
        } else if (e.key.length === 1) {
          window.typewriterAudio.playKey();
        }
      }

      // Handle keyboard shortcuts
      handleShortcuts(e);
    });

    // Synchronize scrolling and backdrop
    editor.addEventListener("scroll", () => {
      if (focusBackdrop) {
        focusBackdrop.scrollTop = editor.scrollTop;
        focusBackdrop.scrollLeft = editor.scrollLeft;
      }
      if (state.viewMode === "split" && previewScrollWrapper) {
        const progress = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
        previewScrollWrapper.scrollTop = progress * (previewScrollWrapper.scrollHeight - previewScrollWrapper.clientHeight);
      }
    });

    // Selection and navigation updates for Focus Dimming
    ["keyup", "mouseup", "select"].forEach((ev) => {
      editor.addEventListener(ev, () => {
        updateCursorPosition();
        if (window.focusDim && window.focusDim.mode !== "off") {
          window.focusDim.render();
        }
      });
    });

    editor.addEventListener("keyup", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Enter", "Backspace", "Delete"].includes(e.key)) {
        window.typewriter.centerCaret(false);
      }
    });

    // Typewriter recentering after a click is deferred, and a new mousedown
    // cancels it: the text must never move under the cursor between the two
    // clicks of a word selection, or the double click selects a line above the
    // word (the smooth scroll moved the caret's target).
    let pendingClickRecenter = null;
    editor.addEventListener("mousedown", () => {
      clearTimeout(pendingClickRecenter);
      pendingClickRecenter = null;
      // Freeze a smooth scroll still animating from a previous click-recenter:
      // assigning scrollTop (behavior auto) cancels the ongoing smooth scroll.
      try { editor.scrollTop = editor.scrollTop; } catch (_) {}
    });
    editor.addEventListener("click", (e) => {
      updateCursorPosition();
      window.focusDim.render();
      if (e.detail > 1) return; // double/triple click: selecting, not moving
      clearTimeout(pendingClickRecenter);
      pendingClickRecenter = setTimeout(() => {
        pendingClickRecenter = null;
        window.typewriter.centerCaret(true);
      }, 300);
    });
    editor.addEventListener("dblclick", () => {
      clearTimeout(pendingClickRecenter);
      pendingClickRecenter = null;
    });

    // View Mode buttons
    document.getElementById("btnModeRaw")?.addEventListener("click", () => applyViewMode("raw"));
    document.getElementById("btnModeLive")?.addEventListener("click", () => applyViewMode("live"));
    document.getElementById("btnModeSplit")?.addEventListener("click", () => applyViewMode("split"));

    // Focus Dimming cycle button
    document.getElementById("btnFocusDim")?.addEventListener("click", () => {
      const mode = window.focusDim.cycleMode();
      updateFocusDimUI(mode);
    });

    // Typewriter toggle button
    document.getElementById("btnTypewriter")?.addEventListener("click", () => {
      const active = window.typewriter.toggle();
      updateTypewriterUI(active);
    });

    // Audio toggle button
    document.getElementById("btnAudioToggle")?.addEventListener("click", () => {
      const active = window.typewriterAudio.toggle();
      document.getElementById("btnAudioToggle")?.classList.toggle("active", active);
    });

    // Drawer toggle & tabs
    btnToggleDrawer?.addEventListener("click", toggleDrawer);
    btnCloseDrawer?.addEventListener("click", toggleDrawer);
    drawerOverlay?.addEventListener("click", toggleDrawer);

    tabOutline?.addEventListener("click", () => switchDrawerTab("outline"));
    tabFiles?.addEventListener("click", () => switchDrawerTab("files"));
    tabRecents?.addEventListener("click", () => switchDrawerTab("recents"));

    // Title button click -> explicit Rename/Move dialog (the label and the
    // dialog wording say so). An untitled buffer has nothing to rename: it gets
    // the first-path Save As dialog instead.
    docTitleBtn?.addEventListener("click", () => {
      if (!state.currentPath) {
        promptSaveAs();
        return;
      }
      promptRename();
    });

    // Stats pill click -> detailed modal
    statsPill?.addEventListener("click", showStatsModal);
    statsModalClose?.addEventListener("click", () => statsModal.classList.add("hidden"));

    // Formatting toolbar buttons (PubCraft style)
    [
      "tbBold", "tbItalic", "tbUnderline", "tbCenter",
      "tbH1", "tbH2", "tbH3", "tbUl", "tbOl", "tbTask",
      "tbQuote", "tbTable", "tbLink"
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("mousedown", (e) => e.preventDefault());
    });

    document.getElementById("tbBold")?.addEventListener("click", () => applyFormatting("bold"));
    document.getElementById("tbItalic")?.addEventListener("click", () => applyFormatting("italic"));
    document.getElementById("tbUnderline")?.addEventListener("click", () => applyFormatting("underline"));
    document.getElementById("tbCenter")?.addEventListener("click", () => applyFormatting("center"));
    document.getElementById("tbH1")?.addEventListener("click", () => applyFormatting("h1"));
    document.getElementById("tbH2")?.addEventListener("click", () => applyFormatting("h2"));
    document.getElementById("tbH3")?.addEventListener("click", () => applyFormatting("h3"));
    document.getElementById("tbQuote")?.addEventListener("click", () => applyFormatting("quote"));
    document.getElementById("tbUl")?.addEventListener("click", () => applyFormatting("ul"));
    document.getElementById("tbOl")?.addEventListener("click", () => applyFormatting("ol"));
    document.getElementById("tbTask")?.addEventListener("click", () => applyFormatting("task"));
    document.getElementById("tbTable")?.addEventListener("click", () => applyFormatting("table"));
    document.getElementById("tbLink")?.addEventListener("click", () => applyFormatting("link"));

    // Global click outside to close dropdowns
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown-wrapper")) {
        closeAllDropdowns();
      }
    });

    // Window resize synchronizes focus dim metrics
    window.addEventListener("resize", () => {
      if (window.focusDim) window.focusDim.syncMetrics();
      if (window.typewriter) window.typewriter.invalidate();
    });

    // Mouse movement wakes up Zen HUD
    document.addEventListener("mousemove", pokeHud);
  }

  // ------------------------------------------------------------- Shortcuts
  function handleShortcuts(e) {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const ctrl = isMac ? e.metaKey : e.ctrlKey;

    if (ctrl && e.shiftKey && e.key.toLowerCase() === "s") {
      // Must be checked before the generic Ctrl+S: Save As is a copy, not a save.
      e.preventDefault();
      promptSaveAs();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveFile();
      return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "o") {
      // Checked before the plain Ctrl+O branch: with Shift held this must open
      // the Outline, never the file dialog.
      e.preventDefault();
      toggleOutlineDrawer();
      return;
    }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      promptOpenFile();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "n") {
      e.preventDefault();
      newDocument();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "d") {
      e.preventDefault();
      const mode = window.focusDim.cycleMode();
      updateFocusDimUI(mode);
      return;
    }
    if (ctrl && e.key.toLowerCase() === "t" && !e.altKey) {
      e.preventDefault();
      const active = window.typewriter.toggle();
      updateTypewriterUI(active);
      return;
    }
    if (ctrl && e.altKey && (e.code === "KeyT" || e.key.toLowerCase() === "t")) {
      // e.key is "†" on macOS with Option held: the documented Ctrl+Alt+T sound
      // toggle never fired there. e.code is layout independent.
      e.preventDefault();
      const active = window.typewriterAudio.toggle();
      document.getElementById("btnAudioToggle")?.classList.toggle("active", active);
      return;
    }
    if (ctrl && e.key === "1") {
      e.preventDefault();
      applyViewMode("raw");
      return;
    }
    if (ctrl && e.key === "2") {
      e.preventDefault();
      applyViewMode("live");
      return;
    }
    if (ctrl && e.key === "3") {
      e.preventDefault();
      applyViewMode("split");
      return;
    }
    if (ctrl && e.key.toLowerCase() === "b") {
      e.preventDefault();
      applyFormatting("bold");
      return;
    }
    if (ctrl && e.key.toLowerCase() === "i") {
      e.preventDefault();
      applyFormatting("italic");
      return;
    }
    if (ctrl && e.key.toLowerCase() === "u") {
      e.preventDefault();
      applyFormatting("underline");
      return;
    }
    if (ctrl && e.key.toLowerCase() === "k") {
      e.preventDefault();
      applyFormatting("link");
      return;
    }
    if (e.key === "F11") {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "p") {
      e.preventDefault();
      printDocument();
      return;
    }
    if (e.key === "Escape") {
      closeAllDropdowns();
      if (!sideDrawer.classList.contains("collapsed")) {
        toggleDrawer();
      }
      closeFsModal();
      closeTableModal();
      statsModal?.classList.add("hidden");
    }
  }

  // ------------------------------------------------------------- Text Formatting Tools (PubCraft style)
  function replaceRange(start, end, text, selectStart, selectEnd) {
    if (state.readOnly) return; // protected document: no programmatic edits
    editor.focus();
    let replaced = false;
    editor.setSelectionRange(start, end);
    try {
      replaced = document.execCommand("insertText", false, text);
    } catch (_) {}
    if (!replaced) {
      editor.setRangeText(text, start, end, "preserve");
    }
    if (typeof selectStart === "number" && typeof selectEnd === "number") {
      editor.setSelectionRange(selectStart, selectEnd);
    }
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getLineBounds(text, start, end) {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = text.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = text.length;
    return { lineStart, lineEnd };
  }

  function prefixCurrentLines(text, start, end, prefix) {
    const { lineStart, lineEnd } = getLineBounds(text, start, end);
    const chunk = text.substring(lineStart, lineEnd);
    const lines = chunk.split("\n");
    const allPrefixed = lines.length > 0 && lines.every((l) => l.startsWith(prefix));
    const newLines = lines.map((l) => {
      if (allPrefixed) {
        return l.substring(prefix.length);
      }
      const cleaned = l.replace(/^(#{1,6}\s+|>\s+|-\s+(\[\s?x?\]\s+)?|\d+\.\s+)/, "");
      return prefix + cleaned;
    });
    return newLines.join("\n");
  }

  function prefixNumberLines(text, start, end) {
    const { lineStart, lineEnd } = getLineBounds(text, start, end);
    const chunk = text.substring(lineStart, lineEnd);
    const lines = chunk.split("\n");
    const allNumbered = lines.length > 0 && lines.every((l) => /^\d+\.\s+/.test(l));
    const newLines = lines.map((l, i) => {
      if (allNumbered) {
        return l.replace(/^\d+\.\s+/, "");
      }
      const cleaned = l.replace(/^(#{1,6}\s+|>\s+|-\s+(\[\s?x?\]\s+)?|\d+\.\s+)/, "");
      return `${i + 1}. ${cleaned}`;
    });
    return newLines.join("\n");
  }

  function applyFormatting(action) {
    if (state.readOnly) return; // toolbar and formatting shortcuts
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const val = editor.value;
    const selectedText = val.substring(start, end);

    let replacement = "";
    let newCursorStart = start;
    let newCursorEnd = end;

    switch (action) {
      case "bold":
        if (start >= 2 && end <= val.length - 2 && val.substring(start - 2, start) === "**" && val.substring(end, end + 2) === "**") {
          replaceRange(start - 2, end + 2, selectedText, start - 2, end - 2);
          return;
        }
        if (selectedText.startsWith("**") && selectedText.endsWith("**") && selectedText.length >= 4) {
          replacement = selectedText.slice(2, -2);
          replaceRange(start, end, replacement, start, start + replacement.length);
          return;
        }
        replacement = `**${selectedText || ""}**`;
        newCursorStart = selectedText ? start : start + 2;
        newCursorEnd = selectedText ? start + replacement.length : start + 2;
        replaceRange(start, end, replacement, newCursorStart, newCursorEnd);
        return;

      case "italic":
        if (start >= 1 && end <= val.length - 1 && val[start - 1] === "*" && val[end] === "*" && (start < 2 || val[start - 2] !== "*") && (end >= val.length - 1 || val[end + 1] !== "*")) {
          replaceRange(start - 1, end + 1, selectedText, start - 1, end - 1);
          return;
        }
        if (selectedText.startsWith("*") && selectedText.endsWith("*") && selectedText.length >= 2 && !selectedText.startsWith("**")) {
          replacement = selectedText.slice(1, -1);
          replaceRange(start, end, replacement, start, start + replacement.length);
          return;
        }
        replacement = `*${selectedText || ""}*`;
        newCursorStart = selectedText ? start : start + 1;
        newCursorEnd = selectedText ? start + replacement.length : start + 1;
        replaceRange(start, end, replacement, newCursorStart, newCursorEnd);
        return;

      case "underline":
        if (selectedText.startsWith("<u>") && selectedText.endsWith("</u>") && selectedText.length >= 7) {
          replacement = selectedText.slice(3, -4);
          replaceRange(start, end, replacement, start, start + replacement.length);
          return;
        }
        replacement = `<u>${selectedText || ""}</u>`;
        newCursorStart = selectedText ? start : start + 3;
        newCursorEnd = selectedText ? start + replacement.length : start + 3;
        replaceRange(start, end, replacement, newCursorStart, newCursorEnd);
        return;

      case "center":
        if (selectedText.startsWith("<p align=\"center\">") && selectedText.endsWith("</p>")) {
          replacement = selectedText.slice(18, -4);
          replaceRange(start, end, replacement, start, start + replacement.length);
          return;
        }
        replacement = `<p align="center">${selectedText || ""}</p>`;
        newCursorStart = selectedText ? start : start + 18;
        newCursorEnd = selectedText ? start + replacement.length : start + 18;
        replaceRange(start, end, replacement, newCursorStart, newCursorEnd);
        return;

      case "h1":
        replacement = prefixCurrentLines(val, start, end, "# ");
        break;

      case "h2":
        replacement = prefixCurrentLines(val, start, end, "## ");
        break;

      case "h3":
        replacement = prefixCurrentLines(val, start, end, "### ");
        break;

      case "ul":
        replacement = prefixCurrentLines(val, start, end, "- ");
        break;

      case "ol":
        replacement = prefixNumberLines(val, start, end);
        break;

      case "task":
        replacement = prefixCurrentLines(val, start, end, "- [ ] ");
        break;

      case "quote":
        replacement = prefixCurrentLines(val, start, end, "> ");
        break;

      case "code":
        if (selectedText.includes("\n")) {
          replacement = `\`\`\`\n${selectedText}\n\`\`\`\n`;
          newCursorStart = start + 4;
          newCursorEnd = newCursorStart + selectedText.length;
        } else {
          replacement = `\`${selectedText || ""}\``;
          newCursorStart = selectedText ? start : start + 1;
          newCursorEnd = selectedText ? start + replacement.length : start + 1;
        }
        replaceRange(start, end, replacement, newCursorStart, newCursorEnd);
        return;

      case "link":
        if (selectedText) {
          replacement = `[${selectedText}](https://)`;
          newCursorStart = start + selectedText.length + 3;
          newCursorEnd = newCursorStart + 8;
        } else {
          replacement = `[testo](https://)`;
          newCursorStart = start + 1;
          newCursorEnd = start + 6;
        }
        replaceRange(start, end, replacement, newCursorStart, newCursorEnd);
        return;

      case "table":
        openTableModal();
        return;
    }

    if (["h1", "h2", "h3", "ul", "ol", "task", "quote"].includes(action)) {
      const lineInfo = getLineBounds(val, start, end);
      replaceRange(lineInfo.lineStart, lineInfo.lineEnd, replacement, lineInfo.lineStart, lineInfo.lineStart + replacement.length);
    }
  }

  // Table Modal
  const tableModal = document.getElementById("tableModal");
  const tableColsInput = document.getElementById("tableColsInput");
  const tableRowsInput = document.getElementById("tableRowsInput");
  const btnTableCancel = document.getElementById("btnTableCancel");
  const btnTableInsert = document.getElementById("btnTableInsert");

  function openTableModal() {
    if (tableModal) {
      tableModal.classList.remove("hidden");
      if (tableColsInput) tableColsInput.focus();
    }
  }

  function closeTableModal() {
    if (tableModal) {
      tableModal.classList.add("hidden");
    }
  }

  function insertMarkdownTable() {
    if (state.readOnly) return;
    const cols = Math.max(1, Math.min(10, parseInt(tableColsInput?.value, 10) || 3));
    const rows = Math.max(1, Math.min(20, parseInt(tableRowsInput?.value, 10) || 3));

    let header = "|";
    let sep = "|";
    for (let c = 1; c <= cols; c++) {
      header += ` Colonna ${c} |`;
      sep += " :--- |";
    }
    let md = `\n${header}\n${sep}\n`;
    for (let r = 1; r <= rows; r++) {
      let row = "|";
      for (let c = 1; c <= cols; c++) {
        row += ` Elemento ${r}.${c} |`;
      }
      md += `${row}\n`;
    }
    md += "\n";

    closeTableModal();

    const start = editor.selectionStart !== undefined ? editor.selectionStart : editor.value.length;
    const end = editor.selectionEnd !== undefined ? editor.selectionEnd : start;
    replaceRange(start, end, md, start + 3, start + 12);
  }

  // ------------------------------------------------------------- HUD & Stats
  function pokeHud() {
    document.body.classList.remove("is-typing");
    const tb = document.getElementById("formattingToolbar");
    if (tb) tb.classList.remove("hud-dimmed");
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      if (document.activeElement === editor && !document.querySelector(".modal-backdrop:not(.hidden)")) {
        document.body.classList.add("is-typing");
        if (tb && !tb.matches(":hover") && !tb.matches(":focus-within")) {
          tb.classList.add("hud-dimmed");
        }
      }
    }, 2400);
  }

  // Above this size the outline and preview debounces slow down, so a big
  // document never pays a full parse per burst of typing.
  const LARGE_DOC_BYTES = 150000;

  function outlineDelayMs() {
    return editor.value.length > LARGE_DOC_BYTES ? 400 : 120;
  }

  function previewDelayMs() {
    return editor.value.length > LARGE_DOC_BYTES ? 400 : 150;
  }

  function updateAll() {
    // Per keystroke: cursor position is allocation-free; the word/sentence
    // statistics are debounced (they walk the whole document with several
    // regexes and nobody reads them while typing).
    updateCursorPosition();
    window.outline.update(outlineDelayMs());
    scheduleStats();
    // Debounce preview: marked.parse su doc intero a ogni tasto laggava (Typora rende incrementale).
    clearTimeout(state.previewTimer);
    if (state.viewMode === "live" || state.viewMode === "split") {
      state.previewTimer = setTimeout(() => {
        state.previewTimer = null;
        window.livePreview.render(editor.value);
      }, previewDelayMs());
    }
  }

  function updateAllNow() {
    updateWordCountAndStats();
    updateCursorPosition();
    window.outline.update();
    if (state.viewMode === "live" || state.viewMode === "split") {
      window.livePreview.render(editor.value);
    }
  }

  // Debounced statistics: the status bar and the stats modal read them when
  // the user pauses, not on every keystroke.
  function scheduleStats() {
    clearTimeout(state.statsTimer);
    state.statsTimer = setTimeout(() => {
      state.statsTimer = null;
      updateWordCountAndStats();
    }, 250);
  }

  function updateWordCountAndStats() {
    const text = editor.value || "";
    const words = (text.trim().match(/\S+/g) || []).length;
    const chars = text.length;
    const charsNoSpaces = text.replace(/\s+/g, "").length;

    // Sentences
    const sentences = (text.match(/[^.!?\n]+(?:[.!?]+(?=[\s\n]|$)|[\n]|$)/g) || []).filter((s) => s.trim().length > 0).length;

    // Paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

    // Reading time: 200 words per minute
    const readMinutes = Math.max(1, Math.ceil(words / 200));

    statWords.textContent = `${words} ${words === 1 ? "parola" : "parole"}`;
    statReadTime.textContent = `${readMinutes} min lettura`;

    statusChars.textContent = `${chars} caratteri`;
    statusSentences.textContent = `${sentences} frasi`;
    statusParagraphs.textContent = `${paragraphs} paragrafi`;

    // Box modal elements
    document.getElementById("boxWords").textContent = words;
    document.getElementById("boxChars").textContent = chars;
    document.getElementById("boxCharsNoSpaces").textContent = charsNoSpaces;
    document.getElementById("boxSentences").textContent = sentences;
    document.getElementById("boxParagraphs").textContent = paragraphs;
    document.getElementById("boxReadTime").textContent = `${readMinutes} min`;
    document.getElementById("boxSpeakingTime").textContent = `${Math.max(1, Math.ceil(words / 130))} min`;
    document.getElementById("boxAvgWordLen").textContent = words > 0 ? (charsNoSpaces / words).toFixed(1) : "0";
  }

  function updateCursorPosition() {
    // Allocation-free: a native indexOf scan instead of substring + split
    // of the whole prefix on every keystroke.
    const selStart = editor.selectionStart || 0;
    const text = editor.value;
    let lineNum = 1;
    let lineStart = 0;
    for (;;) {
      const nl = text.indexOf("\n", lineStart);
      if (nl < 0 || nl >= selStart) break;
      lineNum += 1;
      lineStart = nl + 1;
    }
    const colNum = selStart - lineStart + 1;
    statusCursorPos.textContent = `Ln ${lineNum}, Col ${colNum}`;
  }

  function markDirty() {
    state.bufferRevision += 1;
    state.isDirty = true;
    if (updateReadOnlyStatus()) return;
    setSaveStatus(state.currentPath ? "○ Modificato" : "○ Non salvato", "unsaved");
  }

  // Clean only if (and only if) the buffer is the text that was just persisted.
  // `session` guards against a response belonging to another document; a
  // revision older than the newest persisted one means a disk reload advanced
  // the counters while this request was in flight, so the answer can neither
  // clean the buffer nor become its new mtime baseline.
  function confirmPersisted(session, revision) {
    if (session !== state.docSession) return "stale-session";
    if (revision < state.savedRevision) {
      // The disk content the buffer was brought in sync with is older than what
      // this write put there: the buffer is not what is persisted anymore.
      state.isDirty = true;
      setSaveStatus("○ Modificato", "unsaved");
      return "stale";
    }
    if (revision > state.savedRevision) state.savedRevision = revision;
    state.isDirty = state.bufferRevision !== state.savedRevision;
    if (state.isDirty) {
      // The user typed while the request was in flight: the old text is on
      // disk, the newer one is not. Keep beforeunload armed and the HUD honest.
      setSaveStatus("○ Modificato", "unsaved");
      return "dirty";
    }
    state.remoteChanged = false;
    if (!updateReadOnlyStatus()) setSaveStatus("● Salvato", "saved");
    return "clean";
  }

  // The whole buffer is known to be on disk (opened, reloaded from disk, or a
  // brand-new empty untitled buffer).
  function markBufferClean(clean, statusText) {
    state.savedRevision = state.bufferRevision;
    state.isDirty = !clean;
    if (clean) state.remoteChanged = false;
    if (updateReadOnlyStatus()) return;
    if (statusText) setSaveStatus(statusText, clean ? "saved" : "unsaved");
  }

  // A copy/rename that was not confirmed must not flush the edits typed while it
  // was pending onto the old path: the debounce created during the request (or a
  // coalesced follow-up) belongs to the unconfirmed operation. Only the current
  // document is touched; a late answer for an abandoned document must not cancel
  // the new document's timer. Autosave stays enabled for the next explicit edit.
  function discardPendingAutosave(ctx, isCopy) {
    // Only the copy branch discards on failure: a failed explicit rename leaves
    // the source as the current document, so the pending edits still belong to it
    // and normal autosave may resume. A successful-but-unadopted (stale) rename
    // passes isCopy=true as well, to avoid flushing to an old path.
    if (!isCopy) return;
    if (!sameDocument(ctx) || state.currentPath !== ctx.path) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    state.saveQueued = false;
    state.saveQueuedExplicit = false;
    state.saveQueuedForce = false;
  }

  // Ends a transient "Saving..." indicator after a cancelled or failed operation
  // that already cleared the autosave timer, restoring the status of the buffer
  // (or the read-only lock).
  function restoreSaveStatus() {
    if (updateReadOnlyStatus()) return;
    if (state.isDirty) {
      setSaveStatus(state.currentPath ? "○ Modificato" : "○ Non salvato", "unsaved");
    } else {
      setSaveStatus("● Salvato", "saved");
    }
  }

  function setSaveStatus(text, kind) {
    if (!saveStatus) return;
    saveStatus.textContent = text;
    saveStatus.className = "save-status " + kind;
  }

  function updateDocTitle() {
    const name = state.currentPath ? baseName(state.currentPath) : "Senza titolo.md";
    docTitle.textContent = name;
    statusFilePath.textContent = state.currentPath || "Senza titolo";
    document.title = `${name} — TypeCraft`;
  }

  function updateFocusDimUI(mode) {
    const map = {
      off: "Focus: Spento",
      sentence: "Focus: Frase",
      paragraph: "Focus: Paragrafo",
    };
    focusDimLabel.textContent = map[mode] || "Focus";
    statusFocusIndicator.textContent = map[mode] || "Focus";
    document.getElementById("btnFocusDim")?.classList.toggle("active", mode !== "off");
    document.body.classList.toggle("focus-dim-active", mode !== "off");
    document.body.classList.toggle("focus-mode-paragraph", mode === "paragraph");
    document.body.classList.toggle("focus-mode-sentence", mode === "sentence");
  }

  function updateTypewriterUI(active) {
    typewriterLabel.textContent = active ? "Typewriter" : "Typewriter: Off";
    statusTypewriterIndicator.textContent = active ? "Typewriter: Centrato" : "Typewriter: Spento";
    document.getElementById("btnTypewriter")?.classList.toggle("active", active);
    document.body.classList.toggle("typewriter-active", active);
    if (active && window.typewriter) {
      window.typewriter.centerCaret(true);
    }
  }

  // ------------------------------------------------------------- File Operations
  //
  // Save protocol (document identity + revisions are explained next to `state`):
  // 1. `saveFile` never issues a second concurrent write. If a save (or a
  //    rename) for this session is on the wire, the request is coalesced into
  //    `saveQueued`, and the running pass starts one follow-up with the newest
  //    snapshot after it succeeds. An explicit Ctrl+S is remembered separately
  //    so a queued autosave cannot silently downgrade it.
  // 2. Every pass captures path/revision/content up front and only applies its
  //    response while the session and the document are unchanged. A pass that
  //    is still waiting in `writeChain` re-checks the session when the queue
  //    pops, so a task of an abandoned document is never sent at all (requests
  //    already on the wire are a distinct, unavoidable case).
  // 3. Each request carries the opaque `expected_revision` baseline; the
  //    revision is resolved when the task actually runs, so a save queued behind
  //    another write uses the revision that write confirmed. The success
  //    response is the new baseline for the text that was written.
  // 4. Only a successful write cleans a revision. Errors and conflicts leave
  //    the buffer dirty (beforeunload stays armed) and never retry on their
  //    own: an explicit save may ask for a single overwrite of a disk
  //    conflict, sent as `force: true` on exactly one request. Missing or
  //    malformed protocol revisions are errors (428/400), never a forced save.
  function saveFile(isAutosave) {
    if (state.readOnly) {
      if (isAutosave) {
        // No dialog, no write, no invented path: just keep the indicator.
        updateReadOnlyStatus();
        return Promise.resolve();
      }
      // An explicit save of a protected document is only possible as a copy.
      promptSaveAs();
      return Promise.resolve();
    }
    if (!state.currentPath) {
      if (isAutosave) {
        setSaveStatus("○ Non salvato", "unsaved");
        return Promise.resolve();
      }
      promptSaveAs();
      return Promise.resolve();
    }

    if (state.renameInFlight && state.renameInFlight.session === state.docSession) {
      // The rename is moving this document: sending the old path now would
      // recreate the source file. Let the rename finish and save afterwards.
      state.saveQueued = true;
      if (!isAutosave) state.saveQueuedExplicit = true;
      return state.renameInFlight.promise;
    }

    if (state.saveInFlight && state.saveInFlight.session === state.docSession) {
      state.saveQueued = true;
      if (!isAutosave) state.saveQueuedExplicit = true;
      return state.saveInFlight.promise;
    }

    return runSave(isAutosave ? "auto" : "explicit");
  }

  function runSave(mode, opts) {
    const ctx = captureContext();
    if (!ctx.path) return Promise.resolve();

    // Whatever the debounce had scheduled is already part of this snapshot.
    clearTimeout(state.saveTimer);
    state.saveTimer = null;

    const forceOverwrite = !!(opts && opts.forceOverwrite);
    const explicit = mode === "explicit" || state.saveQueuedExplicit;
    state.saveQueued = false;
    state.saveQueuedExplicit = false;
    state.saveQueuedForce = false;

    if (sameDocument(ctx)) setSaveStatus("● Salvataggio...", "saving");

    // Any document write bumps the generation: watchdog answers captured before
    // this point are outdated even if revisions and mtime have not moved yet.
    state.writeEpoch += 1;

    const record = { session: ctx.session, revision: ctx.revision, promise: null };
    record.promise = enqueueWrite(() => performSave(ctx, explicit, forceOverwrite));
    state.saveInFlight = record;
    const release = () => {
      if (state.saveInFlight === record) state.saveInFlight = null;
    };
    record.promise.then(release, release);
    return record.promise;
  }

  async function performSave(ctx, explicit, forceOverwrite) {
    // The task is being taken from the write queue: its document may have been
    // left while it was waiting. Do not touch the server for it.
    if (!sameDocument(ctx)) return;

    // The baseline is resolved when the request is actually sent, so a save
    // queued behind another write of this session uses the revision that write
    // confirmed. It is still a baseline we legitimately hold: a watchdog reload
    // cannot slip in while a write is queued (writeEpoch / pending checks).
    const expectedRevision = (sameDocument(ctx) && state.currentPath === ctx.path)
      ? state.diskRevision
      : ctx.diskRevision;

    let outcome = "error";
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          path: ctx.path,
          content: ctx.content,
          // Opaque content revision, compared for equality by the server. Never
          // a timestamp and never parsed as a number.
          expected_revision: expectedRevision || "",
          // One-shot explicit overwrite authorised by the user after a conflict.
          force: !!forceOverwrite,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        // Parsing a body is an await: the document may have been left while it
        // was decoding. Never clean, adopt or status another session.
        if (!sameDocument(ctx)) return;
        if (!isWriteSuccess(data)) {
          // HTTP 200 is not a protocol confirmation: keep the buffer dirty, do
          // not adopt path/revision and do not start a follow-up. The server may
          // already have written; there is no rollback and no blind retry.
          setSaveStatus("⚠️ Risposta del server non valida", "unsaved");
          outcome = "protocol";
        } else {
          outcome = "ok";
          state.writeEpoch += 1;
          const persisted = confirmPersisted(ctx.session, ctx.revision);
          // A stale confirmation (a reload advanced the counters meanwhile)
          // must not stamp a new baseline on a text the server did not confirm.
          if (persisted !== "stale") {
            // Baseline of the version that was actually written, for the next
            // save/rename of this session.
            state.diskRevision = data.revision;
            if (typeof data.read_only === "boolean") {
              applyReadOnly(data.read_only, data.read_only_reason);
            }
            // The server resolves the path; adopt it only while this session is
            // still the current one and no rename has taken ownership.
            if (data.path && state.currentPath === ctx.path
                && !(state.renameInFlight && state.renameInFlight.session === ctx.session)) {
              state.currentPath = data.path;
              window.livePreview.setBaseDir(dirOf(data.path));
            }
          }
        }
      } else if (res.status === 409) {
        const data = await res.json().catch(() => null);
        // Re-check after parsing: a delayed conflict body must not prompt or
        // change the status of a new/other document.
        if (!sameDocument(ctx)) return;
        const conflict = data && typeof data.conflict === "string" ? data.conflict : "";
        const treatAsExplicit = explicit || state.saveQueuedExplicit;
        if (forceOverwrite) {
          // The single authorized overwrite conflicted anyway: stop here. Asking
          // again would be an unbounded confirmation/retry loop.
          setSaveStatus("⚠️ Modificato su disco — ricarica", "unsaved");
          outcome = "conflict";
        } else if (conflict === "file_missing") {
          // The file was deleted externally: an overwrite question would be
          // misleading (an explicit force does not recreate it either).
          setSaveStatus("⚠️ File rimosso su disco", "unsaved");
          state.remoteChanged = true;
          outcome = "conflict";
        } else if (conflict !== "revision_mismatch") {
          // Unknown/malformed conflict: a protocol error, never an implicit
          // overwrite consent.
          setSaveStatus("⚠️ Conflitto non riconosciuto dal server", "unsaved");
          outcome = "protocol";
        } else if (!treatAsExplicit) {
          // Autosave must not block on a modal: only an explicit save asks.
          setSaveStatus("⚠️ Modificato su disco", "unsaved");
          state.remoteChanged = true;
          outcome = "conflict";
        } else {
          setSaveStatus("⚠️ Modificato su disco — ricarica", "unsaved");
          if (confirm("Il file e' cambiato su disco. Sovrascrivere comunque?")) {
            // Final context check right before scheduling the overwrite.
            if (!sameDocument(ctx)) return;
            // One authorized overwrite, carried by the next pass only.
            state.saveQueued = true;
            state.saveQueuedExplicit = true;
            state.saveQueuedForce = true;
            outcome = "retry";
          } else {
            outcome = "conflict";
          }
        }
      } else if (res.status === 403) {
        const data = await res.json().catch(() => null);
        if (!sameDocument(ctx)) return;
        const code = data && typeof data.error === "string" ? data.error : "";
        if (code === "read_only") {
          // The protection changed after the last poll: lock the document, keep
          // the text dirty, never turn the refusal into a conflict to force.
          applyReadOnly(true, data.read_only_reason || "");
          setSaveStatus("🔒 Sola lettura — modifiche non salvate", "readonly");
          state.remoteChanged = false;
          outcome = "protocol";
        } else {
          setSaveStatus("⚠️ Scrittura non consentita", "unsaved");
          outcome = "error";
        }
      } else if (res.status === 428) {
        // No baseline (protocol error): never turned into a forced save.
        if (sameDocument(ctx)) setSaveStatus("⚠️ Revisione mancante — riapri il file", "unsaved");
        outcome = "error";
      } else if (res.status === 400) {
        if (sameDocument(ctx)) setSaveStatus("⚠️ Revisione non valida", "unsaved");
        outcome = "error";
      } else if (res.status === 401) {
        if (sameDocument(ctx)) setSaveStatus("⚠️ Sessione scaduta — ricarica", "unsaved");
        outcome = "error";
      } else {
        if (sameDocument(ctx)) setSaveStatus("⚠️ Errore salvataggio", "unsaved");
        outcome = "error";
      }
    } catch (e) {
      if (sameDocument(ctx)) {
        console.error("Save error:", e);
        setSaveStatus("⚠️ Connessione persa", "unsaved");
      }
      outcome = "error";
    }

    // A response of another document must not touch the current document's
    // status, timers or queued work.
    if (!sameDocument(ctx)) return;

    // A rename is moving this document: the follow-up (if any) belongs to the
    // rename completion, which knows the new path.
    if (state.renameInFlight && state.renameInFlight.session === ctx.session) {
      if (outcome === "ok" || outcome === "retry") state.saveQueued = true;
      return;
    }

    if ((outcome === "ok" || outcome === "retry") && state.saveQueued) {
      const nextExplicit = state.saveQueuedExplicit;
      const nextForce = state.saveQueuedForce;
      state.saveQueued = false;
      state.saveQueuedExplicit = false;
      state.saveQueuedForce = false;
      runSave(nextExplicit ? "explicit" : "auto", { forceOverwrite: nextForce });
    } else if (outcome !== "ok" && outcome !== "retry") {
      // No automatic retry: the dirty flag and the status line carry the news.
      state.saveQueued = false;
      state.saveQueuedExplicit = false;
      state.saveQueuedForce = false;
    }
  }

  // ------------------------------------------------- External change watchdog
  //
  // A document can be edited from another machine on a shared folder, by git, or
  // by any other editor. Typora fixed exactly this in 1.13.7; TypeCraft only
  // noticed at save time, and by then the choice was "overwrite or lose".
  function startExternalWatch() {
    if (state.watchTimer) return;
    state.watchTimer = setInterval(checkExternalChange, 5000);
  }

  async function checkExternalChange() {
    if (!state.currentPath || !state.appToken) return;
    if (writePendingForCurrentSession()) return;
    if (typeof document.hidden !== "undefined" && document.hidden) return;

    const statCtx = captureContext();
    let stat;
    try {
      const res = await apiGet("/api/stat?path=" + encodeURIComponent(statCtx.path));
      if (!res.ok) return;
      stat = await res.json();
    } catch (_) {
      // Offline for a tick is not an error worth surfacing.
      return;
    }

    // A write may have started (or been queued) while the stat was in flight:
    // that snapshot predates it. `writeEpoch` also catches a write that already
    // completed before this point, so a temporary flag is not the only guard.
    if (writePendingForCurrentSession()) return;
    if (!unchangedSince(statCtx)) return;

    // The protection policy can change with identical content and revision, so
    // it is part of the watchdog comparison. Applying it does not write: it
    // locks/unlocks the editor and cancels a pending autosave on lock.
    if (typeof stat.read_only === "boolean" && stat.read_only !== state.readOnly) {
      applyReadOnly(stat.read_only, stat.read_only_reason);
    }

    if (stat.exists === false) {
      // Keep the old baseline on purpose: a later save must conflict instead of
      // silently recreating the deleted file.
      if (!state.remoteChanged) {
        state.remoteChanged = true;
        setSaveStatus("⚠️ File rimosso su disco", "unsaved");
      }
      return;
    }

    const statRevision = typeof stat.revision === "string" ? stat.revision : "";
    if (!statRevision || statRevision === state.diskRevision) return;

    if (state.isDirty) {
      if (!state.remoteChanged) {
        state.remoteChanged = true;
        setSaveStatus("⚠️ Cambiato su disco", "unsaved");
      }
      return;
    }

    const fileCtx = captureContext();
    let data;
    try {
      const fileRes = await apiGet("/api/file?path=" + encodeURIComponent(fileCtx.path));
      if (!fileRes.ok) return;
      data = await fileRes.json();
    } catch (_) {
      return;
    }

    // Same rule after the read: the text on screen and the disk snapshot must
    // still be uncontested by any write, edit or document switch.
    if (writePendingForCurrentSession()) return;
    if (!unchangedSince(fileCtx)) return;

    const content = data.content == null ? "" : data.content;
    const revision = typeof data.revision === "string" ? data.revision : "";
    // The baseline only moves together with a coherent re-read of its content.
    if (!revision || revision !== statRevision) return;
    // The reloaded snapshot carries its own protection flag; adopt it only with
    // the content it belongs to.
    const reloadReadOnly = typeof data.read_only === "boolean" ? data.read_only : state.readOnly;
    if (content === editor.value) {
      state.diskRevision = revision;
      applyReadOnly(reloadReadOnly, data.read_only_reason);
      return;
    }

    // The reload keeps the same session but moves the revision counters with
    // the new text, so an older in-flight save cannot claim it as persisted.
    // The caret and the viewport stay where they were: an external edit that
    // does not touch this passage must not throw the writer to the end.
    const prevStart = editor.selectionStart;
    const prevEnd = editor.selectionEnd;
    const prevScroll = editor.scrollTop;
    window.typewriter.invalidate();
    editor.value = content;
    try {
      const max = editor.value.length;
      editor.setSelectionRange(Math.min(prevStart, max), Math.min(prevEnd, max));
    } catch (_) {}
    editor.scrollTop = prevScroll;
    state.diskRevision = revision;
    state.bufferRevision += 1;
    applyReadOnly(reloadReadOnly, data.read_only_reason);
    markBufferClean(true);
    updateAllNow();
    if (!updateReadOnlyStatus()) setSaveStatus("● Ricaricato dal disco", "saved");
  }

  async function openFile(filePath) {
    if (!filePath) return;
    if (state.isDirty) {
      if (!confirm("Ci sono modifiche non salvate. Aprire comunque il file?")) return;
    }
    return openFileNow(filePath);
  }

  async function openFileNow(filePath) {
    const seq = ++state.openSeq;
    const start = captureContext();
    let data;
    try {
      const res = await apiGet(`/api/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        if (seq === state.openSeq && sameDocument(start)) {
          alert("Impossibile aprire il file specificato.");
        }
        return;
      }
      data = await res.json();
    } catch (e) {
      if (seq === state.openSeq && sameDocument(start)) {
        alert("Errore durante la lettura del file: " + e);
      }
      return;
    }

    // The newest open request wins: a slower, older one is dropped.
    if (seq !== state.openSeq) return;
    // Another document was adopted meanwhile (new, another open, rename):
    // this response no longer describes what the user is editing.
    if (!sameDocument(start)) return;
    // Typing while the file was loading must not be discarded silently.
    if (state.bufferRevision !== start.revision || editor.value !== start.content) {
      if (!confirm("Hai modificato il documento mentre il file veniva aperto. Aprire comunque il nuovo file e perdere queste modifiche?")) {
        return;
      }
    }

    beginDocumentSession();
    window.typewriter.invalidate();
    editor.value = data.content == null ? "" : data.content;
    state.currentPath = data.path || "";
    state.diskRevision = typeof data.revision === "string" ? data.revision : "";
    state.bufferRevision = 0;
    markBufferClean(true, "● Salvato");
    applyReadOnly(data.read_only === true, data.read_only_reason);
    window.livePreview.setBaseDir(dirOf(state.currentPath));
    updateDocTitle();
    updateAllNow();
    window.typewriter.centerCaret(true);
    editor.focus();
    if (sideDrawer && !sideDrawer.classList.contains("collapsed")) {
      toggleDrawer();
    }
  }

  function newDocument() {
    if (state.isDirty) {
      if (!confirm("Ci sono modifiche non salvate. Creare un nuovo documento?")) {
        return;
      }
    }
    // Invalidate pending opens (their responses would otherwise adopt a file
    // the user is no longer waiting for) and every timer of the old document.
    state.openSeq += 1;
    beginDocumentSession();
    window.typewriter.invalidate();
    editor.value = "";
    state.currentPath = "";
    state.diskRevision = "";
    state.bufferRevision = 0;
    markBufferClean(true, "● Salvato");
    applyReadOnly(false);
    window.livePreview.setBaseDir(state.defaultDir || "");
    updateDocTitle();
    updateAllNow();
    editor.focus();
  }

  // ------------------------------------------------------------- File System Browser Modal
  let fsState = {
    mode: "saveAs", // "saveAs" | "open"
    currentDir: "",
    parentDir: "",
    locations: {},
    items: [],
    selectedItem: null,
  };

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0) + " " + sizes[i];
  }

  async function openFsModal(mode = "saveAs") {
    fsState.mode = mode;
    fsState.selectedItem = null;
    if (fsFilterInput) fsFilterInput.value = "";

    const isSaveDialog = isSaveFsMode(mode);
    if (isSaveDialog) {
      fsFileNameSection?.classList.remove("hidden");
      if (mode === "rename") {
        fsModalTitle.textContent = state.currentPath
          ? "Rinomina / Sposta documento (il file viene spostato)"
          : "Salva documento con nome";
        if (btnFsConfirm) btnFsConfirm.textContent = state.currentPath ? "Rinomina" : "Salva";
      } else if (mode === "saveCopy") {
        fsModalTitle.textContent = "Salva una copia (il documento originale non viene modificato)";
        if (btnFsConfirm) btnFsConfirm.textContent = "Salva copia";
      } else {
        fsModalTitle.textContent = state.currentPath
          ? "Salva con nome: crea una copia, il documento originale resta"
          : "Salva documento con nome";
        if (btnFsConfirm) btnFsConfirm.textContent = "Salva con nome";
      }

      // Suggested filename: current file name or first heading in doc or "Documento.md"
      let defaultName = "";
      if (state.currentPath) {
        defaultName = baseName(state.currentPath);
        if (mode !== "rename") {
          // Copy modes need a different name: the source path is refused as a
          // destination, so suggest a safe default instead of the same name.
          const dot = defaultName.lastIndexOf(".");
          defaultName = dot > 0
            ? defaultName.slice(0, dot) + "-copia" + defaultName.slice(dot)
            : defaultName + "-copia.md";
        }
      } else {
        const match = editor.value.match(/^#\s+(.+)$/m);
        if (match && match[1]) {
          const clean = match[1].trim().replace(/[/\\:*?"<>|]/g, "").slice(0, 50);
          defaultName = clean ? clean + ".md" : "Documento.md";
        } else {
          defaultName = "Documento.md";
        }
      }
      if (fsFileNameInput) fsFileNameInput.value = defaultName;
    } else {
      fsModalTitle.textContent = "Apri File Markdown";
      fsFileNameSection?.classList.add("hidden");
      if (btnFsConfirm) btnFsConfirm.textContent = "Apri";
    }

    const initPath = dirOf(state.currentPath) || state.defaultDir || "";
    fsModal?.classList.remove("hidden");
    await fsBrowse(initPath);

    if (isSaveDialog && fsFileNameInput) {
      fsFileNameInput.focus();
      const dotIdx = fsFileNameInput.value.lastIndexOf(".");
      if (dotIdx > 0) {
        fsFileNameInput.setSelectionRange(0, dotIdx);
      } else {
        fsFileNameInput.select();
      }
    }
  }

  function isSaveFsMode(mode) {
    return mode === "rename" || mode === "saveAs" || mode === "saveCopy";
  }

  function closeFsModal() {
    fsModal?.classList.add("hidden");
    if (fsFilterInput) fsFilterInput.value = "";
    fsState.selectedItem = null;
  }

  async function fsBrowse(path) {
    let url = "/api/fs";
    if (path) {
      url += "?path=" + encodeURIComponent(path);
    }
    try {
      const res = await apiGet(url);
      if (!res.ok) {
        const err = await res.text();
        alert("Impossibile aprire la cartella: " + err);
        return;
      }
      const data = await res.json();
      fsState.currentDir = data.current || "";
      fsState.parentDir = data.parent || "";
      fsState.locations = {
        home: data.home || "",
        documents: data.documents || "",
        desktop: data.desktop || "",
        downloads: data.downloads || "",
        workspace: data.workspace || state.defaultDir || "",
      };
      fsState.items = data.items || [];
      fsState.selectedItem = null;

      if (btnFsUp) btnFsUp.disabled = !data.parent;

      renderFsBreadcrumbs(data.current || "");
      renderFsList();
      updateFsDestinationPreview();
    } catch (e) {
      console.error("fsBrowse error:", e);
      alert("Errore durante la lettura delle cartelle: " + e);
    }
  }

  function renderFsBreadcrumbs(absPath) {
    if (!fsBreadcrumbs) return;
    fsBreadcrumbs.innerHTML = "";
    if (!absPath) return;

    const parts = absPath.split(/[\\/]+/).filter(Boolean);
    if (!parts.length) {
      const rootSpan = document.createElement("b");
      rootSpan.textContent = "/";
      fsBreadcrumbs.appendChild(rootSpan);
      return;
    }

    // Windows drive ("C:") is its own root crumb; POSIX keeps the "/" root.
    const isDrive = (s) => /^[a-zA-Z]:$/.test(s || "");
    if (absPath.startsWith("/")) {
      const rootBtn = document.createElement("button");
      rootBtn.type = "button";
      rootBtn.className = "fs-crumb-btn";
      rootBtn.textContent = "/";
      rootBtn.addEventListener("click", () => fsBrowse("/"));
      fsBreadcrumbs.appendChild(rootBtn);
    }

    parts.forEach((part, idx) => {
      if (idx > 0 || absPath.startsWith("/")) {
        const sep = document.createElement("span");
        sep.className = "fs-crumb-sep";
        sep.textContent = " / ";
        fsBreadcrumbs.appendChild(sep);
      }
      if (isDrive(part)) {
        const subPath = part + "/";
        if (idx === parts.length - 1) {
          const cur = document.createElement("b");
          cur.textContent = part;
          fsBreadcrumbs.appendChild(cur);
        } else {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "fs-crumb-btn";
          btn.textContent = part;
          btn.addEventListener("click", () => fsBrowse(subPath));
          fsBreadcrumbs.appendChild(btn);
        }
        return;
      }
      const subPath = (absPath.startsWith("/") ? "/" : "") + parts.slice(0, idx + 1).join("/");
      if (idx === parts.length - 1) {
        const cur = document.createElement("b");
        cur.textContent = part;
        fsBreadcrumbs.appendChild(cur);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fs-crumb-btn";
        btn.textContent = part;
        btn.addEventListener("click", () => fsBrowse(subPath));
        fsBreadcrumbs.appendChild(btn);
      }
    });

    fsBreadcrumbs.scrollLeft = fsBreadcrumbs.scrollWidth;
  }

  function renderFsList() {
    if (!fsList) return;
    fsList.innerHTML = "";
    const filter = (fsFilterInput?.value || "").trim().toLowerCase();

    const filtered = (fsState.items || []).filter((item) => {
      if (!filter) return true;
      return item.name.toLowerCase().includes(filter);
    });

    if (filtered.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "fs-empty-msg";
      emptyLi.textContent = filter ? "Nessun elemento corrispondente al filtro" : "Cartella vuota (nessun file markdown o sottocartella)";
      fsList.appendChild(emptyLi);
      return;
    }

    filtered.forEach((item) => {
      const li = document.createElement("li");
      li.className = "fs-item" + (item.is_dir ? " is-dir" : " is-file");
      if (fsState.selectedItem === item.name) {
        li.classList.add("selected");
      }

      const icon = document.createElement("span");
      icon.className = "fs-item-icon";
      icon.textContent = item.is_dir ? "📁" : "📄";

      const name = document.createElement("span");
      name.className = "fs-item-name";
      name.textContent = item.name;

      li.appendChild(icon);
      li.appendChild(name);

      if (!item.is_dir && typeof item.size === "number") {
        const size = document.createElement("span");
        size.className = "fs-item-size";
        size.textContent = formatBytes(item.size);
        li.appendChild(size);
      }

      if (item.is_dir) {
        li.addEventListener("click", () => {
          const next = fsState.currentDir.replace(/[\\/]+$/, "") + "/" + item.name;
          fsBrowse(next);
        });
      } else {
        li.addEventListener("click", () => {
          fsState.selectedItem = item.name;
          [...fsList.children].forEach((c) => c.classList.remove("selected"));
          li.classList.add("selected");

          if (isSaveFsMode(fsState.mode) && fsFileNameInput) {
            fsFileNameInput.value = item.name;
          }
          updateFsDestinationPreview();
        });

        li.addEventListener("dblclick", () => {
          if (fsState.mode === "open") {
            const fullPath = fsState.currentDir.replace(/[\\/]+$/, "") + "/" + item.name;
            closeFsModal();
            openFile(fullPath);
          } else {
            if (fsFileNameInput) fsFileNameInput.value = item.name;
            fsConfirmAction();
          }
        });
      }

      fsList.appendChild(li);
    });
  }

  function updateFsDestinationPreview() {
    if (!fsSelectedPath) return;
    const base = fsState.currentDir || "";
    if (isSaveFsMode(fsState.mode)) {
      const fn = (fsFileNameInput?.value || "").trim() || "...";
      const verb = fsState.mode === "rename" ? "Sposta in: " : "Copia in: ";
      fsSelectedPath.textContent = verb + base + (base ? "/" : "") + fn;
    } else {
      if (fsState.selectedItem) {
        fsSelectedPath.textContent = "Apri: " + base + (base ? "/" : "") + fsState.selectedItem;
      } else {
        fsSelectedPath.textContent = "Cartella: " + base;
      }
    }
  }

  async function fsConfirmAction() {
    if (isSaveFsMode(fsState.mode)) {
      const copyOnly = fsState.mode !== "rename";
      if (state.renameInFlight && state.renameInFlight.session === state.docSession) {
        // A Save As for this document is already on the wire: ignore duplicate
        // submits (double click, Enter) instead of sending two writes.
        return;
      }
      let name = (fsFileNameInput?.value || "").trim();
      if (!name) {
        alert("Inserisci un nome per il file.");
        fsFileNameInput?.focus();
        return;
      }
      // Only add ".md" when the user did not type an extension. A "Note v1.2"
      // is a title, not a file type; a "doc.fountain" is a deliberate choice and
      // gets one explicit question instead of a silent rename.
      const allowedExt = /\.(md|markdown|txt|mdown|mkd|mdwn|mdx)$/i;
      if (!allowedExt.test(name)) {
        const dot = name.lastIndexOf(".");
        const tail = dot > 0 ? name.slice(dot + 1) : "";
        const before = dot > 0 ? name.slice(0, dot) : name;
        const looksLikeExtension = /^[A-Za-z0-9]{1,8}$/.test(tail) && !/\s/.test(before);
        if (!looksLikeExtension) {
          name += ".md";
        } else {
          if (!confirm(`TypeCraft salva solo documenti Markdown. Salvare come "${name}.md"?`)) {
            fsFileNameInput?.focus();
            return;
          }
          name += ".md";
        }
      }

      const targetPath = fsState.currentDir.replace(/[\\/]+$/, "") + "/" + name;
      // A rename writes the whole buffer, so it is just another document write:
      // it is serialised behind a running save and owns the document until it
      // answers. Typing meanwhile keeps the buffer dirty and is persisted
      // afterwards on the *new* path, never on the old one.
      startRename(targetPath, name, { copy: copyOnly });
    } else {
      // mode === "open"
      if (!fsState.selectedItem) {
        alert("Seleziona un file Markdown da aprire.");
        return;
      }
      const fullPath = fsState.currentDir.replace(/[\\/]+$/, "") + "/" + fsState.selectedItem;
      closeFsModal();
      openFile(fullPath);
    }
  }

  function postRenameBody(body) {
    return fetch("/api/rename", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(body),
    });
  }

  function startRename(targetPath, displayName, opts) {
    const copy = !!(opts && opts.copy);
    const ctx = captureContext();
    const record = { session: ctx.session, revision: ctx.revision, promise: null };
    record.promise = enqueueWrite(() => performRename(ctx, record, targetPath, displayName, copy));
    state.renameInFlight = record;
    // A rename is a document write: invalidate watchdog answers in flight.
    state.writeEpoch += 1;
    // A debounced autosave for the old path is now the rename's job.
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    state.saveQueued = false;
    state.saveQueuedExplicit = false;
    state.saveQueuedForce = false;
    const release = () => {
      if (state.renameInFlight === record) state.renameInFlight = null;
    };
    record.promise.then(release, release);
    return record.promise;
  }

  async function performRename(ctx, record, targetPath, displayName, copy) {
    // The task is being taken from the write queue: a rename still waiting for
    // its turn must not move/delete the source of a document the user left.
    if (!sameDocument(ctx)) return;

    // The source baseline is resolved when the task runs, not when it was
    // enqueued: a rename queued behind a successful save of this session must
    // use the revision that save confirmed (and still keep the text snapshot
    // taken at request time).
    // A copy sends an empty old_path: the source is never written or removed and
    // no source baseline is needed. A normal Save As/rename keeps its protocol.
    const expectedRevision = copy
      ? ""
      : ((state.currentPath === ctx.path) ? state.diskRevision : ctx.diskRevision);
    const payload = {
      old_path: copy ? "" : (ctx.path || ""),
      new_path: targetPath,
      content: ctx.content,
      expected_revision: expectedRevision || "",
    };
    if (copy && ctx.path) {
      // Explicit copy source: the backend refuses a destination that aliases it
      // and never writes/removes the source. A first save has no source.
      payload.source_path = ctx.path;
    }
    let res;
    let data = null;
    try {
      res = await postRenameBody(payload);

      // Structured conflicts: only an existing destination may ask for the
      // overwrite consent. A changed or deleted source keeps the buffer intact
      // and is never retried with overwrite:true; unknown/malformed conflicts
      // are protocol errors, not overwrite consent.
      if (res.status === 409) {
        data = await res.json().catch(() => null);
        // Parsing the conflict body is an await: check the document again
        // before any confirmation, status or extra request.
        if (!sameDocument(ctx)) return;
        const conflict = data && typeof data.conflict === "string" ? data.conflict : "";
        if (conflict === "copy_same_source") {
          // The destination is the source itself: refuse clearly, never fall
          // back to a save or a rename, and never remove/modify the source.
          discardPendingAutosave(ctx, copy);
          setSaveStatus("⚠️ Destinazione uguale al documento originale", "unsaved");
          alert("Il nome scelto corrisponde al documento originale. Scegli un altro nome o un'altra cartella: l'originale non viene modificato.");
          return;
        }
        if (conflict !== "target_exists") {
          discardPendingAutosave(ctx, copy);
          if (conflict === "source_changed" || conflict === "source_missing") {
            setSaveStatus(conflict === "source_missing"
              ? "⚠️ File sorgente rimosso su disco"
              : "⚠️ Il documento e' cambiato su disco", "unsaved");
            alert(conflict === "source_missing"
              ? "Il documento di origine non esiste piu' su disco. Salvalo con un altro nome o riaprilo."
              : "Il documento e' cambiato su disco dopo la tua ultima lettura. Salvalo o riaprilo, poi riprova.");
          } else {
            setSaveStatus("⚠️ Conflitto non riconosciuto dal server", "unsaved");
            alert("Il server ha rifiutato il salvataggio con un conflitto non riconosciuto. Nessuna modifica e' stata fatta.");
          }
          return;
        }
        if (!confirm(`Esiste gia' un file chiamato "${displayName}" in questa cartella. Sostituirlo?`)) {
          discardPendingAutosave(ctx, copy);
          restoreSaveStatus();
          return;
        }
        // Final context check immediately before the destructive retry.
        if (!sameDocument(ctx)) return;
        res = await postRenameBody(Object.assign({}, payload, { overwrite: true }));
      }

      if (res.status === 403) {
        // A protection refusal is not a content conflict: no overwrite question,
        // no force retry. Distinguish a protected source from a protected
        // destination to lock the right document and say what happened.
        const errData = await res.json().catch(() => null);
        if (!sameDocument(ctx)) return;
        discardPendingAutosave(ctx, copy);
        const errCode = errData && typeof errData.error === "string" ? errData.error : "";
        const protectedPath = errData && typeof errData.path === "string" ? errData.path : "";
        if (errCode !== "read_only") {
          // An operational permission failure discovered at write time: keep the
          // document and its dirty text, always with a non-transient status.
          // `partial` means the destination was written but the source could not
          // be removed: say it explicitly, never claim success or rollback.
          if (errData && errData.partial === true) {
            setSaveStatus("⚠️ Rinomina incompleta — sorgente non rimosso", "unsaved");
            alert("La destinazione e' stata scritta ma il documento originale non e' stato rimosso. Controlla entrambi i file: nessun rollback automatico.\n\n"
              + (typeof errData.message === "string" && errData.message ? errData.message : ""));
          } else {
            setSaveStatus("⚠️ Scrittura non consentita", "unsaved");
            alert("Scrittura non consentita: controlla i permessi della cartella o del file.");
          }
          return;
        }
        const isSourceRefusal = !copy && protectedPath !== "" && protectedPath === (ctx.path || "");
        if (isSourceRefusal) {
          applyReadOnly(true, (errData && errData.read_only_reason) || "");
          setSaveStatus("🔒 Sola lettura — modifiche non salvate", "readonly");
          alert("Il documento e' in sola lettura. Usa «Salva una copia...» per salvare il testo altrove.");
        } else {
          // Only the destination is protected: the source document stays
          // editable and dirty, and the transient "saving" indicator must end.
          setSaveStatus("⚠️ Destinazione in sola lettura", "unsaved");
          alert("La destinazione e' in sola lettura: scegli un'altra cartella o un altro nome.");
        }
        return;
      }

      if (!res.ok) {
        // Read the body once, then try JSON: a partial outcome (503/500 included)
        // is JSON and must stay a readable "destination written, source not
        // removed" message, never a raw dump or a fake success.
        const raw = await res.text().catch(() => "");
        // Reading the error body is an await: the document may have changed
        // meanwhile, and its alert/timers belong to the session that asked.
        if (!sameDocument(ctx)) return;
        let errData = null;
        if (raw) {
          try {
            errData = JSON.parse(raw);
          } catch (_) {
            errData = null;
          }
        }
        discardPendingAutosave(ctx, copy);
        const conflict = errData && typeof errData.conflict === "string" ? errData.conflict : "";
        const partial = !!(errData && errData.partial === true);
        if (partial) {
          setSaveStatus("⚠️ Rinomina incompleta — sorgente non rimosso", "unsaved");
          alert("La destinazione e' stata scritta ma il documento originale non e' stato rimosso. Controlla entrambi i file: nessun rollback automatico.\n\n"
            + (errData && typeof errData.message === "string" && errData.message ? errData.message : ""));
          return;
        }
        if (conflict === "source_changed" || conflict === "source_missing") {
          setSaveStatus(conflict === "source_missing"
            ? "⚠️ File sorgente rimosso su disco"
            : "⚠️ Il documento e' cambiato su disco", "unsaved");
          alert(conflict === "source_missing"
            ? "Il documento di origine non esiste piu' su disco. Salvalo con un altro nome o riaprilo."
            : "Il documento e' cambiato su disco dopo la tua ultima lettura. Salvalo o riaprilo, poi riprova.");
          return;
        }
        setSaveStatus("⚠️ Rinomina non riuscita", "unsaved");
        alert("Impossibile salvare il file: " + (raw || "errore sconosciuto"));
        return;
      }

      data = await res.json().catch(() => null);

      // A late answer must not take possession of another document: the user
      // may have created a new one, opened a file, or started another rename.
      if (!sameDocument(ctx)) return;

      if (!isWriteSuccess(data)) {
        // HTTP 200 without a protocol-valid confirmation: keep the buffer dirty
        // and its current path/baseline. The server may already have moved the
        // file; there is no rollback and no blind retry.
        discardPendingAutosave(ctx, copy);
        setSaveStatus("⚠️ Risposta del server non valida", "unsaved");
        alert("Il server ha risposto senza una conferma valida. Controlla il file prima di riprovare.");
        return;
      }

      if (state.renameInFlight === record) state.renameInFlight = null;
      state.writeEpoch += 1;

      const newPath = data.path || targetPath;
      const persisted = confirmPersisted(ctx.session, ctx.revision);
      if (persisted !== "stale") {
        if (state.currentPath === ctx.path) {
          state.currentPath = newPath;
          window.livePreview.setBaseDir(dirOf(newPath));
          updateDocTitle();
        }
        state.diskRevision = data.revision;
        if (typeof data.read_only === "boolean") {
          applyReadOnly(data.read_only, data.read_only_reason);
        }
      }
      // Only the text that was actually sent is known to be on disk; anything
      // typed during the request keeps the buffer dirty and beforeunload armed.
      closeFsModal();
      editor.focus();
      loadWorkspace(dirOf(newPath));
      refreshRecents();

      if (persisted !== "stale" && state.isDirty && state.currentPath) {
        // Persist the edits made while the rename/copy was in flight, on the path
        // that was just adopted (never the old source).
        const nextExplicit = state.saveQueuedExplicit;
        state.saveQueued = false;
        state.saveQueuedExplicit = false;
        state.saveQueuedForce = false;
        runSave(nextExplicit ? "explicit" : "auto");
      } else {
        // Includes the defensive stale case: do not flush pending edits to a path
        // the UI did not adopt.
        discardPendingAutosave(ctx, true);
      }
    } catch (e) {
      if (sameDocument(ctx)) {
        discardPendingAutosave(ctx, copy);
        // The autosave timer was cleared when the operation started: end the
        // transient status as well.
        restoreSaveStatus();
        alert("Errore di rete durante il salvataggio: " + e);
      }
    }
  }

  async function fsCreateFolder() {
    const name = prompt("Nome della nuova cartella:");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (cleanName.includes("/") || cleanName.includes("\\") || cleanName.startsWith(".")) {
      alert("Nome cartella non valido.");
      return;
    }

    try {
      const res = await fetch("/api/mkdir", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          path: fsState.currentDir,
          name: cleanName,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        await fsBrowse(data.path || (fsState.currentDir.replace(/[\\/]+$/, "") + "/" + cleanName));
      } else {
        const err = await res.text();
        alert("Impossibile creare la cartella: " + err);
      }
    } catch (e) {
      alert("Errore creazione cartella: " + e);
    }
  }

  async function refreshRecents() {
    try {
      const res = await apiGet("/api/init");
      if (res.ok) {
        const data = await res.json();
        if (data.recents) renderRecents(data.recents);
      }
    } catch (_) {}
  }

  function promptOpenFile() {
    openFsModal("open");
  }

  function promptSaveAs() {
    // Save As (Ctrl+Shift+S / menu) always writes a copy: the source document is
    // kept. A protected document gets the explicit copy wording.
    openFsModal(state.readOnly ? "saveCopy" : "saveAs");
  }

  function promptRename() {
    // Explicitly a rename/move: the source is removed only on full success, with
    // the source revision, read-only, destination-consent and partial-outcome
    // rules unchanged.
    openFsModal("rename");
  }

  // ------------------------------------------------------------- Modals & Dialogs
  function showStatsModal() {
    updateWordCountAndStats();
    statsModal.classList.remove("hidden");
  }

  // ------------------------------------------------------------- Drawer & Tabs
  // Ctrl+Shift+O policy (see README: “Apri/Chiudi Indice Documento”): the
  // shortcut opens and selects the Outline tab; if the Outline tab is already
  // visible it closes the drawer. The plain-file dialog (Ctrl+O) is untouched.
  function toggleOutlineDrawer() {
    if (sideDrawer.classList.contains("collapsed")) {
      sideDrawer.classList.remove("collapsed");
      drawerOverlay.classList.remove("hidden");
      switchDrawerTab("outline");
    } else if (!panelOutline.classList.contains("active")) {
      switchDrawerTab("outline");
    } else {
      toggleDrawer();
    }
  }

  function toggleDrawer() {
    sideDrawer.classList.toggle("collapsed");
    drawerOverlay.classList.toggle("hidden", sideDrawer.classList.contains("collapsed"));
    if (!sideDrawer.classList.contains("collapsed")) {
      window.outline.update();
    }
  }

  function switchDrawerTab(tabName) {
    [tabOutline, tabFiles, tabRecents].forEach((t) => t?.classList.remove("active"));
    [panelOutline, panelFiles, panelRecents].forEach((p) => p?.classList.remove("active"));

    if (tabName === "outline") {
      tabOutline?.classList.add("active");
      panelOutline?.classList.add("active");
      window.outline.update();
    } else if (tabName === "files") {
      tabFiles?.classList.add("active");
      panelFiles?.classList.add("active");
    } else if (tabName === "recents") {
      tabRecents?.classList.add("active");
      panelRecents?.classList.add("active");
    }
  }

  function renderRecents(list) {
    if (!recentsList) return;
    recentsList.innerHTML = "";
    if (list.length === 0) {
      recentsList.innerHTML = '<li class="empty-outline">Nessun file recente</li>';
      return;
    }
    list.forEach((p) => {
      const li = document.createElement("li");
      li.className = "file-node";
      const icon = document.createElement("span");
      icon.textContent = "📄";
      const label = document.createElement("span");
      label.title = p;
      label.textContent = baseName(p);
      li.appendChild(icon);
      li.appendChild(document.createTextNode(" "));
      li.appendChild(label);
      li.addEventListener("click", () => openFile(p));
      recentsList.appendChild(li);
    });
  }

  async function loadWorkspace(dir) {
    try {
      const res = await apiGet(`/api/workspace?path=${encodeURIComponent(dir)}`);
      if (res.ok) {
        const data = await res.json();
        document.getElementById("workspaceRoot").textContent = String(data.root || "Workspace").split(/[\\/]+/).filter(Boolean).pop() || "Workspace";
        renderFileTree(data.tree, fileTree);
      }
    } catch (e) {
      console.warn("Workspace error:", e);
    }
  }

  function renderFileTree(node, container) {
    if (!node || !container) return;
    container.innerHTML = "";

    function walk(n, el) {
      if (!n.children) return;
      n.children.forEach((c) => {
        const item = document.createElement("div");
        item.className = "file-node";
        if (c.is_dir) {
          const icon = document.createElement("span");
          icon.textContent = "📁";
          const strong = document.createElement("strong");
          strong.textContent = c.name;
          item.appendChild(icon);
          item.appendChild(document.createTextNode(" "));
          item.appendChild(strong);
          const sub = document.createElement("div");
          sub.style.paddingLeft = "16px";
          el.appendChild(item);
          el.appendChild(sub);
          walk(c, sub);
        } else {
          const icon = document.createElement("span");
          icon.textContent = "📝";
          const label = document.createElement("span");
          label.textContent = c.name;
          item.appendChild(icon);
          item.appendChild(document.createTextNode(" "));
          item.appendChild(label);
          item.addEventListener("click", () => openFile(c.path));
          el.appendChild(item);
        }
      });
    }

    walk(node, container);
  }

  // ------------------------------------------------------------- Dropdowns & Actions
  function setupDropdowns() {
    btnFontMenu?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = fontMenu.classList.contains("hidden");
      closeAllDropdowns();
      if (isHidden) fontMenu.classList.remove("hidden");
    });

    btnThemeMenu?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = themeMenu.classList.contains("hidden");
      closeAllDropdowns();
      if (isHidden) themeMenu.classList.remove("hidden");
    });

    btnActionsMenu?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = actionsMenu.classList.contains("hidden");
      closeAllDropdowns();
      if (isHidden) actionsMenu.classList.remove("hidden");
    });

    fontMenu?.querySelectorAll("[data-font]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyFont(btn.dataset.font);
        closeAllDropdowns();
      });
    });

    themeMenu?.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTheme(btn.dataset.theme);
        closeAllDropdowns();
      });
    });

    // Actions items
    document.getElementById("actionNew")?.addEventListener("click", () => {
      closeAllDropdowns();
      newDocument();
    });
    document.getElementById("actionOpen")?.addEventListener("click", () => {
      closeAllDropdowns();
      promptOpenFile();
    });
    document.getElementById("actionSave")?.addEventListener("click", () => {
      closeAllDropdowns();
      saveFile();
    });
    document.getElementById("actionSaveAs")?.addEventListener("click", () => {
      closeAllDropdowns();
      promptSaveAs();
    });
    document.getElementById("actionExportHtml")?.addEventListener("click", () => {
      closeAllDropdowns();
      exportStandaloneHtml();
    });
    document.getElementById("actionPrint")?.addEventListener("click", () => {
      closeAllDropdowns();
      printDocument();
    });
    document.getElementById("actionFullscreen")?.addEventListener("click", () => {
      closeAllDropdowns();
      toggleFullscreen();
    });
  }

  function closeAllDropdowns() {
    fontMenu?.classList.add("hidden");
    themeMenu?.classList.add("hidden");
    actionsMenu?.classList.add("hidden");
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function exportStandaloneHtml() {
    // Render first: in raw mode the preview pane is empty (empty export bug).
    window.livePreview.render(editor.value);

    // Work on a copy: the live DOM carries the per-block "Copy" buttons.
    const clone = previewContent.cloneNode(true);
    clone.querySelectorAll(".btn-copy-code").forEach((b) => b.remove());
    const rendered = clone.innerHTML || "<p>(documento vuoto)</p>";
    const title = escapeHtml(baseName(state.currentPath).replace(/\.md$/i, "") || "Document");
    const standalone = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.8;
      max-width: 780px;
      margin: 40px auto;
      padding: 0 20px;
      color: #222;
      background: #fafafa;
    }
    h1, h2, h3 { line-height: 1.3; }
    h1 { border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    blockquote { border-left: 3px solid #007aff; margin: 1.5em 0; padding-left: 1em; color: #555; }
    code { background: #eee; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    pre { background: #f4f4f4; padding: 14px; border-radius: 6px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; margin: 1.5em 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; }
    th { background: #f0f0f0; }
  </style>
</head>
<body>
${rendered}
</body>
</html>`;

    const blob = new Blob([standalone], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (baseName(state.currentPath) || "document").replace(/\.md$/i, "") + ".html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // One print path for the menu and the Ctrl+P shortcut: the preview must be
  // rendered before printing, otherwise Focus mode printed a blank page.
  function printDocument() {
    window.livePreview.render(editor.value);
    document.body.classList.add("printing");
    const cleanup = () => document.body.classList.remove("printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1000);
    }, 60);
  }

  function setupModals() {
    // File System modal listeners
    btnFsClose?.addEventListener("click", closeFsModal);
    btnFsCancel?.addEventListener("click", closeFsModal);
    btnFsConfirm?.addEventListener("click", fsConfirmAction);
    btnFsUp?.addEventListener("click", () => {
      if (fsState.parentDir) fsBrowse(fsState.parentDir);
    });
    btnFsNewFolder?.addEventListener("click", fsCreateFolder);
    fsFilterInput?.addEventListener("input", renderFsList);
    fsFileNameInput?.addEventListener("input", updateFsDestinationPreview);
    fsFileNameInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        fsConfirmAction();
      }
    });

    fsQuickBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-target");
        const dest = fsState.locations ? fsState.locations[target] : "";
        if (dest) {
          fsBrowse(dest);
        } else if (target === "home") {
          fsBrowse("~");
        }
      });
    });

    fsModal?.addEventListener("click", (e) => {
      if (e.target === fsModal) closeFsModal();
    });

    // Table Modal listeners
    btnTableCancel?.addEventListener("click", closeTableModal);
    btnTableInsert?.addEventListener("click", insertMarkdownTable);
    tableModal?.addEventListener("click", (e) => {
      if (e.target === tableModal) closeTableModal();
    });
    [tableColsInput, tableRowsInput].forEach((inp) => {
      inp?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          insertMarkdownTable();
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeTableModal();
        }
      });
    });

    // Closing the window with unsaved edits used to lose them silently.
    window.addEventListener("beforeunload", (e) => {
      if (!state.isDirty && state.bufferRevision === state.savedRevision) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    });
  }

  // Run app
  document.addEventListener("DOMContentLoaded", initApp);
})();
