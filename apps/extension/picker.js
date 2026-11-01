// Element picker, injected by the popup after it has permission for the site.
// Click a button (YouTube like, GitHub star, anything) and name the keyword.
// The keyword becomes a tag/collection in Nota and the trigger's save action.
(() => {
  window.notaPickerCleanup?.();

  const host = document.createElement("nota-picker");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ring {
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 2px solid #0a84ff; border-radius: 4px;
      background: color-mix(in srgb, #0a84ff 8%, transparent);
      transition: left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear;
    }
    .hint, .panel {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      z-index: 2147483647; color: #f2f2f7;
      font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      background: rgba(28, 28, 30, 0.94); border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25), inset 0 0 0 0.5px rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(16px);
    }
    .hint { padding: 9px 14px; pointer-events: none; white-space: nowrap; }
    .hint b { color: #0a84ff; font-weight: 600; }
    .panel {
      width: min(360px, calc(100vw - 32px)); bottom: 16px; padding: 14px;
      pointer-events: auto;
    }
    .cap { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
    .sel {
      display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-bottom: 10px; padding: 5px 7px; border-radius: 5px;
      background: rgba(255, 255, 255, 0.08); color: #aeaeb2;
      font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .field span { display: block; margin-bottom: 4px; color: #aeaeb2; font-weight: 500; }
    .field input {
      width: 100%; padding: 7px 9px; border: 0; border-radius: 6px;
      background: rgba(255, 255, 255, 0.1); color: #fff;
      font: inherit; outline: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .field input:focus { box-shadow: inset 0 0 0 1px #0a84ff; }
    .msg { min-height: 15px; margin: 6px 0 2px; color: #ff9f0a; }
    .row { display: flex; justify-content: flex-end; gap: 6px; }
    .row button {
      border: 0; border-radius: 6px; padding: 6px 12px;
      font: inherit; font-weight: 600; color: #f2f2f7; background: rgba(255, 255, 255, 0.12);
    }
    .row button.go { background: #0a84ff; }
    .row button:disabled { opacity: 0.5; }
    @media (prefers-color-scheme: light) {
      .hint, .panel { background: rgba(250, 250, 252, 0.96); color: #1d1d1f; box-shadow: 0 8px 30px rgba(0,0,0,.16), inset 0 0 0 1px rgba(0,0,0,.06); }
      .sel { background: rgba(0,0,0,.05); color: #6e6e73; }
      .field span { color: #6e6e73; }
      .field input { background: #fff; color: #1d1d1f; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
      .row button { color: #1d1d1f; background: rgba(0,0,0,.06); }
      .row button.go { color: #fff; background: #0a84ff; }
    }
  </style><div class="ring" hidden></div><div class="hint">Click the element to watch · <b>Esc</b> to cancel</div>`;
  document.documentElement.append(host);

  const ring = root.querySelector(".ring");
  const hint = root.querySelector(".hint");
  let target = null;
  let raf = 0;
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("click", pick, true);
    document.removeEventListener("keydown", key, true);
    host.remove();
    window.notaPickerCleanup = null;
  };
  window.notaPickerCleanup = cleanup;

  function move(e) {
    target = e.composedPath?.()[0] ?? e.target;
    if (!(target instanceof Element) || target === host) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!(target instanceof Element) || !target.isConnected) return;
      const r = target.getBoundingClientRect();
      Object.assign(ring.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      ring.hidden = false;
    });
  }

  function pick(e) {
    // Swallow the page's own click: the user is choosing the element.
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = (e.composedPath?.()[0] ?? e.target) instanceof Element ? (e.composedPath?.()[0] ?? e.target) : target;
    if (!(el instanceof Element) || el === document.documentElement || el === document.body) return;
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("click", pick, true);
    ring.hidden = true;
    hint.remove();
    showPanel(el);
  }

  function key(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      cleanup();
    }
  }
  document.addEventListener("pointermove", move, true);
  document.addEventListener("click", pick, true);
  document.addEventListener("keydown", key, true);

  function showPanel(el) {
    const selector = selectorFor(el);
    const label = (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.textContent ||
      el.localName
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const guess = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 3)
      .join("-")
      .slice(0, 24);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `<div class="cap">Watch this element</div><code class="sel"></code>
      <label class="field"><span>Keyword (becomes a tag)</span><input maxlength="40" placeholder="like, star, read later"></label>
      <p class="msg"></p>
      <div class="row"><button type="button" class="cancel">Cancel</button><button type="button" class="go">Watch</button></div>`;
    panel.querySelector(".sel").textContent = selector || "the whole page";
    const input = panel.querySelector("input");
    input.value = guess;
    root.append(panel);
    input.focus();
    input.select();

    const msg = (text) => (panel.querySelector(".msg").textContent = text);
    const close = () => cleanup();
    panel.querySelector(".cancel").onclick = close;

    const go = panel.querySelector(".go");
    go.onclick = async () => {
      const tag = input.value.trim().replace(/^#+/, "").replace(/\s+/g, " ");
      if (!tag) return msg("Give it a keyword first.");
      go.disabled = true;
      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: "add-trigger",
          selector,
          label,
          tag,
        });
      } catch {}
      if (!res?.ok) {
        go.disabled = false;
        return msg(res?.error || "Couldn't save this trigger.");
      }
      close();
      notaToast("saved", `Watching · #${tag}`);
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") go.click();
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
  }

  // Prefer the element's own stable attributes. The trigger matches any element
  // in the click path, so a selector inside shadow DOM still works.
  function selectorFor(el) {
    if (el === document.documentElement || el === document.body) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    for (const name of ["data-testid", "data-test", "aria-label", "name", "title"]) {
      const value = el.getAttribute(name);
      if (value && value.length <= 80) return `${el.localName}[${name}="${CSS.escape(value)}"]`;
    }
    for (const name of el.getAttributeNames()) {
      if (!name.startsWith("data-") && el.getAttribute(name) === "" && name.length <= 30)
        return `${el.localName}[${name}]`;
    }
    const type = el.getAttribute("type");
    if (type) return `${el.localName}[type="${CSS.escape(type)}"]`;
    // Last resort: position among siblings. Still matches via composedPath().
    let n = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling)
      if (s.localName === el.localName) n++;
    return `${el.localName}:nth-of-type(${n})`;
  }
})();
