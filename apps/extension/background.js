// Notes queue in chrome.storage until the Nota app accepts them,
// so nothing is lost while the app is closed.
const API = "http://127.0.0.1:4317/notes";
const APP_PAGE = "https://github.com/Nirzhuk/nota/releases/latest";

// Tells the app the extension is installed, and remembers that the app exists.
const ping = () =>
  fetch("http://127.0.0.1:4317/ping", { headers: { "X-Nota": "1" } }).then(
    async (res) => {
      if (res.ok) await chrome.storage.local.set({ appSeen: true });
      return res.ok;
    },
    () => false,
  );

let lock = Promise.resolve();
const serial = (fn) => (lock = lock.then(fn, fn));

const enqueue = (notes) =>
  serial(async () => {
    const { queue = {}, recent = [] } = await chrome.storage.local.get(["queue", "recent"]);
    for (const n of notes) queue[n.id] = n;
    recent.unshift(...notes.slice(0, 20));
    await chrome.storage.local.set({
      queue,
      recent: recent.filter((n, i) => recent.findIndex((m) => m.id === n.id) === i).slice(0, 20),
    });
  }).then(flush);

// Resolves true when everything reached the app.
const flush = () =>
  serial(async () => {
    const { queue = {} } = await chrome.storage.local.get("queue");
    const notes = Object.values(queue);
    try {
      if (notes.length) {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Nota": "1" },
          body: JSON.stringify(notes),
        });
        if (!res.ok) throw new Error(res.status);
        await chrome.storage.local.set({ queue: {} });
      }
      chrome.action.setBadgeText({ text: "" });
      return true;
    } catch {
      chrome.action.setBadgeText({ text: String(notes.length) });
      return false;
    }
  });

// ---------------------------------------------------------------------------
// Save anything: right-click, ⌥⇧S, or the popup's Save button.
// activeTab + scripting means no host permission is needed for one-off saves.

const siteOf = (href) => {
  const u = new URL(href);
  return `${u.protocol}//${u.hostname}`;
};

const shortHash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};

