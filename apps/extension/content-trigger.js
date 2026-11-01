// User-picked elements: click YouTube's like, GitHub's star, anything.
// Triggers live in chrome.storage; background.js registers this script for
// each site the user watches. Runs beside the built-in content-<site>.js.
var notaTriggers = [];

function notaTriggerSite() {
  return `${location.protocol}//${location.hostname}`;
}

function notaLoadTriggers() {
  const site = notaTriggerSite();
  chrome.storage.local.get("triggers").then(({ triggers = [] }) => {
    notaTriggers = triggers.filter((t) => t?.selector && t.site === site);
  });
}
notaLoadTriggers();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.triggers) notaLoadTriggers();
});

document.removeEventListener("click", window.notaTriggerClick, true);
window.notaTriggerClick = (e) => {
  if (e.__notaHandled || !notaTriggers.length) return;
  const path = e.composedPath?.() ?? [e.target];
  const hits = notaTriggers.filter((t) =>
    path.some((el) => {
      if (!(el instanceof Element)) return false;
      try {
        return el.matches(t.selector);
      } catch {
        return false;
      }
    }),
  );
  if (!hits.length) return;

  // Claim the click before any site script can save it a second time.
  e.__notaHandled = true;
  const note = notaTriggerNote(path, notaTags(...hits.map((t) => t.tag)));
  if (note) notaSave(note);
  try {
    chrome.runtime.sendMessage({ type: "trigger-fired", ids: hits.map((t) => t.id) }).catch(() => {});
  } catch {}
};
document.addEventListener("click", window.notaTriggerClick, true);

// Use the site's own parser when one exists, so a watched element saves the
// same note as a normal like/star/upvote and the app can merge them.
function notaTriggerNote(path, tags) {
  const site = notaSite();
  const container = {
    x: 'article[data-testid="tweet"]',
    reddit: "SHREDDIT-POST",
    hn: "tr.athing.submission",
    bluesky: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
    instagram: "article",
  }[site];
  let el = container && path.find((n) => n instanceof Element && n.matches?.(container));
  // HN favorites live outside the athing row; the item page has one submission.
  if (site === "hn" && !el) el = document.querySelector("table.fatitem tr.athing.submission");
  if (el && typeof parse === "function") {
    try {
      const note = parse(el);
      if (note) return { ...note, tags: notaTags(note.tags, tags), savedAt: Date.now() };
    } catch {}
  }

  // YouTube has no generic parse(); reuse its watch-page / feed-card readers.
  if (site === "youtube") {
    const card = path.find(
      (n) =>
        n instanceof Element &&
        n.matches?.(
          "yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer",
        ),
    );
    try {
      const note =
        card && typeof fromCard === "function"
          ? fromCard(card)
          : typeof current === "function"
            ? current()
            : null;
      if (note) return { ...note, tags: notaTags(note.tags, tags), savedAt: Date.now() };
    } catch {}
  }

  // GitHub's star button label carries owner/repo; match its saveRepo id.
  if (site === "github") {
    const label = path
      .filter((n) => n instanceof Element)
      .map((n) => n.getAttribute?.("aria-label"))
      .find((value) => /^Star \S+\/\S+/.test(value || ""));
    const repo = label?.match(/^Star (\S+\/\S+)/)?.[1];
    if (repo) {
      return {
        id: `github:${repo.toLowerCase()}`,
        source: "github",
        url: `https://github.com/${repo}`,
        author: repo.split("/")[0],
        title: repo,
        images: [`https://opengraph.githubassets.com/1/${repo}`],
        links: [],
        tags: notaTags(tags),
        savedAt: Date.now(),
      };
    }
  }

  return notaPageNote(tags);
}
