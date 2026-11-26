// TypeCraft — Document Outline / Table of Contents Engine (Typora style + Ferrite logic)

class OutlineEngine {
  constructor(editor, listContainer, scrollWrapper) {
    this.editor = editor;
    this.container = listContainer;
    this.scrollWrapper = scrollWrapper;
    this._deb = null;
  }

  // `delay` lets the caller slow the reparse down on large documents.
  update(delay) {
    if (!this.container || !this.editor) return;
    clearTimeout(this._deb);
    this._deb = setTimeout(() => this._updateNow(), delay || 120);
  }

  _updateNow() {
    if (!this.container || !this.editor) return;

    const text = this.editor.value || "";
    // Use the same parser/masking as the live preview: Marked decides what is
    // a real heading (backtick/tilde fences, longer closers, indentation,
    // unclosed fences, nested containers and HTML blocks), so fake headings in
    // code never leak into the outline. Offsets are exact source positions.
    const headings = window.livePreview?.parseHeadings(text) || [];

    if (headings.length === 0) {
      this.container.innerHTML = `
        <div class="empty-outline">
          Nessun titolo trovato.<br>
          <small>Usa # Titolo 1 o ## Titolo 2 nel testo.</small>
        </div>`;
      return;
    }

    this.container.innerHTML = "";
    headings.forEach((h) => {
      const item = document.createElement("div");
      item.className = `outline-item level-${h.level}`;
      item.textContent = h.title;
      item.title = `${"#".repeat(h.level)} ${h.title} (Riga ${h.lineIndex + 1})`;

      item.addEventListener("click", () => {
        if (this.editor.value !== text || !this.container.contains(item)) return;
        this.jumpToHeading(h);
      });

      this.container.appendChild(item);
    });
  }

  jumpToHeading(heading) {
    if (!this.editor) return;

    // Focus editor and set caret to heading
    this.editor.focus();
    this.editor.setSelectionRange(heading.charOffset, heading.charOffset);

    // Scroll to heading
    if (window.typewriter && window.typewriter.enabled) {
      window.typewriter.centerCaret(true);
    } else {
      // Scroll editor directly
      const totalLines = this.editor.value.split("\n").length;
      const progress = heading.lineIndex / Math.max(1, totalLines);
      const targetScroll = progress * this.editor.scrollHeight;
      this.editor.scrollTo({ top: targetScroll, behavior: "smooth" });
      if (window.focusDim) {
        window.focusDim.syncScroll();
      }
    }

    // Trigger input / selection change
    this.editor.dispatchEvent(new Event("selectionchange"));
    if (window.focusDim) {
      window.focusDim.render();
    }
  }
}

window.OutlineEngine = OutlineEngine;