// Runs in the page. Must be self-contained: executeScript serializes it.
function extractNote(info) {
  const meta = (name) =>
    document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() ?? "";
  const abs = (value) => {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  };
  const sourceOf = (host) => {
    if (/(^|\.)(x|twitter)\.com$/.test(host)) return "x";
    if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return "youtube";
    if (/(^|\.)github\.com$/.test(host)) return "github";
    if (host === "news.ycombinator.com") return "hn";
    if (/(^|\.)bsky\.app$/.test(host)) return "bluesky";
    if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
    return "web";
  };
  const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  };

  const pageUrl = (
    document.querySelector('link[rel="canonical"]')?.href ||
    meta("og:url") ||
    location.href
  ).split("#")[0];
  const host = location.hostname.replace(/^www\./, "");
  const title = meta("og:title") || meta("twitter:title") || document.title.trim();
  const text = meta("og:description") || meta("description") || meta("twitter:description");
  const image = abs(meta("og:image") || meta("twitter:image"));
  const base = {
    source: sourceOf(host),
    url: pageUrl,
    author: host,
    title,
    text,
    images: image ? [image] : [],
    links: [],
    tags: [],
  };

  if (info.item === "save-link" && info.linkUrl) {
    let u;
    try {
      u = new URL(info.linkUrl);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const linkHost = u.hostname.replace(/^www\./, "");
    return {
      ...base,
      id: `web:${u.href}`,
      source: sourceOf(linkHost),
      url: u.href,
      author: linkHost,
      title: info.selectionText || title || u.href,
      text: "",
      images: [],
      links: [],
    };
  }

  if (info.item === "save-image" && info.srcUrl) {
    const src = abs(info.srcUrl);
    if (!/^https?:/.test(src)) return null;
    return { ...base, id: `web:${src}`, url: src, images: [src], text: "", links: [] };
  }

  if (info.item === "save-selection" && info.selectionText) {
    return {
      ...base,
      id: `web:${pageUrl}#${hash(info.selectionText)}`,
      text: info.selectionText,
      images: [],
      links: [],
    };
  }

  // Status pages and Reddit posts reuse the live-save ids, so the richer parser
  // and a manual save merge into one note (tags are unioned by the app).
  const x = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  if (x && /(^|\.)(x|twitter)\.com$/.test(location.hostname)) {
    return {
      ...base,
      id: `x:${x[2]}`,
      source: "x",
      url: `https://x.com/${x[1]}/status/${x[2]}`,
      author: meta("twitter:creator") || `@${x[1]}`,
      title: "",
    };
  }

  const r = location.pathname.match(/^\/r\/([^/]+)\/comments\/([^/]+)/);
  if (r && /(^|\.)reddit\.com$/.test(location.hostname)) {
    return {
      ...base,
      id: `reddit:t3_${r[2]}`,
      source: "reddit",
      url: `https://www.reddit.com${location.pathname.split("?")[0]}`,
      author: `r/${r[1]}`,
      text,
    };
  }

  // Match the ids the per-site content scripts use, so a right-click save and
  // an automatic like/star/upvote merge into one card (tags are unioned).
  if (sourceOf(host) === "youtube") {
    const id =
      new URLSearchParams(location.search).get("v") ||
      location.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
    if (id) {
      const note = {
        ...base,
        id: `youtube:${id}`,
        source: "youtube",
        url: `https://www.youtube.com/watch?v=${id}`,
      };
      delete note.author; // the live parser has the channel name
      return note;
    }
  }

  if (sourceOf(host) === "github") {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (m) {
      const repo = `${m[1]}/${m[2]}`;
      return {
        ...base,
        id: `github:${repo.toLowerCase()}`,
        source: "github",
        url: `https://github.com/${repo}`,
        author: m[1],
        title: repo,
        images: [`https://opengraph.githubassets.com/1/${repo}`],
      };
    }
  }

  if (sourceOf(host) === "hn" && location.pathname === "/item") {
    const id = new URLSearchParams(location.search).get("id");
    if (id) {
      const note = { ...base, id: `hn:${id}`, source: "hn", url: `https://news.ycombinator.com/item?id=${id}` };
      delete note.author; // the live parser has the username
      return note;
    }
  }

  if (sourceOf(host) === "bluesky") {
    const m = location.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/);
    if (m) {
      const note = {
        ...base,
        id: `bluesky:${m[1]}/${m[2]}`,
        source: "bluesky",
        url: `https://bsky.app/profile/${m[1]}/post/${m[2]}`,
      };
      delete note.author; // the live parser has display name + handle
      return note;
    }
  }

  if (sourceOf(host) === "instagram") {
    const m = location.pathname.match(/^\/(p|reel)\/([\w-]+)/);
    if (m) {
      const note = {
        ...base,
        id: `instagram:${m[2]}`,
        source: "instagram",
        url: `https://www.instagram.com/${m[1]}/${m[2]}/`,
      };
      delete note.author; // the live parser has the account name
      return note;
    }
  }

  return { ...base, id: `web:${pageUrl}` };
}

// Injecting shared.js also gives the page the toast pill.
const toast = (tabId, state) =>
  chrome.scripting
    .executeScript({ target: { tabId }, files: ["shared.js"] })
    .then(() =>
      chrome.scripting.executeScript({
        target: { tabId },
        func: (state) => notaToast(state),
        args: [state],
      }),
    )
    .catch(() => {});

async function saveTab(tab, info) {
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) return { sent: false };
  const data = {
    item: info?.item ?? info?.menuItemId,
    linkUrl: info?.linkUrl,
    srcUrl: info?.srcUrl,
    selectionText: info?.selectionText,
  };
  let note;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractNote,
      args: [data],
    });
    note = result?.result;
  } catch {
    return { sent: false };
  }
  if (!note?.id || !note.url) return { sent: false };
  note.savedAt = Date.now();
  const sent = await enqueue([note]);
  toast(tab.id, sent ? "saved" : "queued");
  return { sent };
}

