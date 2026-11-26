// Rigo — Focus Dimming Engine
// Focuses on current sentence or paragraph while gently dimming out the rest.
//
// Rendering is incremental: the backdrop keeps three persistent spans and, on
// each keystroke that stays inside the current sentence/paragraph, updates
// only the current span with textContent (no HTML escaping, no re-parse of the
// whole document). A caret move across a boundary refreshes all three. The
// focus ranges are computed with native index scans instead of full-prefix
// slices, so even range computation avoids allocating on large documents.

class FocusDimEngine {
  constructor(editor, backdrop) {
    this.editor = editor;
    this.backdrop = backdrop;
    this.mode = localStorage.getItem("rigo.focusDim") || "off"; // "off" | "sentence" | "paragraph"
    if (!["off", "sentence", "paragraph"].includes(this.mode)) {
      this.mode = "off";
    }
    // Incremental state: null forces a full refresh on the next render.
    this._spans = null;
    this._range = null;
  }

  cycleMode() {
    if (this.mode === "off") {
      this.mode = "sentence";
    } else if (this.mode === "sentence") {
      this.mode = "paragraph";
    } else {
      this.mode = "off";
    }

    localStorage.setItem("rigo.focusDim", this.mode);
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
      this._spans = null;
      this._range = null;
      this._tail = null;
      return;
    }

    if (this.backdrop) {
      this.backdrop.style.display = "block";
    }
    this._spans = null;
    this._range = null;
    this._tail = null;
    this.render();
  }

  getFocusRange(text, sel) {
    if (!text || text.length === 0) return [0, 0];
    const clampedSel = Math.max(0, Math.min(sel, text.length));

    // Paragraph focus mode: native scans, no substring copies.
    if (this.mode === "paragraph") {
      return paragraphRange(text, clampedSel);
    }

    // Sentence focus mode: find the paragraph bounds first…
    if (this.mode === "sentence") {
      const [pStart, pEnd] = paragraphRange(text, clampedSel);
      const paraText = text.slice(pStart, pEnd);
      const relSel = clampedSel - pStart;

      if (!paraText.trim()) {
        return [pStart, pEnd];
      }

      // Seamless sentence tokenizer: covers all chars so there is never an unhighlighted gap
      const re = /[^\s.!?\n][^.!?\n]*(?:[.!?]+[\s]*|$)/g;
      const matches = [];
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

      return [pStart + matches[matches.length - 1].start, pEnd];
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

  // The three persistent spans (created once per activation).
  ensureSpans() {
    if (this._spans) return this._spans;
    this.backdrop.innerHTML = "";
    this._tail = null;
    const dimmed = document.createElement("span");
    dimmed.className = "focus-dimmed";
    const current = document.createElement("span");
    current.className = "focus-current";
    const after = document.createElement("span");
    after.className = "focus-dimmed";
    this.backdrop.appendChild(dimmed);
    this.backdrop.appendChild(current);
    this.backdrop.appendChild(after);
    this._spans = { before: dimmed, current, after };
    return this._spans;
  }

  render() {
    if (!this.backdrop || this.mode === "off") return;
    this.syncMetrics();
    const val = this.editor.value || "";
    const sel = this.editor.selectionStart || 0;
    const [start, end] = this.getFocusRange(val, sel);

    // A mode switch can move the paragraph classes around: keep them fresh so
    // the dimmed style (paragraph vs sentence opacity) matches the mode.
    const spans = this.ensureSpans();
    const dimmedClass = this.mode === "paragraph" ? "focus-dimmed focus-dimmed-paragraph" : "focus-dimmed";
    spans.before.className = dimmedClass;
    spans.after.className = dimmedClass;

    const rangeSame = this._range
      && this._range.start === start
      && this._range.end === end;

    if (!rangeSame) {
      // Caret crossed a sentence/paragraph boundary: refresh everything.
      spans.before.textContent = val.slice(0, start);
      spans.after.textContent = val.slice(end);
    }
    // The current passage is the only span that changes while typing inside
    // it: textContent needs no escaping and is small (one sentence/paragraph).
    spans.current.textContent = val.slice(start, end);

    // Keep the trailing-newline spacer (the textarea reserves one more row
    // when the value ends with "\n"; the mirror must do the same). The
    // spacer exists only when needed, so the backdrop is exactly three spans
    // otherwise.
    if (val.endsWith("\n")) {
      if (!this._tail || !this.backdrop.contains(this._tail)) {
        const tail = document.createElement("span");
        // Constant markup only: never document content.
        tail.innerHTML = "<br>&nbsp;";
        this.backdrop.appendChild(tail);
        this._tail = tail;
      }
    } else if (this._tail && this.backdrop.contains(this._tail)) {
      this._tail.remove();
      this._tail = null;
    }

    this._range = { start, end };

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

// Paragraph bounds via native scans (no substring copies of the prefix).
// The start search mirrors `text.slice(0, caret).lastIndexOf("\n\n")`
// exactly: the match must lie fully inside [0, caret).
function paragraphRange(text, caret) {
  const startIdx = text.lastIndexOf("\n\n", caret - 2);
  const start = startIdx === -1 ? 0 : startIdx + 2;
  const endIdx = text.indexOf("\n\n", caret);
  const end = endIdx === -1 ? text.length : endIdx;
  return [Math.min(start, end), Math.max(start, end)];
}

window.FocusDimEngine = FocusDimEngine;
