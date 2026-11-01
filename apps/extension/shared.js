// Shared by content scripts and popup. Uses var/function (not const/let) so
// re-injecting after an extension update can't throw "already declared".
// Icons are Phosphor (MIT), inlined so the extension needs no build step.
var NOTA_ICONS = {
  gear: "<path d=\"M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.62a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Zm-15,34.91-28.57,16.25a8,8,0,0,0-3,3c-.58,1-1.19,2.06-1.81,3.06a7.94,7.94,0,0,0-1.22,4.21l-.15,32.25a95.89,95.89,0,0,1-25.37,14.3L134,199.13a8,8,0,0,0-3.91-1h-.19c-1.21,0-2.43,0-3.64,0a8.08,8.08,0,0,0-4.1,1l-28.84,16.1A96,96,0,0,1,67.88,201l-.11-32.2a8,8,0,0,0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.09,8.09,0,0,0-3-3.06l-28.6-16.29a90.49,90.49,0,0,1,0-28.26L61.67,97.63a8,8,0,0,0,3-3c.58-1,1.19-2.06,1.81-3.06a7.94,7.94,0,0,0,1.22-4.21l.15-32.25a95.89,95.89,0,0,1,25.37-14.3L122,56.87a8,8,0,0,0,4.1,1c1.21,0,2.43,0,3.64,0a8.08,8.08,0,0,0,4.1-1l28.84-16.1A96,96,0,0,1,188.12,55l.11,32.2a8,8,0,0,0,1.22,4.22c.62,1,1.23,2,1.8,3.06a8.09,8.09,0,0,0,3,3.06l28.6,16.29A90.49,90.49,0,0,1,222.9,142.12Z\"/>",
  check: "<path d=\"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z\"/>",
  clock: "<path d=\"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z\"/>",
  link: "<path d=\"M165.66,90.34a8,8,0,0,1,0,11.32l-64,64a8,8,0,0,1-11.32-11.32l64-64A8,8,0,0,1,165.66,90.34ZM215.6,40.4a56,56,0,0,0-79.2,0L106.34,70.45a8,8,0,0,0,11.32,11.32l30.06-30a40,40,0,0,1,56.57,56.56l-30.07,30.06a8,8,0,0,0,11.31,11.32L215.6,119.6a56,56,0,0,0,0-79.2ZM138.34,174.22l-30.06,30.06a40,40,0,1,1-56.56-56.57l30.05-30.05a8,8,0,0,0-11.32-11.32L40.4,136.4a56,56,0,0,0,79.2,79.2l30.06-30.07a8,8,0,0,0-11.32-11.31Z\"/>",
  sync: "<path d=\"M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.63,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z\"/>",
  download: "<path d=\"M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z\"/>",
  x: "<path d=\"M214.75,211.71l-62.6-98.38,61.77-67.95a8,8,0,0,0-11.84-10.76L143.24,99.34,102.75,35.71A8,8,0,0,0,96,32H48a8,8,0,0,0-6.75,12.3l62.6,98.37-61.77,68a8,8,0,1,0,11.84,10.76l58.84-64.72,40.49,63.63A8,8,0,0,0,160,224h48a8,8,0,0,0,6.75-12.29ZM164.39,208,62.57,48h29L193.43,208Z\"/>",
  reddit: "<path d=\"M248,104a32,32,0,0,0-52.94-24.19c-16.75-8.9-36.76-14.28-57.66-15.53l5.19-31.17,17.72,2.72a24,24,0,1,0,2.87-15.74l-26-4a8,8,0,0,0-9.11,6.59L121.2,64.16c-21.84.94-42.82,6.38-60.26,15.65a32,32,0,0,0-42.59,47.74A59,59,0,0,0,16,144c0,21.93,12,42.35,33.91,57.49C70.88,216,98.61,224,128,224s57.12-8,78.09-22.51C228,186.35,240,165.93,240,144a59,59,0,0,0-2.35-16.45A32.16,32.16,0,0,0,248,104ZM184,24a8,8,0,1,1-8,8A8,8,0,0,1,184,24Zm40.13,93.78a8,8,0,0,0-3.29,10A43.58,43.58,0,0,1,224,144c0,16.53-9.59,32.27-27,44.33C178.67,201,154.17,208,128,208s-50.67-7-69-19.67C41.59,176.27,32,160.53,32,144a43.75,43.75,0,0,1,3.14-16.17,8,8,0,0,0-3.27-10A16,16,0,1,1,52.94,94.59a8,8,0,0,0,10.45,2.23l.36-.22C81.45,85.9,104.25,80,128,80h0c23.73,0,46.53,5.9,64.23,16.6l.42.25a8,8,0,0,0,10.39-2.26,16,16,0,1,1,21.07,23.19ZM88,144a16,16,0,1,1,16-16A16,16,0,0,1,88,144Zm96-16a16,16,0,1,1-16-16A16,16,0,0,1,184,128Zm-16.93,44.25a8,8,0,0,1-3.32,10.82,76.18,76.18,0,0,1-71.5,0,8,8,0,1,1,7.5-14.14,60.18,60.18,0,0,0,56.5,0A8,8,0,0,1,167.07,172.25Z\"/>",
  youtube: "<path d=\"M164.44,121.34l-48-32A8,8,0,0,0,104,96v64a8,8,0,0,0,12.44,6.66l48-32a8,8,0,0,0,0-13.32ZM120,145.05V111l25.58,17ZM234.33,69.52a24,24,0,0,0-14.49-16.4C185.56,39.88,131,40,128,40s-57.56-.12-91.84,13.12a24,24,0,0,0-14.49,16.4C19.08,79.5,16,97.74,16,128s3.08,48.5,5.67,58.48a24,24,0,0,0,14.49,16.41C69,215.56,120.4,216,127.34,216h1.32c6.94,0,58.37-.44,91.18-13.11a24,24,0,0,0,14.49-16.41c2.59-10,5.67-28.22,5.67-58.48S236.92,79.5,234.33,69.52Zm-15.49,113a8,8,0,0,1-4.77,5.49c-31.65,12.22-85.48,12-86,12H128c-.54,0-54.33.2-86-12a8,8,0,0,1-4.77-5.49C34.8,173.39,32,156.57,32,128s2.8-45.39,5.16-54.47A8,8,0,0,1,41.93,68c30.52-11.79,81.66-12,85.85-12h.27c.54,0,54.38-.18,86,12a8,8,0,0,1,4.77,5.49C221.2,82.61,224,99.43,224,128S221.2,173.39,218.84,182.47Z\"/>",
  github: "<path d=\"M208.31,75.68A59.78,59.78,0,0,0,202.93,28,8,8,0,0,0,196,24a59.75,59.75,0,0,0-48,24H124A59.75,59.75,0,0,0,76,24a8,8,0,0,0-6.93,4,59.78,59.78,0,0,0-5.38,47.68A58.14,58.14,0,0,0,56,104v8a56.06,56.06,0,0,0,48.44,55.47A39.8,39.8,0,0,0,96,192v8H72a24,24,0,0,1-24-24A40,40,0,0,0,8,136a8,8,0,0,0,0,16,24,24,0,0,1,24,24,40,40,0,0,0,40,40H96v16a8,8,0,0,0,16,0V192a24,24,0,0,1,48,0v40a8,8,0,0,0,16,0V192a39.8,39.8,0,0,0-8.44-24.53A56.06,56.06,0,0,0,216,112v-8A58.14,58.14,0,0,0,208.31,75.68ZM200,112a40,40,0,0,1-40,40H112a40,40,0,0,1-40-40v-8a41.74,41.74,0,0,1,6.9-22.48A8,8,0,0,0,80,73.83a43.81,43.81,0,0,1,.79-33.58,43.88,43.88,0,0,1,32.32,20.06A8,8,0,0,0,119.82,64h32.35a8,8,0,0,0,6.74-3.69,43.87,43.87,0,0,1,32.32-20.06A43.81,43.81,0,0,1,192,73.83a8.09,8.09,0,0,0,1,7.65A41.72,41.72,0,0,1,200,104Z\"/>",
  hn: "<path d=\"M88,112a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H96A8,8,0,0,1,88,112Zm8,40h80a8,8,0,0,0,0-16H96a8,8,0,0,0,0,16ZM232,64V184a24,24,0,0,1-24,24H32A24,24,0,0,1,8,184.11V88a8,8,0,0,1,16,0v96a8,8,0,0,0,16,0V64A16,16,0,0,1,56,48H216A16,16,0,0,1,232,64Zm-16,0H56V184a23.84,23.84,0,0,1-1.37,8H208a8,8,0,0,0,8-8Z\"/>",
  bluesky: "<path d=\"M232.7,50.48C229,45.7,221.84,40,209,40c-16.85,0-38.46,11.28-57.81,30.16A140.07,140.07,0,0,0,136,87.53V56a8,8,0,0,0-16,0V87.53a140.07,140.07,0,0,0-15.15-17.37C85.49,51.28,63.88,40,47,40,34.16,40,27,45.7,23.3,50.48c-6.82,8.77-12.18,24.08-.21,71.2,6.05,23.83,19.51,33,30.63,36.42A44,44,0,0,0,128,205.27a44,44,0,0,0,74.28-47.17c11.12-3.4,24.57-12.59,30.63-36.42C239.63,95.24,244.85,66.1,232.7,50.48ZM92,208A28.12,28.12,0,0,1,88.86,152a8,8,0,1,0-1.76-15.9A43.64,43.64,0,0,0,66.36,144c-8.43.09-22-3.57-27.76-26.26C35.72,106.39,27,71.86,35.94,60.3,37.37,58.46,40.09,56,47,56c27.27,0,73,44.88,73,71.67V180A28,28,0,0,1,92,208ZM217.4,117.74c-5.77,22.69-19.33,26.34-27.77,26.26a43.6,43.6,0,0,0-20.74-7.95,8,8,0,1,0-1.76,15.9A28.11,28.11,0,1,1,136,180V127.67C136,100.88,181.69,56,209,56c6.95,0,9.66,2.46,11.1,4.3C229.05,71.86,220.28,106.39,217.4,117.74Z\"/>",
  instagram: "<path d=\"M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160ZM176,24H80A56.06,56.06,0,0,0,24,80v96a56.06,56.06,0,0,0,56,56h96a56.06,56.06,0,0,0,56-56V80A56.06,56.06,0,0,0,176,24Zm40,152a40,40,0,0,1-40,40H80a40,40,0,0,1-40-40V80A40,40,0,0,1,80,40h96a40,40,0,0,1,40,40ZM192,76a12,12,0,1,1-12-12A12,12,0,0,1,192,76Z\"/>",
};
function notaIcon(name, size = 14) {
  return `<svg viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${NOTA_ICONS[name] ?? NOTA_ICONS.link}</svg>`;
}