async function saveActive() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return saveTab(tab, { item: "save-page" });
}

function contextMenus() {
  chrome.contextMenus.removeAll(() => {
    const item = (id, title, contexts) => chrome.contextMenus.create({ id, title, contexts });
    item("save-page", "Save page to Nota", ["page"]);
    item("save-link", "Save link to Nota", ["link"]);
    item("save-image", "Save image to Nota", ["image"]);
    item("save-selection", "Save selection to Nota", ["selection"]);
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (String(info.menuItemId).startsWith("save-")) saveTab(tab, info);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "save-page") saveActive();
});

// ---------------------------------------------------------------------------
// Reddit: read the account's own JSON while the browser is signed in.
// Reddit caps these lists at 1000; get what it keeps, with images and links.

function redditNote(child, tag) {
  const d = child?.data;
  if (!d || (child.kind !== "t3" && child.kind !== "t1") || !d.permalink) return null;
  const id = d.name || `${child.kind}_${d.id}`;
  const note = {
    id: `reddit:${id}`,
    source: "reddit",
    url: `https://www.reddit.com${d.permalink}`,
    author: `${d.subreddit_name_prefixed || `r/${d.subreddit || ""}`} · u/${d.author || "[deleted]"}`,
    savedAt: (d.created_utc || 0) * 1000 || Date.now(),
    tags: [tag],
  };
  if (child.kind === "t1") {
    return { ...note, title: "", text: d.body || "", images: [], links: [] };
  }

  const images = [];
  const add = (url) => {
    if (url && /^https:\/\/(i|preview|external-preview)\.redd\.it\//.test(url))
      images.push(url.replace(/&amp;/g, "&"));
  };
  add(d.url_overridden_by_dest);
  add(d.preview?.images?.[0]?.source?.url);
  for (const item of d.gallery_data?.items ?? []) {
    const media = d.media_metadata?.[item.media_id];
    add(media?.s?.u || media?.s?.gif);
  }

  const links = [];
  if (d.url_overridden_by_dest) {
    try {
      const u = new URL(d.url_overridden_by_dest);
      if (/^https?:$/.test(u.protocol) && !/(^|\.)(reddit\.com|redd\.it)$/.test(u.hostname))
        links.push({ url: u.href, label: d.domain || u.hostname.replace(/^www\./, "") });
    } catch {}
  }

  return {
    ...note,
    title: d.title || "",
    text: d.selftext || "",
    images: [...new Set(images)].slice(0, 4),
    links,
  };
}

let redditRunning = false;
async function importReddit() {
  if (redditRunning) return;
  redditRunning = true;
  const status = (value) => chrome.storage.local.set({ redditImport: { ...value, at: Date.now() } });
  let total = 0;
  await status({ running: true, count: 0, list: "upvoted" });
  try {
    const meRes = await fetch("https://www.reddit.com/api/v1/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!meRes.ok) throw new Error("Sign in to reddit.com first");
    const me = await meRes.json();
    if (!me?.name) throw new Error("Sign in to reddit.com first");

    for (const list of ["upvoted", "saved"]) {
      const seen = new Set();
      let after = "";
      let pages = 0;
      while (seen.size < 1000 && pages++ < 12) {
        const url = new URL(
          `https://www.reddit.com/user/${encodeURIComponent(me.name)}/${list}.json`,
        );
        url.searchParams.set("limit", "100");
        url.searchParams.set("raw_json", "1");
        if (after) url.searchParams.set("after", after);
        const res = await fetch(url, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Reddit returned ${res.status}`);
        const data = await res.json();
        const children = data?.data?.children ?? [];
        const notes = [];
        for (const child of children) {
          const note = redditNote(child, `reddit-${list}`);
          if (note && !seen.has(note.id)) {
            seen.add(note.id);
            notes.push({ ...note, imported: true }); // the app won't bring back posts the user removed
          }
        }
        if (notes.length) {
          await enqueue(notes);
          total += notes.length;
          await status({ running: true, count: total, list });
        }
        after = data?.data?.after;
        if (!after || !children.length) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await status({ running: false, count: total, endedAt: Date.now() });
  } catch (e) {
    await status({
      running: false,
      count: total,
      error: String(e?.message || e),
      endedAt: Date.now(),
    });
  } finally {
    redditRunning = false;
  }
}

// GitHub stars: username comes from the github.com session, stars from the
// public API (CORS-open, no token). ponytail: 60 req/h unauthenticated = 6000 stars per hour.
let githubRunning = false;
async function importGithub() {
  if (githubRunning) return;
  githubRunning = true;
  const status = (value) => chrome.storage.local.set({ githubImport: { ...value, at: Date.now() } });
  let total = 0;
  await status({ running: true, count: 0 });
  try {
    const home = await fetch("https://github.com/", { credentials: "include" }).then((r) => r.text());
    const login = home.match(/<meta name="user-login" content="([^"]+)"/)?.[1];
    if (!login) throw new Error("Sign in to github.com first");

    for (let page = 1; page <= 100; page++) {
      const res = await fetch(
        `https://api.github.com/users/${encodeURIComponent(login)}/starred?per_page=100&page=${page}`,
        { headers: { Accept: "application/vnd.github.star+json" } }, // adds starred_at
      );
      if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit, try again in an hour");
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const batch = await res.json();
      if (!batch.length) break;
      const notes = batch.map(({ starred_at, repo: r }) => ({
        id: `github:${r.full_name.toLowerCase()}`,
        source: "github",
        url: r.html_url,
        author: r.owner.login,
        title: r.full_name,
        text: [r.description, r.topics?.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n\n"),
        images: [`https://opengraph.githubassets.com/1/${r.full_name}`],
        links: r.homepage
          ? [{ url: r.homepage, label: r.homepage.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") }]
          : [],
        tags: ["github-stars"],
        savedAt: Date.parse(starred_at) || Date.now(),
        imported: true,
      }));
      await enqueue(notes);
      total += notes.length;
      await status({ running: true, count: total });
    }
    await status({ running: false, count: total, endedAt: Date.now() });
  } catch (e) {
    await status({ running: false, count: total, error: String(e?.message || e), endedAt: Date.now() });
  } finally {
    githubRunning = false;
  }
}

// ---------------------------------------------------------------------------
// User-picked triggers. One registered content script per watched site.

const triggers = async () => (await chrome.storage.local.get("triggers")).triggers ?? [];
const scriptId = (site) => `trigger_${shortHash(site)}`;

async function ensureTriggerScript(site) {
  const id = scriptId(site);
  const found = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (found.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: [`${site}/*`],
      js: ["shared.js", "content-trigger.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

async function syncTriggerScripts() {
  const all = await triggers();
  const wanted = new Map();
  for (const t of all) if (t?.site) wanted.set(scriptId(t.site), t.site);
  const registered = await chrome.scripting.getRegisteredContentScripts();
  for (const script of registered) {
    if (script.id.startsWith("trigger_") && !wanted.has(script.id))
      await chrome.scripting.unregisterContentScripts({ ids: [script.id] }).catch(() => {});
  }
  for (const site of new Set(wanted.values()))
    await ensureTriggerScript(site).catch(() => {});
}

async function addTrigger({ site, selector, tag, label }) {
  const all = await triggers();
  const duplicate = all.find((t) => t.site === site && t.selector === selector && t.tag === tag);
  if (duplicate) return duplicate;
  const trigger = {
    id: crypto.randomUUID(),
    site,
    selector,
    tag,
    label,
    createdAt: Date.now(),
    lastFiredAt: 0,
    fireCount: 0,
  };
  await chrome.storage.local.set({ triggers: [...all, trigger] });
  return trigger;
}

async function deleteTrigger(id) {
  const all = await triggers();
  const target = all.find((t) => t.id === id);
  const next = all.filter((t) => t.id !== id);
  await chrome.storage.local.set({ triggers: next });
  if (target && !next.some((t) => t.site === target.site))
    await chrome.scripting
      .unregisterContentScripts({ ids: [scriptId(target.site)] })
      .catch(() => {});
}

async function firedTrigger(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const all = await triggers();
  let changed = false;
  for (const t of all) {
    if (!ids.includes(t.id)) continue;
    t.lastFiredAt = Date.now();
    t.fireCount = (t.fireCount || 0) + 1;
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ triggers: all });
}

// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "save" && msg.notes?.length) {
    enqueue(msg.notes.filter((n) => n?.id)).then((sent) => reply({ sent }));
    return true;
  }
  if (msg?.type === "flush") {
    flush().then((sent) => reply({ sent }));
    return true;
  }
  if (msg?.type === "save-page") {
    saveActive().then(reply);
    return true;
  }
  if (msg?.type === "import-reddit") {
    importReddit();
    reply({ started: true });
    return false;
  }
  if (msg?.type === "save-link" && sender.tab) {
    saveTab(sender.tab, { item: "save-link", linkUrl: msg.linkUrl, selectionText: msg.text }).then(reply);
    return true;
  }
  if (msg?.type === "import-github") {
    importGithub();
    reply({ started: true });
    return false;
  }
  if (msg?.type === "add-trigger") {
    const tab = sender.tab;
    let site = "";
    try {
      site = tab?.url ? siteOf(tab.url) : "";
    } catch {}
    const selector = String(msg.selector ?? "").slice(0, 300);
    const tag = String(msg.tag ?? "")
      .replace(/^#+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    const label = String(msg.label ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!tab?.id || !site || !selector || !tag) {
      reply({ ok: false, error: "Pick an element and give it a keyword." });
      return true;
    }
    chrome.permissions.contains({ origins: [`${site}/*`] }).then(async (allowed) => {
      if (!allowed) return reply({ ok: false, error: "Nota needs permission for this site." });
      try {
        const trigger = await addTrigger({ site, selector, tag, label });
        await ensureTriggerScript(site);
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ["shared.js", "content-trigger.js"],
          })
          .catch(() => {});
        reply({ ok: true, id: trigger.id });
      } catch {
        reply({ ok: false, error: "Can't watch this site." });
      }
    });
    return true;
  }
  if (msg?.type === "delete-trigger") {
    deleteTrigger(msg.id).then(() => reply({ ok: true }));
    return true;
  }
  if (msg?.type === "trigger-fired") {
    firedTrigger(msg.ids);
    return false;
  }
  return;
});

chrome.action.setBadgeBackgroundColor({ color: "#ff9f0a" });
chrome.alarms.create("flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(flush);
chrome.alarms.onAlarm.addListener(() => ping());
chrome.runtime.onStartup.addListener(flush);
chrome.runtime.onStartup.addListener(() => ping());
// A running app updates its prompt right away. No app yet: send them to the download.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const online = await ping();
  if (reason === "install" && !online) chrome.tabs.create({ url: APP_PAGE });
});
chrome.runtime.onStartup.addListener(() => syncTriggerScripts().catch(() => {}));

// Chrome never updates content scripts in already-open tabs, so after an
// install/update push the current ones in. Otherwise likes there go nowhere.
chrome.runtime.onInstalled.addListener(async () => {
  contextMenus();
  await syncTriggerScripts().catch(() => {});
  for (const cs of chrome.runtime.getManifest().content_scripts) {
    for (const tab of await chrome.tabs.query({ url: cs.matches })) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js }).catch(() => {});
    }
  }
  // Trigger scripts are registered dynamically, so refresh those tabs too.
  for (const site of new Set((await triggers()).map((t) => t.site))) {
    for (const tab of await chrome.tabs.query({ url: `${site}/*` })) {
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          files: ["shared.js", "content-trigger.js"],
        })
        .catch(() => {});
    }
  }
});
