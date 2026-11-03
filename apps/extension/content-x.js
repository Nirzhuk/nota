// Like or bookmark a post on X -> save it.
// Capture phase so we read the tweet before X re-renders the button.
// Swap out any previous copy's listener (re-injection after an update).
document.removeEventListener("click", window.notaClickX, true);
window.notaClickX = (e) => {
  if (e.__notaHandled) return;
  const btn = e.target.closest?.('[data-testid="like"], [data-testid="bookmark"]');
  const article = btn?.closest('article[data-testid="tweet"]');
  const note = article && parse(article);
  if (note) notaSave(note, btn.dataset.testid === "like" ? "like" : "bookmark");
};
document.addEventListener("click", window.notaClickX, true);

// Popup Import: scroll x.com/i/history (bookmarks), /i/history/likes,
// /i/bookmarks, or /<user>/likes. Every post gets a tag so it becomes a
// collection in Nota.
function startImport(onTick, opts = {}) {
  if (!notaLive() || window.notaImporting) return Promise.resolve({ count: 0, done: false });
  const likes = /\/likes\/?$/.test(opts.path ?? location.pathname);
  const tag = likes ? "x-likes" : "x-bookmarks";
  chrome.storage.local.set({
    xImport: { running: true, count: opts.base ?? 0, tag, at: Date.now() },
  });
  return notaImport(
    () =>
      [...document.querySelectorAll('article[data-testid="tweet"]')].map((article) => {
        const note = parse(article);
        return note && { ...note, tags: notaTags(note.tags, tag), imported: true };
      }),
    (count, done) => {
      chrome.storage.local.set({
        xImport: {
          running: !done,
          count: (opts.base ?? 0) + count,
          tag,
          at: Date.now(),
          endedAt: done ? Date.now() : undefined,
        },
      });
      onTick?.(count, done);
    },
    opts,
  );
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "import") startImport();
});

// History page: an animated button imports every tab (bookmarks + likes)
// and counts the posts it saved while scrolling each list.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isHistoryPage() {
  return /^\/i\/history(?:\/|$)/.test(location.pathname);
}

function historyTab(href) {
  const want = new URL(href, location.origin).pathname;
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const a = tab.closest("a") ?? tab.querySelector("a");
    const got = a?.getAttribute("href");
    if (!got) continue;
    try {
      if (new URL(got, location.origin).pathname === want) return a ?? tab;
    } catch {}
  }
}

function historyLists() {
  const seen = new Set();
  const lists = [];
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const a = tab.closest("a") ?? tab.querySelector("a");
    const href = a?.getAttribute("href") ?? "";
    let path;
    try {
      path = new URL(href, location.origin).pathname;
    } catch {
      continue;
    }
    if (!/^\/i\/(?:history|bookmarks)\b/.test(path) || seen.has(path)) continue;
    seen.add(path);
    lists.push({ href, path, selected: tab.getAttribute("aria-selected") === "true" });
  }
  if (!lists.length) {
    lists.push({ href: location.pathname, path: location.pathname, selected: true });
  }
  return lists.sort((a, b) => Number(b.selected) - Number(a.selected));
}

let historyBtn;
let historyState = "idle";
let historyStopped = false;
let historyTimer;

function setHistory(text, icon, cls = "") {
  if (!historyBtn) return;
  historyBtn.querySelector(".l").textContent = text;
  historyBtn.querySelector(".i").innerHTML = notaIcon(icon, 15);
  historyBtn.className = cls ? `b on ${cls}` : "b on";
  historyBtn.title = cls === "busy" ? "Stop importing" : "";
}

async function importAll() {
  historyStopped = false;
  const stop = (e) => e.key === "Escape" && (historyStopped = true);
  addEventListener("keydown", stop, true);
  historyState = "running";
  clearTimeout(historyTimer);
  setHistory("Importing · 0", "sync", "busy");
  let total = 0;
  for (const list of historyLists()) {
    if (historyStopped) break;
    if (!list.selected && location.pathname !== list.path) {
      const tab = historyTab(list.href);
      if (!tab) continue;
      const before = location.pathname;
      scrollTo(0, 0);
      tab.click();
      for (let i = 0; i < 20 && location.pathname === before; i++) await sleep(100);
      if (location.pathname === before) continue;
      await sleep(1200);
      if (historyStopped) break;
    }
    const res = await startImport(
      (count) => {
        if (historyState === "running") setHistory(`Importing · ${total + count}`, "sync", "busy");
      },
      { quiet: true, base: total, path: list.path },
    );
    total += res.count;
    if (!res.done) {
      historyStopped = true;
      break;
    }
  }
  removeEventListener("keydown", stop, true);
  if (historyState !== "running") return;
  historyState = historyStopped ? "stopped" : "done";
  setHistory(
    historyStopped ? `Stopped · ${total}` : `Imported ${total}`,
    historyStopped ? "download" : "check",
    historyStopped ? "" : "done",
  );
  historyTimer = setTimeout(() => {
    if (historyState === "running") return;
    historyState = "idle";
    if (isHistoryPage()) setHistory("Import all", "download");
    else historyBtn?.classList.remove("on");
  }, 4000);
}