// Dedupe links by url, keep the first one that has a label.
function notaLinks(list) {
  const m = new Map();
  for (const l of list) if (l.label && !m.has(l.url)) m.set(l.url, l);
  return [...m.values()].slice(0, 6);
}

// Trim, drop a leading #, and dedupe. A trigger's keyword is a collection tag.
function notaTags(...lists) {
  const out = [];
  for (const list of lists) {
    const items = typeof list === "string" ? [list] : (list ?? []);
    for (const raw of items) {
      const tag = String(raw).trim().replace(/^#+/, "");
      if (tag && !out.includes(tag)) out.push(tag);
    }
  }
  return out;
}

// Site id shared by content scripts, the picker, and the app's source filters.
function notaSite(host = location.hostname) {
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return "x";
  if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return "youtube";
  if (/(^|\.)github\.com$/.test(host)) return "github";
  if (host === "news.ycombinator.com") return "hn";
  if (/(^|\.)bsky\.app$/.test(host)) return "bluesky";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  return "web";
}

function notaMeta(name) {
  return document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() ?? "";
}

// Page-level save: enough for any site, no per-site rules. Context-menu saves
// (background.js) use the same `web:<url>` id so the two paths dedupe.
function notaPageNote(tags = []) {
  const base = document.querySelector('link[rel="canonical"]')?.href || notaMeta("og:url") || location.href;
  let url = base.split("#")[0];
  try {
    url = new URL(url, location.href).href;
  } catch {}
  const image = notaMeta("og:image") || notaMeta("twitter:image");
  return {
    id: `web:${url}`,
    source: notaSite(),
    url,
    author: location.hostname.replace(/^www\./, ""),
    title: notaMeta("og:title") || notaMeta("twitter:title") || document.title.trim(),
    text: notaMeta("og:description") || notaMeta("description") || notaMeta("twitter:description"),
    images: image ? [new URL(image, location.href).href] : [],
    links: [],
    tags: notaTags(tags),
    savedAt: Date.now(),
  };
}

// Status pill at the bottom of the page. Closed shadow DOM keeps site CSS out.
// Transitions (not keyframes) so rapid likes retarget instead of restarting.
var notaPill, notaPillTimer;
var NOTA_PILL = {
  saved: ["check", "Saved to Nota", 1600],
  queued: ["clock", "Queued · open Nota to sync", 3200],
  stale: ["sync", "Nota was updated · refresh this page", 3200],
  importing: ["download", "Importing…", 4000],
};
function notaToast(state, label) {
  if (!notaPill) {
    const host = document.createElement("nota-toast");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .t {
        --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
        position: fixed; left: 50%; bottom: 24px; z-index: 2147483647;
        display: flex; align-items: center; gap: 6px;
        padding: 7px 12px 7px 9px; border-radius: 999px;
        background: rgba(28, 28, 30, 0.92); color: #f2f2f7;
        font: 500 12px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        font-variant-numeric: tabular-nums;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18), inset 0 0 0 0.5px rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(12px); pointer-events: none;
        opacity: 0; transform: translate(-50%, calc(100% + 24px));
        transition: transform 240ms var(--ease-out), opacity 240ms var(--ease-out);
      }
      .t.on { opacity: 1; transform: translate(-50%, 0); }
      .i { display: flex; color: #30d158; transition: color 150ms ease; }
      .queued .i { color: #ff9f0a; }
      .stale .i { color: #ff453a; }
      .importing .i { color: #0a84ff; }
      .importing { pointer-events: auto; cursor: pointer; } /* click to stop */
      @media (prefers-reduced-motion: reduce) {
        .t, .t.on { transform: translate(-50%, 0); transition: opacity 200ms ease; }
      }
    </style><div class="t" role="status"><span class="i"></span><span class="l"></span></div>`;
    document.documentElement.append(host);
    notaPill = root.querySelector(".t");
    notaPill.onclick = () => (window.notaImporting = false);
    notaPill.offsetWidth; // commit the hidden state so the first show transitions
  }
  const [icon, text, ms] = NOTA_PILL[state];
  notaPill.className = `t on ${state}`;
  notaPill.querySelector(".i").innerHTML = notaIcon(icon, 15);
  notaPill.querySelector(".l").textContent = label ?? text;
  clearTimeout(notaPillTimer);
  notaPillTimer = setTimeout(() => notaPill.classList.remove("on"), ms);
}

// On update, background.js injects fresh copies into open tabs. The newest copy
// stamps the page; older copies see a different stamp and stay quiet.
var NOTA_STAMP = Math.random().toString(36).slice(2);
document.documentElement.dataset.nota = NOTA_STAMP;
function notaLive() {
  return document.documentElement.dataset.nota === NOTA_STAMP && !!chrome.runtime?.id;
}

// Resolves "saved" | "queued" | "stale". Only says "Saved" once the extension
// has the notes: no false confirmations.
async function notaSend(notes) {
  if (document.documentElement.dataset.nota !== NOTA_STAMP) return "stale";
  try {
    const r = await chrome.runtime.sendMessage({ type: "save", notes });
    return r ? (r.sent ? "saved" : "queued") : "stale";
  } catch {
    return "stale";
  }
}
// What gets saved automatically. Popup → "What Nota saves" toggles these.
// Stored as a list of turned-off "<source>.<action>" keys, so new sites/actions
// default to on. Explicit saves (Save page, watched elements, imports) skip this.
var NOTA_SITES = {
  x: ["X", { like: "Likes", bookmark: "Bookmarks" }],
  reddit: ["Reddit", { upvote: "Upvotes" }],
  youtube: ["YouTube", { like: "Likes", playlist: "Watch later & playlists" }],
  github: ["GitHub", { star: "Stars" }],
  hn: ["Hacker News", { upvote: "Upvotes", favorite: "Favorites" }],
  bluesky: ["Bluesky", { like: "Likes", bookmark: "Bookmarks" }],
  instagram: ["Instagram", { save: "Saves" }],
};

// action: which automatic capture this is ("like", "star", …). Turned off → do
// nothing at all: no pill, nothing leaves the page.
async function notaSave(note, action) {
  if (document.documentElement.dataset.nota !== NOTA_STAMP) return;
  if (action) {
    try {
      const { off = [] } = await chrome.storage.local.get("off");
      if (off.includes(`${note.source}.${action}`)) return;
    } catch {
      return notaToast("stale");
    }
  }
  notaToast(await notaSend([note]));
}

// Import progress: the number counts up to each new total instead of jumping.
// Ease-out over 600ms; tabular-nums keeps the pill from jittering.
var notaShown = 0;
var notaRaf;
function notaProgress(total) {
  notaToast("importing", "");
  const l = notaPill.querySelector(".l");
  l.innerHTML = 'Importing · <span class="n"></span> · click or Esc to stop';
  const el = l.querySelector(".n");
  cancelAnimationFrame(notaRaf);
  const from = notaShown;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return (el.textContent = notaShown = total);
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 600);
    notaShown = Math.round(from + (total - from) * (1 - (1 - p) ** 3));
    el.textContent = notaShown;
    if (p < 1) notaRaf = requestAnimationFrame(step);
  };
  el.textContent = from;
  notaRaf = requestAnimationFrame(step);
}

// Scroll the page and save every post `collect()` finds, until nothing new
// shows up. Esc or clicking the pill stops. Used for X bookmarks/likes (x.com/i/history).
async function notaImport(collect, onTick) {
  if (window.notaImporting) return;
  window.notaImporting = true;
  notaShown = 0;
  // capture phase: X handles Escape itself and stops it before it bubbles to us
  const stop = (e) => e.key === "Escape" && (window.notaImporting = false);
  addEventListener("keydown", stop, true);
  const seen = new Set();
  const t0 = Date.now();
  let idle = 0;
  while (window.notaImporting && idle < 6) {
    const fresh = collect().filter((n) => n && !seen.has(n.id) && seen.add(n.id));
    // keep page order: first post on the page = most recent
    fresh.forEach((n, i) => (n.savedAt = t0 - seen.size + fresh.length - i));
    idle = fresh.length ? 0 : idle + 1;
    if (fresh.length && (await notaSend(fresh)) === "stale") break;
    onTick?.(seen.size);
    notaProgress(seen.size);
    scrollBy(0, innerHeight * 0.8);
    await new Promise((r) => setTimeout(r, 1200));
  }
  window.notaImporting = false;
  removeEventListener("keydown", stop, true);
  cancelAnimationFrame(notaRaf);
  onTick?.(seen.size, true);
  notaToast("saved", `Imported ${seen.size} posts`);
}
