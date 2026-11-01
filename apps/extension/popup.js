const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text ?? "" });

const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

const hostOf = (site) => {
  try {
    return new URL(site).hostname.replace(/^www\./, "");
  } catch {
    return site;
  }
};

async function status() {
  const { queue = {} } = await chrome.storage.local.get("queue");
  const pending = Object.keys(queue).length;
  const online = await fetch("http://127.0.0.1:4317/ping").then((r) => r.ok, () => false);
  $("status").className = `status ${online ? "on" : ""}`;
  $("status").lastChild.textContent = online ? "Connected" : "Nota closed";
  $("foot").hidden = !pending;
  $("pending").textContent = `${pending} waiting to sync`;
  return queue;
}

async function list(queue) {
  const { recent = [] } = await chrome.storage.local.get("recent");
  if (!recent.length) {
    $("list").append(el("li", "empty", "Like, save, or watch something. It shows up here."));
    return;
  }
  recent.slice(0, 8).forEach((n, i) => {
    const li = el("li");
    li.style.setProperty("--i", i);
    const src = el("span", "src");
    src.innerHTML = notaIcon(n.source, 13);
    const body = el("div", "body");
    const top = el("div", "top");
    top.append(el("span", "author", n.author), el("span", "when", queue[n.id] ? "queued" : ago(n.savedAt)));
    body.append(top, el("div", "text", n.title || n.text || n.url));
    li.append(src, body);
    li.onclick = () => chrome.tabs.create({ url: n.url });
    $("list").append(li);
  });
}

function say(text, bad = false) {
  $("note").hidden = !text;
  $("note").textContent = text ?? "";
  $("note").className = bad ? "note bad" : "note";
}

let xIsList = false;
async function tools(tab) {
  const http = /^https?:/.test(tab?.url ?? "");
  $("save").disabled = !http;
  $("watch").disabled = !http;

  let path = "";
  try {
    path = new URL(tab.url).pathname;
  } catch {}
  xIsList =
    /^https:\/\/(x|twitter)\.com\//.test(tab?.url ?? "") &&
    /^\/(?:i\/history(?:\/like)?|i\/bookmarks|[^/]+\/likes)\/?$/.test(path);
  const likes = /\/(?:i\/history\/like|likes)\/?$/.test(path);
  $("x").textContent = xIsList ? "Import" : "Open";
  $("x-sub").textContent = xIsList
    ? `This page → #x-${likes ? "likes" : "bookmarks"}`
    : "Bookmarks, Likes, or History";

  $("x").onclick = async () => {
    if (xIsList) {
      await chrome.tabs.sendMessage(tab.id, { type: "import" }).catch(() => {});
      window.close();
    } else {
      await chrome.tabs.create({ url: "https://x.com/i/bookmarks" });
      window.close();
    }
  };

  $("reddit").onclick = async () => {
    $("reddit").disabled = true;
    await chrome.runtime.sendMessage({ type: "import-reddit" }).catch(() => {});
    imports();
  };

  $("github").onclick = async () => {
    $("github").disabled = true;
    await chrome.runtime.sendMessage({ type: "import-github" }).catch(() => {});
    imports();
  };

  $("save").onclick = async () => {
    if (!http) return;
    await chrome.runtime.sendMessage({ type: "save-page" }).catch(() => {});
    window.close();
  };

  $("watch").onclick = async () => {
    if (!http) return;
    const url = new URL(tab.url);
    const site = `${url.protocol}//${url.hostname}`;
    const origins = [`${site}/*`];
    let granted = false;
    try {
      granted = await chrome.permissions.contains({ origins });
      if (!granted) granted = await chrome.permissions.request({ origins });
    } catch {}
    if (!granted) return say("Nota needs permission for this site to watch it.", true);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["shared.js", "picker.js"],
      });
      window.close();
    } catch {
      say("This page can't be watched.", true);
    }
  };
}

