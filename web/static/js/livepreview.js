// TypeCraft — Live Preview & Interactive Markdown Engine (Typora style, code & math aware)

class LivePreviewEngine {
  constructor(editor, container) {
    this.editor = editor;
    this.container = container;
    this.baseDir = "";
    this.onLocalLink = null; // set by app.js: opens a linked .md inside the app
    this.initMarked();
    this.bindEvents();
  }

  setBaseDir(dir) {
    this.baseDir = dir || "";
  }

  initMarked() {
    if (typeof marked === "undefined") return;

    marked.setOptions({
      gfm: true,
      breaks: true,
      silent: true, // a malformed document must never break the editor
    });

    // marked v12 dropped headerIds/mangle; generate stable heading ids so that
    // the outline and the exported HTML anchors keep working.
    const renderer = new marked.Renderer();
    renderer.heading = function (text, level, raw) {
      const plain = String(raw == null ? text : raw)
        .replace(/<[^>]*>/g, "")
        .replace(/[*_`~]/g, "");
      return `<h${level} id="${slugify(plain)}">${text}</h${level}>\n`;
    };
    marked.use({ renderer });
  }

  bindEvents() {
    if (!this.container) return;

    // 1. Interactive task list checkboxes (marked renders them disabled).
    this.container.addEventListener("click", (e) => {
      const target = e.target;
      if (!target || target.tagName !== "INPUT" || target.type !== "checkbox") return;
      e.preventDefault();
      this.handleTaskCheckboxClick(target);
    });

    // 2. Links: never navigate the app window away (that would drop unsaved
    //    work and leak the ?token= in the Referer header).
    this.container.addEventListener("click", (e) => {
      const anchor = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return;

      const isLocalDoc = /\.(md|markdown|mdown|mkd|mdwn|txt)$/i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href);
      if (isLocalDoc && typeof this.onLocalLink === "function") {
        e.preventDefault();
        this.onLocalLink(this.resolvePath(href));
        return;
      }
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        e.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
      }
    });
  }

  resolvePath(p) {
    let out = String(p || "").trim();
    try { out = decodeURIComponent(out); } catch (_) {}
    out = out.replace(/^file:\/\//i, "");
    if (/^([a-zA-Z]:[\\/]|[\\/])/.test(out)) return out; // already absolute
    const dir = (this.baseDir || "").replace(/[\\/]+$/, "");
    if (!dir) return out;
    return dir + "/" + out.replace(/^\.\//, "");
  }

  slugify(text) {
    return slugify(text);
  }

  // Protects fenced/inline code before touching math or task markers.
  //
  // The code is turned into HTML *here*, not stashed as raw markdown: putting
  // the original fence back after marked() printed literal ``` backticks in the
  // preview (no <pre>, no syntax highlighting, no Copy button).
  extractCodeBlocks(text) {
    const blocks = [];
    const stash = (html) => {
      blocks.push(html);
      return `\u0000CODE${blocks.length - 1}\u0000`;
    };

    const protected_ = String(text)
      .replace(/^([ \t]*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:^\1\2[ \t]*$|$(?![\s\S]))/gm,
        (_m, _indent, _fence, info, body) => {
          const lang = String(info || "").trim().split(/\s+/)[0].replace(/[^\w+#.-]/g, "");
          const cls = lang ? ` class="language-${lang}"` : "";
          let text = String(body).replace(/\n$/, "");
          if (_indent) {
            const lead = _indent;
            text = text.split("\n").map((l) => (l.startsWith(lead) ? l.slice(lead.length) : l)).join("\n");
          }
          return stash(`<pre class="code-block"><code${cls}>${escapeHtml(text)}</code></pre>`);
        })
      .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _fence, code) => {
        const inner = String(code).replace(/^ ([\s\S]*) $/, "$1");
        return stash(`<code>${escapeHtml(inner)}</code>`);
      });

    return { protected_, blocks };
  }

  restoreCodeBlocks(text, blocks) {
    return String(text).replace(/\u0000CODE(\d+)\u0000/g, (_, i) => blocks[Number(i)] || "");
  }

  // Math must not be parsed as Markdown (a `_` inside $x_1$ would become
  // emphasis) and must not be reinterpreted by the HTML sanitizer.
  extractMath(text) {
    const blocks = [];
    const stash = (html) => {
      blocks.push(html);
      return `\u0000MATH${blocks.length - 1}\u0000`;
    };

    let out = String(text).replace(/\$\$([\s\S]+?)\$\$/g, (_m, formula) => {
      return stash(`<div class="math-block"><span class="math-tex">${escapeHtml(String(formula).trim())}</span></div>`);
    });

    out = out.replace(/(^|[^\\$])\$(?![\s$])([^$\n]+?)\$(?![\d$])/g, (_m, prefix, formula) => {
      return prefix + stash(`<span class="math-inline math-tex">${escapeHtml(String(formula).trim())}</span>`);
    });

    return { text: out, blocks };
  }

  restoreMath(text, blocks) {
    return String(text).replace(/\u0000MATH(\d+)\u0000/g, (_, i) => blocks[Number(i)] || "");
  }

  render(markdownText) {
    if (!this.container || typeof marked === "undefined") return;

    const src = markdownText == null ? "" : String(markdownText);
    const code = this.extractCodeBlocks(src);
    const math = this.extractMath(code.protected_);

    let html;
    try {
      html = marked.parse(math.text);
    } catch (err) {
      console.error("Markdown parse error:", err);
      html = `<p>${escapeHtml(src)}</p>`;
    }

    html = this.restoreMath(html, math.blocks);
    html = this.restoreCodeBlocks(html, code.blocks);
    html = this.sanitize(html);

    this.container.innerHTML = html;

    // Unwrapping block math leaves empty <p> shells around it; drop them so the
    // document has no stray blank lines.
    this.container.querySelectorAll("p").forEach((p) => {
      if (!p.textContent.trim() && !p.querySelector("img, input, br, pre, code")) p.remove();
    });

    this.prepareLocalImages();
    this.enableTaskCheckboxes();
    this.attachCopyCodeButtons();
  }

  sanitize(html) {
    if (window.TypeCraftSanitizer) return window.TypeCraftSanitizer.clean(html);
    // Fail closed: without the sanitizer, show the source as plain text.
    return `<pre>${escapeHtml(html)}</pre>`;
  }

  prepareLocalImages() {
    const apiUrl = window.tcApiUrl;
    this.container.querySelectorAll("img").forEach((img) => {
      const raw = img.getAttribute("src") || "";
      if (!raw) return;
      if (/^(https?:|data:|blob:)/i.test(raw)) {
        img.setAttribute("loading", "lazy");
        return;
      }
      let abs = this.resolvePath(raw);
      if (typeof apiUrl !== "function") return;
      // Force the image through the backend so relative paths resolve against
      // the document folder (Typora behaviour) and never against the app root.
      if (!/^([a-zA-Z]:[\\/]|\/)/.test(abs)) return;
      img.setAttribute("src", apiUrl("/api/asset?path=" + encodeURIComponent(abs)));
      img.setAttribute("loading", "lazy");
      img.addEventListener("error", () => img.classList.add("img-missing"), { once: true });
    });
  }

  enableTaskCheckboxes() {
    // marked emits <input disabled type="checkbox">; a disabled input never
    // fires a click event, which silently broke the interactive task lists.
    this.container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.removeAttribute("disabled");
      cb.classList.add("task-checkbox");
      cb.setAttribute("tabindex", "-1");
    });
  }

  attachCopyCodeButtons() {
    this.container.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".btn-copy-code")) return;

      const btn = document.createElement("button");
      btn.className = "btn-copy-code";
      btn.type = "button";
      btn.textContent = "Copy";

      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const code = pre.querySelector("code")?.innerText || "";
        const done = () => {
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = "Copy"), 1800);
        };
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(code).then(done).catch(() => fallback());
        } else {
          fallback();
        }
        function fallback() {
          const ta = document.createElement("textarea");
          ta.value = code;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); done(); } catch (_) {}
          document.body.removeChild(ta);
        }
      });

      pre.style.position = "relative";
      pre.appendChild(btn);
    });
  }

  handleTaskCheckboxClick(checkbox) {
    const boxes = Array.from(this.container.querySelectorAll('input[type="checkbox"]'));
    const boxIndex = boxes.indexOf(checkbox);
    if (boxIndex === -1) return;

    // The n-th rendered checkbox maps to the n-th task line, counting only real
    // task markers outside fenced code (the old version also counted `[x]` in
    // normal prose and could toggle the wrong line).
    const lines = this.editor.value.split("\n");
    const TASK_LINE = /^(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]/;
    let inCode = false;
    let seen = 0;
    let targetLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^(`{3,}|~{3,})/.test(trimmed)) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      if (TASK_LINE.test(trimmed)) {
        if (seen === boxIndex) {
          targetLine = i;
          break;
        }
        seen++;
      }
    }
    if (targetLine === -1) return;

    const line = lines[targetLine];
    const isChecked = /\[[xX]\]/.test(line);
    lines[targetLine] = line.replace(/\[[ xX]\]/, isChecked ? "[ ]" : "[x]");

    const pos = this.editor.selectionStart;
    this.editor.value = lines.join("\n");
    try { this.editor.setSelectionRange(pos, pos); } catch (_) {}
    // The app's input handler re-renders (debounced) and auto-saves.
    this.editor.dispatchEvent(new Event("input"));
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\u00C0-\uFFFF\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") || "section";
}

window.LivePreviewEngine = LivePreviewEngine;
