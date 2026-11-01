// Upvote or favorite a story on Hacker News -> save it. Comments are skipped.
document.removeEventListener("click", window.notaClickHN, true);
window.notaClickHN = (e) => {
  if (e.__notaHandled) return;
  const a = e.target.closest?.('a[id^="up_"], a[href^="fave?"]');
  if (!a || a.href.includes("un=t")) return; // un-favorite
  const row = a.id ? a.closest("tr.athing.submission") : document.querySelector("table.fatitem tr.athing.submission");
  if (row) notaSave(parse(row), a.id ? "upvote" : "favorite");
};
document.addEventListener("click", window.notaClickHN, true);

function parse(row) {
  const t = row.querySelector(".titleline > a");
  const external = t && !t.getAttribute("href").startsWith("item?");
  const sub = row.nextElementSibling;
  return {
    id: `hn:${row.id}`,
    source: "hn",
    url: `https://news.ycombinator.com/item?id=${row.id}`,
    title: t?.textContent ?? "",
    author: sub?.querySelector(".hnuser")?.textContent ?? "",
    // Ask/Show HN body, only present on the item page
    text: row.closest("table.fatitem")?.querySelector(".toptext")?.innerText.trim() ?? "",
    images: [],
    links: external ? [{ url: t.href, label: row.querySelector(".sitestr")?.textContent || new URL(t.href).hostname }] : [],
    savedAt: Date.now(),
  };
}
