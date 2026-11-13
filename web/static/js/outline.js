// TypeCraft — Document Outline / Table of Contents Engine (Typora style + Ferrite logic)

class OutlineEngine {
  constructor(editor, listContainer, scrollWrapper) {
    this.editor = editor;
    this.container = listContainer;
    this.scrollWrapper = scrollWrapper;
    this._deb = null;
  }

  // Rubato a Ferrite: ignora code-block, supporta ## chiuse, strippa **bold** etc.
  stripInline(s) {
    return (s || "")
      .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
      .replace(/`(.+?)`/g, "$1").replace(/~~(.+?)~~/g, "$1")
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1").replace(/!\[([^\]]*)\]\([^\)]+\)/g, "$1")
      .trim();
  }

  parseHeading(line) {
    const t = line.replace(/^\s+/, "");
    if (!t.startsWith("#")) return null;
    let i = 0;
    while (i < t.length && t[i] === "#" && i < 6) i++;
    if (i === 0 || i > 6) return null;
    const rest = t.slice(i);
    if (rest !== "" && rest[0] !== " " && rest[0] !== "\t") return null; // #Title non valido
    const title = this.stripInline(rest.replace(/\s+#+(\s+)?$/, "").trim());
    if (!title) return null;
    return { level: i, title };
  }

  update() {
    if (!this.container || !this.editor) return;
    clearTimeout(this._deb);
    this._deb = setTimeout(() => this._updateNow(), 120);
  }

  _updateNow() {
    if (!this.container || !this.editor) return;

    const text = this.editor.value || "";
    const lines = text.split("\n");
    const headings = [];
    let inCode = false;

    let charOffset = 0;
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) { inCode = !inCode; charOffset += line.length + 1; return; }
      if (inCode) { charOffset += line.length + 1; return; }
      const h = this.parseHeading(line);
      if (h) {
        headings.push({
          level: h.level,
          title: h.title,
          lineIndex: lineIndex,
          charOffset: charOffset,
        });
      }
      charOffset += line.length + 1; // +1 for \n
    });

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
