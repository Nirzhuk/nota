// Upvote a post on Reddit -> save it.
// The vote button lives in shreddit-post's shadow DOM, so walk composedPath().
// Swap out any previous copy's listener (re-injection after an update).
document.removeEventListener("click", window.notaClickReddit, true);
window.notaClickReddit = (e) => {
  if (e.__notaHandled) return;
  const path = e.composedPath();
  const btn = path.find((el) => el instanceof Element && el.hasAttribute("upvote"));
  if (!btn || btn.getAttribute("aria-pressed") === "true") return; // un-upvote
  const post = path.find((el) => el.tagName === "SHREDDIT-POST");
  const note = post && parse(post);
  if (note) notaSave(note, "upvote");
};
document.addEventListener("click", window.notaClickReddit, true);

function parse(post) {
  const a = (k) => post.getAttribute(k) ?? "";
  if (!a("permalink")) return null;

  const isImg = (u) => /^https:\/\/(i|preview|external-preview)\.redd\.it\//.test(u);
  const images = [
    a("content-href"),
    ...[...post.querySelectorAll("img")].map(
      (i) => i.currentSrc || i.src || i.getAttribute("data-lazy-src") || "",
    ),
  ].filter(isImg);

  // Outbound links: the link post target + anchors in the body. Skip reddit itself.
  const links = [a("content-href"), ...[...post.querySelectorAll('[slot="text-body"] a[href]')].map((l) => l.href)]
    .map((u) => URL.parse(u))
    .filter((u) => u && /^https?:$/.test(u.protocol) && !/(^|\.)(reddit\.com|redd\.it)$/.test(u.hostname))
    .map((u) => ({ url: u.href, label: (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "") }));

  return {
    id: `reddit:${a("id") || a("permalink")}`,
    source: "reddit",
    url: new URL(a("permalink"), location.origin).href,
    author: `${a("subreddit-prefixed-name")} · u/${a("author")}`,
    title: a("post-title"),
    text: post.querySelector('[slot="text-body"]')?.innerText.trim() ?? "",
    images: [...new Set(images)].slice(0, 4),
    links: notaLinks(links),
    savedAt: Date.now(),
  };
}
