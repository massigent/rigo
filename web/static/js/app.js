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
  const appModal = document.getElementById("appModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalDescription = document.getElementById("modalDescription");
  const modalInput = document.getElementById("modalInput");
  const modalBtnCancel = document.getElementById("modalBtnCancel");
  const modalBtnConfirm = document.getElementById("modalBtnConfirm");
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
  let state = {
    currentPath: "",
    currentModTime: 0,
    defaultDir: "",
    isDirty: false,
    viewMode: "raw", // "raw" | "live" | "split"
    theme: "ia-light",
    font: "ia-mono",
    saveTimer: null,
    typingTimer: null,
    previewTimer: null,
    appToken: "",
    eventSource: null,
    saving: false,
    watchTimer: null,
    remoteChanged: false,
  };

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

  function apiUrl(p) {
    if (!state.appToken) return p;
    const sep = p.includes("?") ? "&" : "?";
    return p + sep + "token=" + encodeURIComponent(state.appToken);
  }

  // Exposed for the preview engine (local images need the tokenised URL).
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

    try {
      const res = await fetch(apiUrl("/api/init"));
      if (res.ok) {
        const data = await res.json();
        if (data.token) state.appToken = data.token;
        if (data.default_dir) state.defaultDir = data.default_dir;
        if (data.active_file) {
          // A real document is open (even if it is empty).
          editor.value = data.file_content || "";
          state.currentPath = data.active_file;
          state.currentModTime = 0;
        } else {
          // Welcome text is not a file: it must never be auto-saved, otherwise
          // every keystroke popped the "Save as" dialog after 1.5s.
          editor.value = getWelcomeMarkdown();
          state.currentPath = "";
        }
        updateDocTitle();
        renderRecents(data.recents || []);
        if (data.active_dir) {
          loadWorkspace(data.active_dir);
        }
      }
    } catch (e) {
      console.warn("Init fallback:", e);
      editor.value = getWelcomeMarkdown();
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
    // A file opened at launch has no known mod time yet: without this the first
    // autosave skipped the conflict check and overwrote changes made elsewhere.
    await refreshModTime();
    startExternalWatch();
    window.typewriter.centerCaret(true);
    editor.focus();
  }

  async function refreshModTime() {
    if (!state.currentPath) return;
    try {
      const res = await fetch(apiUrl("/api/stat?path=" + encodeURIComponent(state.currentPath)));
      if (!res.ok) return;
      const stat = await res.json();
      if (stat.mod_time) state.currentModTime = stat.mod_time;
    } catch (_) {}
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

    if (window.typewriter) window.typewriter.centerCaret(true);
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
      pokeHud();
      markDirty();
      updateAll();
      window.typewriter.centerCaret(false);
      window.focusDim.render();

      clearTimeout(state.saveTimer);
      if (!state.currentPath) {
        // A buffer that has never been given a name must stay nameless: the old
        // code invented "<documenti>/Documento.md" here, so the first keystroke
        // on the welcome screen silently wrote a file to disk and every later
        // session overwrote it. Autosave waits for a real path; Ctrl+S asks.
        setSaveStatus("○ Non salvato", "unsaved");
        return;
      }

      setSaveStatus("● Salvataggio...", "saving");
      state.saveTimer = setTimeout(() => saveFile(true), 600);
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

    editor.addEventListener("click", () => {
      window.typewriter.centerCaret(true);
      window.focusDim.render();
      updateCursorPosition();
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

    // Title button click -> Save As / Rename dialog (macOS / PubCraft style)
    docTitleBtn?.addEventListener("click", () => {
      promptSaveAs();
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
    });

    // Mouse movement wakes up Zen HUD
    document.addEventListener("mousemove", pokeHud);
  }

  // ------------------------------------------------------------- Shortcuts
  function handleShortcuts(e) {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const ctrl = isMac ? e.metaKey : e.ctrlKey;

    if (ctrl && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveFile();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "o") {
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
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      toggleDrawer();
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
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      promptSaveAs();
      return;
    }
    if (e.key === "Escape") {
      closeAllDropdowns();
      if (!sideDrawer.classList.contains("collapsed")) {
        toggleDrawer();
      }
      closeFsModal();
      closeTableModal();
      appModal?.classList.add("hidden");
      statsModal?.classList.add("hidden");
    }
  }

  // ------------------------------------------------------------- Text Formatting Tools (PubCraft style)
  function replaceRange(start, end, text, selectStart, selectEnd) {
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

      case "hr":
        const beforeChar = start > 0 ? val[start - 1] : "\n";
        const lead = (beforeChar === "\n") ? "" : "\n\n";
        replacement = lead + "---\n\n";
        newCursorStart = start + replacement.length;
        newCursorEnd = newCursorStart;
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
    const cols = Math.max(1, Math.min(10, parseInt(tableColsInput?.value, 10) || 3));
    const rows = Math.max(1, Math.min(30, parseInt(tableRowsInput?.value, 10) || 3));

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

  function updateAll() {
    updateWordCountAndStats();
    updateCursorPosition();
    window.outline.update();
    // Debounce preview: marked.parse su doc intero a ogni tasto laggava (Typora rende incrementale).
    clearTimeout(state.previewTimer);
    if (state.viewMode === "live" || state.viewMode === "split") {
      state.previewTimer = setTimeout(() => {
        window.livePreview.render(editor.value);
      }, 150);
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
    const selStart = editor.selectionStart || 0;
    const textBefore = editor.value.substring(0, selStart);
    const lines = textBefore.split("\n");
    const lineNum = lines.length;
    const colNum = lines[lines.length - 1].length + 1;
    statusCursorPos.textContent = `Ln ${lineNum}, Col ${colNum}`;
  }

  function markDirty() {
    state.isDirty = true;
    setSaveStatus(state.currentPath ? "○ Modificato" : "○ Non salvato", "unsaved");
  }

  function markSaved() {
    state.isDirty = false;
    state.remoteChanged = false;
    setSaveStatus("● Salvato", "saved");
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
  async function saveFile(isAutosave) {
    if (!state.currentPath) {
      if (isAutosave) {
        setSaveStatus("○ Non salvato", "unsaved");
        return;
      }
      promptSaveAs();
      return;
    }

    state.saving = true;
    try {
      const res = await fetch(apiUrl("/api/save"), {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          path: state.currentPath,
          content: editor.value,
          mod_time: state.currentModTime || 0,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.mod_time) state.currentModTime = data.mod_time;
        if (data.path) {
          state.currentPath = data.path;
          window.livePreview.setBaseDir(dirOf(data.path));
        }
        markSaved();
      } else if (res.status === 409) {
        // Autosave must not block on a modal: only an explicit save asks.
        if (isAutosave) {
          setSaveStatus("⚠️ Modificato su disco", "unsaved");
          state.remoteChanged = true;
          return;
        }
        setSaveStatus("⚠️ Modificato su disco — ricarica", "unsaved");
        if (confirm("Il file e' cambiato su disco. Sovrascrivere comunque?")) {
          state.currentModTime = 0;
          state.saving = false;
          await saveFile(false);
        }
      } else if (res.status === 401) {
        setSaveStatus("⚠️ Sessione scaduta — ricarica", "unsaved");
      } else {
        setSaveStatus("⚠️ Errore salvataggio", "unsaved");
      }
    } catch (e) {
      console.error("Save error:", e);
      setSaveStatus("⚠️ Connessione persa", "unsaved");
    } finally {
      state.saving = false;
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
    if (!state.currentPath || !state.appToken || state.saving) return;
    if (typeof document.hidden !== "undefined" && document.hidden) return;
    try {
      const res = await fetch(apiUrl("/api/stat?path=" + encodeURIComponent(state.currentPath)));
      if (!res.ok) return;
      const stat = await res.json();
      if (!stat.mod_time || stat.mod_time === state.currentModTime) return;

      if (state.isDirty) {
        if (!state.remoteChanged) {
          state.remoteChanged = true;
          setSaveStatus("⚠️ Cambiato su disco", "unsaved");
        }
        return;
      }

      const before = editor.value;
      const fileRes = await fetch(apiUrl("/api/file?path=" + encodeURIComponent(state.currentPath)));
      if (!fileRes.ok) return;
      const data = await fileRes.json();
      const content = data.content == null ? "" : data.content;
      // Someone typed (or saved) while the two requests were in flight.
      if (state.isDirty || editor.value !== before) return;
      if (content === editor.value) {
        state.currentModTime = data.mod_time || stat.mod_time;
        return;
      }

      editor.value = content;
      state.currentModTime = data.mod_time || stat.mod_time;
      state.remoteChanged = false;
      updateAllNow();
      setSaveStatus("● Ricaricato dal disco", "saved");
    } catch (_) {
      // Offline for a tick is not an error worth surfacing.
    }
  }

  async function openFile(filePath) {
    if (!filePath) return;
    if (state.isDirty) {
      if (!confirm("Ci sono modifiche non salvate. Aprire comunque il file?")) return;
    }
    try {
      const res = await fetch(apiUrl(`/api/file?path=${encodeURIComponent(filePath)}`));
      if (res.ok) {
        const data = await res.json();
        editor.value = data.content;
        state.currentPath = data.path;
        state.currentModTime = data.mod_time || 0;
        window.livePreview.setBaseDir(dirOf(data.path));
        updateDocTitle();
        markSaved();
        updateAllNow();
        window.typewriter.centerCaret(true);
        editor.focus();
        if (sideDrawer && !sideDrawer.classList.contains("collapsed")) {
          toggleDrawer();
        }
      } else {
        alert("Impossibile aprire il file specificato.");
      }
    } catch (e) {
      alert("Errore durante la lettura del file: " + e);
    }
  }

  function newDocument() {
    if (state.isDirty) {
      if (!confirm("Ci sono modifiche non salvate. Creare un nuovo documento?")) {
        return;
      }
    }
    editor.value = "";
    state.currentPath = "";
    state.currentModTime = 0;
    window.livePreview.setBaseDir(state.defaultDir || "");
    updateDocTitle();
    markSaved();
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

    if (mode === "saveAs") {
      fsModalTitle.textContent = state.currentPath ? "Salva con nome / Rinomina documento" : "Salva Documento con Nome";
      fsFileNameSection?.classList.remove("hidden");
      if (btnFsConfirm) btnFsConfirm.textContent = "Salva";

      // Suggested filename: current file name or first heading in doc or "Documento.md"
      let defaultName = "";
      if (state.currentPath) {
        defaultName = baseName(state.currentPath);
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

    if (mode === "saveAs" && fsFileNameInput) {
      fsFileNameInput.focus();
      const dotIdx = fsFileNameInput.value.lastIndexOf(".");
      if (dotIdx > 0) {
        fsFileNameInput.setSelectionRange(0, dotIdx);
      } else {
        fsFileNameInput.select();
      }
    }
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
      const res = await fetch(apiUrl(url));
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

    const parts = absPath.split("/").filter(Boolean);
    if (!parts.length) {
      const rootSpan = document.createElement("b");
      rootSpan.textContent = "/";
      fsBreadcrumbs.appendChild(rootSpan);
      return;
    }

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

          if (fsState.mode === "saveAs" && fsFileNameInput) {
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
    if (fsState.mode === "saveAs") {
      const fn = (fsFileNameInput?.value || "").trim() || "...";
      fsSelectedPath.textContent = "Salva in: " + base + (base ? "/" : "") + fn;
    } else {
      if (fsState.selectedItem) {
        fsSelectedPath.textContent = "Apri: " + base + (base ? "/" : "") + fsState.selectedItem;
      } else {
        fsSelectedPath.textContent = "Cartella: " + base;
      }
    }
  }

  async function fsConfirmAction() {
    if (fsState.mode === "saveAs") {
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
      const payload = {
        old_path: state.currentPath || "",
        new_path: targetPath,
        content: editor.value,
      };

      const postRename = (body) =>
        fetch(apiUrl("/api/rename"), {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify(body),
        });

      try {
        let res = await postRename(payload);
        // The backend refuses to replace a different existing document: ask,
        // and only then resend with the explicit overwrite flag.
        if (res.status === 409) {
          if (!confirm(`Esiste gia' un file chiamato "${name}" in questa cartella. Sostituirlo?`)) {
            return;
          }
          res = await postRename(Object.assign({}, payload, { overwrite: true }));
        }

        if (res.ok) {
          const data = await res.json();
          state.currentPath = data.path;
          state.currentModTime = data.mod_time || 0;
          window.livePreview.setBaseDir(dirOf(data.path));
          updateDocTitle();
          markSaved();
          closeFsModal();
          editor.focus();
          loadWorkspace(dirOf(data.path));
          refreshRecents();
        } else {
          const err = await res.text();
          alert("Impossibile salvare il file: " + err);
        }
      } catch (e) {
        alert("Errore di rete durante il salvataggio: " + e);
      }
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

  async function fsCreateFolder() {
    const name = prompt("Nome della nuova cartella:");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (cleanName.includes("/") || cleanName.includes("\\") || cleanName.startsWith(".")) {
      alert("Nome cartella non valido.");
      return;
    }

    try {
      const res = await fetch(apiUrl("/api/mkdir"), {
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
      const res = await fetch(apiUrl("/api/init"));
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
    openFsModal("saveAs");
  }

  // ------------------------------------------------------------- Modals & Dialogs
  function showModal(title, desc, initialVal, onConfirm) {
    modalTitle.textContent = title;
    modalDescription.textContent = desc;
    modalInput.value = initialVal;
    appModal.classList.remove("hidden");
    modalInput.focus();
    modalInput.select();

    const confirmHandler = () => {
      const val = modalInput.value.trim();
      if (val) {
        appModal.classList.add("hidden");
        cleanup();
        onConfirm(val);
      }
    };

    const cancelHandler = () => {
      appModal.classList.add("hidden");
      cleanup();
    };

    const keyHandler = (e) => {
      if (e.key === "Enter") confirmHandler();
      if (e.key === "Escape") cancelHandler();
    };

    function cleanup() {
      modalBtnConfirm.removeEventListener("click", confirmHandler);
      modalBtnCancel.removeEventListener("click", cancelHandler);
      modalInput.removeEventListener("keydown", keyHandler);
    }

    modalBtnConfirm.addEventListener("click", confirmHandler);
    modalBtnCancel.addEventListener("click", cancelHandler);
    modalInput.addEventListener("keydown", keyHandler);
  }

  function showStatsModal() {
    updateWordCountAndStats();
    statsModal.classList.remove("hidden");
  }

  // ------------------------------------------------------------- Drawer & Tabs
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
      const res = await fetch(apiUrl(`/api/workspace?path=${encodeURIComponent(dir)}`));
      if (res.ok) {
        const data = await res.json();
        document.getElementById("workspaceRoot").textContent = String(data.root || "Workspace").split("/").pop() || "Workspace";
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
    modalBtnCancel?.addEventListener("click", () => appModal.classList.add("hidden"));

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
      if (!state.isDirty) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    });
  }

  // Run app
  document.addEventListener("DOMContentLoaded", initApp);
})();
