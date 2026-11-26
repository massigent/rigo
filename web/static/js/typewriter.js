// TypeCraft — Typewriter Continuous Scrolling Engine
// Keeps the active writing line fixed vertically in the viewport (iA Writer & PubCraft style)
//
// Measurement is incremental: while typing inside one line, the caret's row
// only depends on the wrapped rows above it (text before the line start,
// unchanged) plus the wrapped rows of the current line. The engine caches the
// Y offset of the current line's first row and re-measures just the line
// slice, so a keystroke costs O(line) layout work instead of O(document).
// The reuse rule is conservative (one contiguous edit at the caret, same
// line start, non-zero delta): any doubt falls back to the full mirror.
// invalidate() must be called whenever the text is replaced programmatically
// or the layout changes (resize, font/theme switch).

class TypewriterEngine {
  constructor(editor, backdrop) {
    this.editor = editor;
    this.backdrop = backdrop;
    this.enabled = localStorage.getItem("typecraft.typewriter") !== "0"; // Default: ON
    this.mirrorDiv = null;
    this.rafId = null;
    // { lineStart, lineTopY, textLen, sel } or null (full measure next time).
    this._lineCache = null;
    this.initMirror();
    document.body.classList.toggle("typewriter-active", this.enabled);
  }

  initMirror() {
    this.mirrorDiv = document.getElementById("taCaretMirror");
    if (!this.mirrorDiv) {
      this.mirrorDiv = document.createElement("div");
      this.mirrorDiv.id = "taCaretMirror";
      this.mirrorDiv.style.visibility = "hidden";
      this.mirrorDiv.style.position = "absolute";
      this.mirrorDiv.style.pointerEvents = "none";
      this.mirrorDiv.style.top = "0px";
      this.mirrorDiv.style.left = "-9999px";
      this.mirrorDiv.style.zIndex = "-1000";
      document.body.appendChild(this.mirrorDiv);
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("typecraft.typewriter", this.enabled ? "1" : "0");
    document.body.classList.toggle("typewriter-active", this.enabled);
    if (this.enabled) {
      this.centerCaret(true);
    }
    return this.enabled;
  }

  // Drop the incremental cache: the next measurement is a full one. Call when
  // the editor text is replaced programmatically or the layout metrics may
  // have changed (resize, font or theme switch).
  invalidate() {
    this._lineCache = null;
  }

  // Pure reuse rule, extracted for tests: may the cached first-row Y of the
  // current line be trusted for (val, sel)? True when the caret is on the same
  // line as the cached measurement and exactly one contiguous edit happened
  // at the caret since then (so everything before the line start is
  // unchanged). A zero delta is never reused: with no edit there is nothing
  // to prove about the text.
  static lineCacheValid(val, sel, cache) {
    if (!cache) return false;
    const lineStart = val.lastIndexOf("\n", sel - 1) + 1;
    if (lineStart !== cache.lineStart) return false;
    if (sel < lineStart) return false;
    const textDelta = val.length - cache.textLen;
    const caretDelta = sel - cache.sel;
    if (textDelta === 0 || textDelta !== caretDelta) return false;
    // One contiguous edit between the two caret positions, both at or after
    // the (shared) line start: the prefix before it is unchanged.
    return true;
  }

  // Copies the editor's text metrics onto the mirror so both wrap identically.
  applyMirrorStyle(st) {
    const props = [
      "fontFamily", "fontSize", "lineHeight", "letterSpacing",
      "fontWeight", "fontStyle", "textTransform", "textIndent",
      "wordSpacing", "whiteSpace", "wordBreak", "overflowWrap", "tabSize"
    ];
    props.forEach(p => { try { this.mirrorDiv.style[p] = st[p]; } catch (_) {} });
    this.mirrorDiv.style.width = this.editor.clientWidth + "px";
    this.mirrorDiv.style.paddingLeft = st.paddingLeft;
    this.mirrorDiv.style.paddingRight = st.paddingRight;
    this.mirrorDiv.style.paddingTop = "0px";
    this.mirrorDiv.style.paddingBottom = "0px";
    this.mirrorDiv.style.border = st.border;
    this.mirrorDiv.style.boxSizing = "border-box";
    this.mirrorDiv.style.whiteSpace = "pre-wrap";
    this.mirrorDiv.style.wordBreak = "break-word";
    this.mirrorDiv.style.overflowWrap = "break-word";
  }

  buildMirrorText(text) {
    this.mirrorDiv.textContent = text;
    const marker = document.createElement("span");
    marker.textContent = "\u200B";
    this.mirrorDiv.appendChild(marker);
    return marker;
  }

  getCaretOffsetY() {
    if (!this.editor || !this.mirrorDiv) return 0;
    const st = window.getComputedStyle(this.editor);
    this.applyMirrorStyle(st);

    const val = this.editor.value;
    const sel = this.editor.selectionStart || 0;
    const lineStart = val.lastIndexOf("\n", sel - 1) + 1;

    // Incremental: the cached first-row Y of this line is still valid, so
    // only the current line needs to be laid out and measured.
    if (TypewriterEngine.lineCacheValid(val, sel, this._lineCache)
        && this._lineCache.lineStart === lineStart) {
      const cache = this._lineCache;
      const marker = this.buildMirrorText(val.slice(lineStart, sel));
      const y = cache.lineTopY + marker.offsetTop;
      this._lineCache = { lineStart, lineTopY: cache.lineTopY, textLen: val.length, sel };
      const padTop = parseFloat(st.paddingTop) || 0;
      return y + padTop;
    }

    // Full measure: the whole prefix decides where the caret's row is.
    const marker = this.buildMirrorText(val.substring(0, sel));
    const padTop = parseFloat(st.paddingTop) || 0;
    const caretY = marker.offsetTop + padTop;

    // Derive the first-row Y of the current line by measuring the line alone,
    // so the next keystroke inside this line can reuse it. Two layout passes
    // happen only on line changes and jumps, not while typing.
    const lineMarker = this.buildMirrorText(val.slice(lineStart, sel));
    const within = lineMarker.offsetTop;
    const lineTopY = marker.offsetTop - within;

    this._lineCache = { lineStart, lineTopY, textLen: val.length, sel };
    return caretY;
  }

  centerCaret(smooth = false) {
    if (!this.enabled || !this.editor) return;

    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      const caretY = this.getCaretOffsetY();
      const lineH = parseFloat(window.getComputedStyle(this.editor).lineHeight) || 28;
      const target = Math.max(0, caretY - (this.editor.clientHeight * 0.45) + (lineH / 2));
      const currentScroll = this.editor.scrollTop;

      if (Math.abs(currentScroll - target) > 2) {
        if (smooth) {
          this.editor.scrollTo({ top: target, behavior: "smooth" });
        } else {
          this.editor.scrollTop = target;
        }
      }

      if (this.backdrop) {
        this.backdrop.scrollTop = this.editor.scrollTop;
        this.backdrop.scrollLeft = this.editor.scrollLeft;
      }
    });
  }
}

window.TypewriterEngine = TypewriterEngine;
