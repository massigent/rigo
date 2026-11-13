// TypeCraft — Typewriter Continuous Scrolling Engine
// Keeps the active writing line fixed vertically in the viewport (iA Writer & PubCraft style)

class TypewriterEngine {
  constructor(editor, backdrop) {
    this.editor = editor;
    this.backdrop = backdrop;
    this.enabled = localStorage.getItem("typecraft.typewriter") !== "0"; // Default: ON
    this.mirrorDiv = null;
    this.rafId = null;
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

  getCaretOffsetY() {
    if (!this.editor || !this.mirrorDiv) return 0;
    const st = window.getComputedStyle(this.editor);

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

    const sel = this.editor.selectionStart || 0;
    const before = this.editor.value.substring(0, sel);
    this.mirrorDiv.textContent = before;

    const marker = document.createElement("span");
    marker.textContent = "\u200B";
    this.mirrorDiv.appendChild(marker);

    const padTop = parseFloat(st.paddingTop) || 0;
    return marker.offsetTop + padTop;
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
