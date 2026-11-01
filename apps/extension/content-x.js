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

// Popup Import: scroll x.com/i/history (bookmarks), /i/history/like, /i/bookmarks,
// or /<user>/likes. Every post gets a tag so it becomes a collection in Nota.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "import" || !notaLive() || window.notaImporting) return;
  const likes =
    /\/likes\/?$/.test(location.pathname) || /\/i\/history\/like\/?$/.test(location.pathname);
  const tag = likes ? "x-likes" : "x-bookmarks";
  chrome.storage.local.set({ xImport: { running: true, count: 0, tag, at: Date.now() } });
  notaImport(
    () =>
      [...document.querySelectorAll('article[data-testid="tweet"]')].map((article) => {
        const note = parse(article);
        return note && { ...note, tags: notaTags(note.tags, tag), imported: true };
      }),
    (count, done) =>
      chrome.storage.local.set({
        xImport: {
          running: !done,
          count,
          tag,
          at: Date.now(),
          endedAt: done ? Date.now() : undefined,
        },
      }),
  );
});

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
