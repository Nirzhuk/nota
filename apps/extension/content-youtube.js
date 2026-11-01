// Like a video, or tick a playlist (Watch later or any other) -> save it.
// Works on the watch page and on feed cards ("More actions" -> Save).
// YouTube doesn't update og: tags on in-app navigation, so read the page itself.
var notaYtCard = null; // the feed card whose menu is open, if any

document.removeEventListener("click", window.notaClickYouTube, true);
window.notaClickYouTube = (e) => {
  if (e.__notaHandled) return;
  const t = e.target;
  const sheetItem = t.closest?.("yt-sheet-view-model toggleable-list-item-view-model");
  if (sheetItem) {
    if (sheetItem.querySelector("button[aria-pressed]")?.getAttribute("aria-pressed") === "true") return; // un-ticking
    return save(notaYtCard ?? current(), "playlist");
  }
  // "Save to Watch later" straight from a card's menu
  const menuItem = t.closest?.("tp-yt-iron-dropdown yt-list-item-view-model, ytd-menu-service-item-renderer");
  if (menuItem && notaYtCard && /watch later|ver más tarde/i.test(menuItem.textContent)) return save(notaYtCard, "playlist");

  const card = t.closest?.("yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer");
  if (card) notaYtCard = fromCard(card);
  else if (t.closest?.("ytd-watch-metadata, ytd-reel-video-renderer, yt-player-quick-action-buttons")) notaYtCard = null;

  const like = t.closest?.("like-button-view-model button");
  if (like && like.getAttribute("aria-pressed") === "false") save(card ? notaYtCard : current(), "like");
};
document.addEventListener("click", window.notaClickYouTube, true);

function save(note, action) {
  if (note) notaSave({ ...note, savedAt: Date.now() }, action);
}

function video(id, extra) {
  return {
    id: `youtube:${id}`,
    source: "youtube",
    url: `https://www.youtube.com/watch?v=${id}`,
    images: [`https://i.ytimg.com/vi/${id}/hqdefault.jpg`],
    links: [],
    savedAt: Date.now(),
    ...extra,
  };
}

function current() {
  const id = new URLSearchParams(location.search).get("v") ?? location.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
  if (!id) return null;
  const desc = document.querySelector("ytd-watch-metadata #description-inline-expander");
  // description links go through youtube.com/redirect?q=<real url>
  const links = [...(desc?.querySelectorAll("a[href]") ?? [])]
    .map((a) => URL.parse(a.href))
    .map((u) => (u?.pathname === "/redirect" ? URL.parse(u.searchParams.get("q") ?? "") : u))
    .filter((u) => u && /^https?:$/.test(u.protocol) && !/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname))
    .map((u) => ({ url: u.href, label: (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "") }));
  return video(id, {
    title:
      document.querySelector("ytd-watch-metadata h1")?.textContent.trim() ||
      document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube$/, ""),
    author: document.querySelector("ytd-watch-metadata ytd-channel-name a")?.textContent.trim(),
    // full text only exists once the user expands it; otherwise the first lines
    text: ((desc?.querySelector("#expanded")?.innerText.trim() || desc?.querySelector("#snippet-text")?.innerText) ?? "")
      .trim()
      .slice(0, 1500),
    links: notaLinks(links),
  });
}

function fromCard(card) {
  const a = card.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]');
  const id = a && (new URL(a.href).searchParams.get("v") ?? a.href.match(/\/shorts\/([\w-]+)/)?.[1]);
  if (!id) return null;
  const title = card.querySelector("h3, #video-title")?.textContent.trim();
  const author = [...card.querySelectorAll('[class*="Metadata"] span, ytd-channel-name a')]
    .map((s) => s.textContent.trim())
    .find((s) => s && s !== title);
  return video(id, { title, author });
}
