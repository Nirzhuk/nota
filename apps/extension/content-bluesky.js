// Like or bookmark a post on Bluesky -> save it.
document.removeEventListener("click", window.notaClickBsky, true);
window.notaClickBsky = (e) => {
  if (e.__notaHandled) return;
  const btn = e.target.closest?.('[data-testid="likeBtn"], [data-testid="postBookmarkBtn"]');
  if (!btn || btn.getAttribute("aria-pressed") === "true") return; // unlike / unsave
  const post = btn.closest('[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]');
  const note = post && parse(post);
  if (note) notaSave(note, btn.dataset.testid === "likeBtn" ? "like" : "bookmark");
};
document.addEventListener("click", window.notaClickBsky, true);

function parse(post) {
  // the focused post in a thread has no link to itself: use the page URL
  const href = post.querySelector('a[href*="/post/"]')?.getAttribute("href") ?? location.pathname;
  const m = href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
  if (!m) return null;
  const textEl = post.querySelector('[data-testid="postText"]');
  return {
    id: `bluesky:${m[1]}/${m[2]}`,
    source: "bluesky",
    url: `https://bsky.app/profile/${m[1]}/post/${m[2]}`,
    author: [...post.querySelectorAll('a[href^="/profile/"]')]
      .map((a) => a.textContent.trim())
      .filter((s) => s && !s.startsWith("·"))
      .slice(0, 2)
      .join(" "),
    text: textEl?.innerText ?? "",
    images: [...post.querySelectorAll('img[src*="/img/feed_thumbnail/"]')]
      .map((i) => i.src.replace("/feed_thumbnail/", "/feed_fullsize/"))
      .slice(0, 4),
    // displayed link text is shortened; href is the real URL
    links: notaLinks(
      [...(textEl?.querySelectorAll('a[href^="http"]') ?? [])].map((a) => ({
        url: a.href,
        label: a.textContent.trim().replace(/^www\./, "").replace(/(…|\.\.\.)$/, ""),
      })),
    ),
    savedAt: Date.now(),
  };
}