async function imports() {
  const { redditImport: r, xImport: x, githubImport: g } = await chrome.storage.local.get([
    "redditImport",
    "xImport",
    "githubImport",
  ]);
  // a closed tab or terminated service worker leaves `running` set forever
  const live = (s) => !!s?.running && !!s.at && Date.now() - s.at < 10 * 60 * 1000;
  const rLive = live(r);
  const xLive = live(x);
  const lines = [];
  if (rLive) {
    $("reddit").disabled = true;
    $("reddit").textContent = "…";
    lines.push(`Reddit · ${r.count ?? 0} saved…`);
  } else {
    $("reddit").disabled = false;
    $("reddit").textContent = "Import";
    if (r?.running) lines.push("Reddit · import stopped");
    else if (r?.error) lines.push(`Reddit · ${r.error}`);
    else if (r?.count) lines.push(`Reddit · imported ${r.count}`);
  }
  if (xLive) {
    $("x").disabled = true;
    $("x").textContent = "…";
    lines.push(`X · ${x.count ?? 0} saved…`);
  } else {
    $("x").disabled = false;
    $("x").textContent = xIsList ? "Import" : "Open";
    if (x?.running) lines.push("X · import stopped");
    else if (x?.count) lines.push(`X · imported ${x.count}`);
  }
  const gLive = live(g);
  $("github").disabled = gLive;
  $("github").textContent = gLive ? "…" : "Import";
  if (gLive) lines.push(`GitHub · ${g.count ?? 0} saved…`);
  else if (g?.running) lines.push("GitHub · import stopped");
  else if (g?.error) lines.push(`GitHub · ${g.error}`);
  else if (g?.count) lines.push(`GitHub · imported ${g.count}`);
  say(
    lines.join("\n"),
    !!(r?.error || g?.error || (r?.running && !rLive) || (x?.running && !xLive) || (g?.running && !gLive)),
  );
}

async function watching() {
  const { triggers = [] } = await chrome.storage.local.get("triggers");
  $("watching").hidden = !triggers.length;
  const rows = [...triggers].sort(
    (a, b) => (b.lastFiredAt ?? 0) - (a.lastFiredAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );
  $("triggers").replaceChildren(
    ...rows.map((t) => {
      const li = el("li");
      li.title = t.label ? `${t.label} · ${t.selector}` : t.selector;
      const tag = el("span", "tag", `#${t.tag}`);
      const site = el("span", "site", hostOf(t.site));
      const when = el("span", "when", t.lastFiredAt ? `${ago(t.lastFiredAt)} ago` : "never fired");
      if (t.lastFiredAt && Date.now() - t.lastFiredAt > 7 * 86400000) when.classList.add("stale");
      const del = el("button", "del", "×");
      del.title = "Stop watching";
      del.onclick = async () => {
        del.disabled = true;
        await chrome.runtime.sendMessage({ type: "delete-trigger", id: t.id }).catch(() => {});
      };
      li.append(tag, site, when, del);
      return li;
    }),
  );
}

// Settings view: one row per site, one toggle per automatic action.
async function prefs() {
  const { off = [] } = await chrome.storage.local.get("off");
  $("prefs").replaceChildren(
    ...Object.entries(NOTA_SITES).map(([source, [name, actions]]) => {
      const row = el("div", "pref");
      const label = el("span", "site-name");
      label.innerHTML = notaIcon(source, 13);
      label.append(name);
      const chips = el("span", "chips");
      for (const [action, text] of Object.entries(actions)) {
        const key = `${source}.${action}`;
        const chip = el("button", "chip", text);
        chip.setAttribute("aria-pressed", String(!off.includes(key)));
        chip.onclick = async () => {
          const { off = [] } = await chrome.storage.local.get("off");
          const next = off.includes(key) ? off.filter((k) => k !== key) : [...off, key];
          await chrome.storage.local.set({ off: next });
          chip.setAttribute("aria-pressed", String(!next.includes(key)));
        };
        chips.append(chip);
      }
      row.append(label, chips);
      return row;
    }),
  );
}

$("prefs-btn").innerHTML = notaIcon("gear", 14);
$("prefs-btn").onclick = () => {
  const on = document.body.classList.toggle("settings");
  $("settings").hidden = !on;
  $("prefs-btn").classList.toggle("on", on);
  $("prefs-btn").setAttribute("aria-pressed", String(on));
  showImport(false);
  if (on) prefs();
};

// Import lives in a popover behind the header icon; Esc or a click outside closes it.
function showImport(on) {
  $("import-pop").hidden = !on;
  $("import-btn").classList.toggle("on", on);
  $("import-btn").setAttribute("aria-expanded", String(on));
}
$("import-btn").innerHTML = notaIcon("download", 14);
$("import-btn").onclick = (e) => {
  e.stopPropagation();
  showImport($("import-pop").hidden);
};
$("import-pop").onclick = (e) => e.stopPropagation();
document.addEventListener("click", () => showImport(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("import-pop").hidden) {
    e.preventDefault(); // keep the popup itself open
    showImport(false);
    $("import-btn").focus();
  }
});

$("sync").innerHTML = `${notaIcon("sync", 12)} Sync`;
$("sync").onclick = async () => {
  $("sync").classList.add("spin");
  await chrome.runtime.sendMessage({ type: "flush" });
  await status();
  $("sync").classList.remove("spin");
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.triggers) watching();
  if (changes.redditImport || changes.xImport || changes.githubImport) imports();
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tools(tab);
  const queue = await status();
  list(queue);
  imports();
  watching();
})();