function historyButton() {
  if (historyBtn?.isConnected) return historyBtn;
  historyBtn = undefined;
  const host = document.createElement("nota-history");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    .b {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      display: flex; align-items: center; gap: 7px; white-space: nowrap;
      padding: 9px 13px 9px 10px; border: 0; border-radius: 999px;
      background: rgba(28, 28, 30, 0.92); color: #f2f2f7;
      font: 500 12px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.22), inset 0 0 0 0.5px rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(12px); cursor: pointer;
      opacity: 0; transform: translateY(12px) scale(0.96); pointer-events: none;
      transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 240ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .b.on { opacity: 1; transform: none; pointer-events: auto; }
    .b:active { transform: scale(0.97); }
    .i { display: flex; color: #0a84ff; }
    .b.done .i { color: #30d158; }
    .b.busy .i svg { animation: spin 700ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .b, .b.on { transform: none; transition: opacity 200ms ease; }
      .b.busy .i svg { animation: none; }
    }
  </style><button class="b" type="button"><span class="i"></span><span class="l" aria-live="polite"></span></button>`;
  document.documentElement.append(host);
  historyBtn = root.querySelector(".b");
  historyBtn.querySelector(".l").textContent = "Import all";
  historyBtn.querySelector(".i").innerHTML = notaIcon("download", 15);
  historyBtn.onclick = () => {
    if (!notaLive()) return;
    if (historyState === "running") {
      historyStopped = true;
      window.notaImporting = false;
      return;
    }
    if (window.notaImporting) return;
    importAll();
  };
  return historyBtn;
}

function syncHistoryButton() {
  if (!notaLive()) return;
  if (isHistoryPage()) {
    const btn = historyButton();
    if (!btn.classList.contains("on")) requestAnimationFrame(() => btn.classList.add("on"));
  } else if (historyBtn && historyState !== "running") {
    historyBtn.classList.remove("on");
  }
}
document.querySelectorAll("nota-history").forEach((host) => host.remove());
syncHistoryButton();
setInterval(syncHistoryButton, 1000);

function parse(article) {
  const link = article.querySelector('a[href*="/status/"] time')?.closest("a");
  const id = link?.href.match(/\/status\/(\d+)/)?.[1];
  if (!id) return null;

  const lines = (article.querySelector('[data-testid="User-Name"]')?.innerText ?? "").split("\n");
  const handle = lines.find((l) => l.startsWith("@")) ?? "";

  const images = [
    ...[...article.querySelectorAll('[data-testid="tweetPhoto"] img')].map((i) =>
      i.src.replace(/name=\w+/, "name=large"),
    ),
    ...[...article.querySelectorAll("video[poster]")].map((v) => v.poster),
  ];

  // Links in the text are t.co redirects; the anchor text has the real domain.
  // Link cards carry "domain Title" in aria-label. Hashtags/mentions point at x.com: skip.
  const links = [...article.querySelectorAll('[data-testid="tweetText"] a[href], [data-testid="card.wrapper"] a[href]')]
    .filter((a) => !/^https:\/\/(x|twitter)\.com\//.test(a.href))
    .map((a) => ({
      url: a.href,
      label: (a.getAttribute("aria-label") || a.textContent)
        .trim()
        .split(/\s/)[0]
        .replace(/^https?:\/\/(www\.)?/, "")
        .replace(/…$/, ""),
    }));

  return {
    id: `x:${id}`,
    source: "x",
    url: link.href.split("?")[0],
    author: [lines[0], handle].filter(Boolean).join(" "),
    avatar: article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src,
    text: textOf(article.querySelector('[data-testid="tweetText"]')),
    images: [...new Set(images)].slice(0, 4),
    links: notaLinks(links),
    savedAt: Date.now(),
  };
}

// innerText breaks links into "https://\ngithub.com/a\nbc\n…" (X hides parts of
// the URL in spans). Walk the nodes instead: links whole, emoji from img alt.
function textOf(el) {
  if (!el) return "";
  return [...el.childNodes]
    .map((n) =>
      n.nodeType === Node.TEXT_NODE ? n.nodeValue
      : n.tagName === "IMG" ? n.alt
      : n.tagName === "A" ? n.textContent.replace(/…$/, "")
      : n.tagName === "BR" ? "\n"
      : textOf(n),
    )
    .join("");
}
