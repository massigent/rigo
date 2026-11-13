// TypeCraft — Focus Dimming Engine (iA Writer & PubCraft Style)
// Focuses on current sentence or paragraph while gently dimming out the rest

class FocusDimEngine {
  constructor(editor, backdrop) {
    this.editor = editor;
    this.backdrop = backdrop;
    this.mode = localStorage.getItem("typecraft.focusDim") || "off"; // "off" | "sentence" | "paragraph"
    if (!["off", "sentence", "paragraph"].includes(this.mode)) {
      this.mode = "off";
    }
  }

  cycleMode() {
    if (this.mode === "off") {
      this.mode = "sentence";
    } else if (this.mode === "sentence") {
      this.mode = "paragraph";
    } else {
      this.mode = "off";
    }

    localStorage.setItem("typecraft.focusDim", this.mode);
    this.applyMode();
    return this.mode;
  }

  applyMode() {
    const isActive = this.mode !== "off";
    document.body.classList.toggle("focus-dim-active", isActive);
    document.body.classList.toggle("focus-mode-paragraph", this.mode === "paragraph");
    document.body.classList.toggle("focus-mode-sentence", this.mode === "sentence");

    if (!isActive) {
      if (this.backdrop) {
        this.backdrop.innerHTML = "";
        this.backdrop.style.display = "none";
      }
      return;
    }

    if (this.backdrop) {
      this.backdrop.style.display = "block";
    }
    this.render();
  }

  escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  getFocusRange(text, sel) {
    if (!text || text.length === 0) return [0, 0];
    const clampedSel = Math.max(0, Math.min(sel, text.length));

    // Paragraph focus mode
    if (this.mode === "paragraph") {
      const before = text.slice(0, clampedSel);
      const prevBreak = before.lastIndexOf("\n\n");
      const start = prevBreak === -1 ? 0 : prevBreak + 2;

      const after = text.slice(clampedSel);
      const nextBreak = after.indexOf("\n\n");
      const end = nextBreak === -1 ? text.length : clampedSel + nextBreak;
      return [start, end];
    }

    // Sentence focus mode
    if (this.mode === "sentence") {
      // Find parent paragraph bounds first
      const beforePara = text.slice(0, clampedSel);
      const prevBreak = beforePara.lastIndexOf("\n\n");
      const pStart = prevBreak === -1 ? 0 : prevBreak + 2;

      const afterPara = text.slice(clampedSel);
      const nextBreak = afterPara.indexOf("\n\n");
      const pEnd = nextBreak === -1 ? text.length : clampedSel + nextBreak;

      const paraText = text.slice(pStart, pEnd);
      const relSel = clampedSel - pStart;

      if (!paraText.trim()) {
        return [pStart, pEnd];
      }

      // Seamless sentence tokenizer: covers all chars so there is never an unhighlighted gap
      const re = /[^\s.!?\n][^.!?\n]*(?:[.!?]+[\s]*|$)/g;
      let matches = [];
      let m;
      while ((m = re.exec(paraText)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
      }

      if (matches.length === 0) {
        return [pStart, pEnd];
      }

      // If cursor is before first sentence (e.g. leading spaces/indent)
      if (relSel <= matches[0].start) {
        return [pStart, pStart + matches[0].end];
      }

      for (let i = 0; i < matches.length; i++) {
        const cur = matches[i];
        const isLast = (i === matches.length - 1);
        const nextStart = isLast ? paraText.length : matches[i + 1].start;
        if (relSel >= cur.start && relSel < nextStart) {
          return [pStart + cur.start, pStart + (isLast ? paraText.length : cur.end)];
        }
      }

      return [pStart + matches[matches.length - 1].start, pStart + paraText.length];
    }

    return [0, text.length];
  }

  syncMetrics() {
    if (!this.backdrop || !this.editor) return;
    const st = window.getComputedStyle(this.editor);
    const bd = this.backdrop.style;
    bd.font = st.font;
    bd.fontFamily = st.fontFamily;
    bd.fontSize = st.fontSize;
    bd.fontWeight = st.fontWeight;
    bd.fontStyle = st.fontStyle;
    bd.lineHeight = st.lineHeight;
    bd.letterSpacing = "normal";
    bd.wordSpacing = st.wordSpacing;
    bd.textTransform = st.textTransform;
    bd.textIndent = st.textIndent;
    bd.paddingLeft = st.paddingLeft;
    bd.paddingRight = st.paddingRight;
    bd.paddingTop = st.paddingTop;
    bd.paddingBottom = st.paddingBottom;
    bd.borderLeft = st.borderLeft;
    bd.borderRight = st.borderRight;
    bd.borderTop = st.borderTop;
    bd.borderBottom = st.borderBottom;
    bd.boxSizing = st.boxSizing;
    bd.tabSize = st.tabSize;
    bd.whiteSpace = "pre-wrap";
    bd.wordBreak = "break-word";
    bd.overflowWrap = "break-word";
    bd.fontVariantLigatures = "none";

    // Align backdrop bounding box EXACTLY with editor to eliminate any horizontal scrollbar shift
    const rect = this.editor.getBoundingClientRect();
    const parent = this.editor.offsetParent;
    const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
    bd.left = (rect.left - parentRect.left) + "px";
    bd.top = (rect.top - parentRect.top) + "px";
    bd.width = rect.width + "px";
    bd.height = rect.height + "px";
    bd.margin = "0";
    bd.right = "auto";
    bd.bottom = "auto";
  }

  render() {
    if (!this.backdrop || this.mode === "off") return;
    this.syncMetrics();
    const val = this.editor.value || "";
    const sel = this.editor.selectionStart || 0;
    const [start, end] = this.getFocusRange(val, sel);

    const before = val.slice(0, start);
    const current = val.slice(start, end);
    const after = val.slice(end);

    const dimmedClass = this.mode === "paragraph" ? "focus-dimmed focus-dimmed-paragraph" : "focus-dimmed";

    let html = `<span class="${dimmedClass}">${this.escapeHtml(before)}</span>` +
               `<span class="focus-current">${this.escapeHtml(current)}</span>` +
               `<span class="${dimmedClass}">${this.escapeHtml(after)}</span>`;

    if (val.endsWith("\n")) {
      html += "<br>&nbsp;";
    }

    this.backdrop.innerHTML = html;
    
    // Pixel-perfect synchronization of scroll offsets
    this.syncScroll();
  }

  syncScroll() {
    if (this.backdrop && this.editor) {
      this.backdrop.scrollTop = this.editor.scrollTop;
      this.backdrop.scrollLeft = this.editor.scrollLeft;
    }
  }
}

window.FocusDimEngine = FocusDimEngine;
