// Save (bookmark) a post on Instagram -> save it.
// Instagram has no stable ids, only the icon's aria-label. English and Spanish UI.
document.removeEventListener("click", window.notaClickIG, true);
window.notaClickIG = (e) => {
  if (e.__notaHandled) return;
  const svg = e.target.closest?.('[role="button"], button')?.querySelector("svg[aria-label]");
  if (!/^(Save|Guardar)$/.test(svg?.getAttribute("aria-label") ?? "")) return;
  const root = svg.closest("article") ?? document.querySelector("main");
  const note = root && parse(root);
  if (note) notaSave(note, "save");
};
document.addEventListener("click", window.notaClickIG, true);

function parse(root) {
  const href = root.querySelector('a[href*="/p/"], a[href*="/reel/"]')?.getAttribute("href") ?? location.pathname;
  const m = href.match(/\/(p|reel)\/([\w-]+)/);
  if (!m) return null;
  return {
    id: `instagram:${m[2]}`,
    source: "instagram",
    url: `https://www.instagram.com/${m[1]}/${m[2]}/`,
    author: root.querySelector('img[alt$="profile picture"]')?.alt.replace(/'s profile picture$/, "") ?? "",
    // post page: h1. feed: the longest dir=auto span that isn't the header or a link
    text:
      root.querySelector("h1")?.innerText ??
      [...root.querySelectorAll('span[dir="auto"]')]
        .filter((e) => !e.closest("header, a")) // location + handle are links
        .map((e) => e.innerText.replace(/(…|\.\.\.)\s*more$/, "").trim())
        .sort((a, b) => b.length - a.length)[0] ??
      "",
    // ponytail: Instagram image URLs are signed and expire after ~days; store copies in the app if that bites
    images: [
      ...[...root.querySelectorAll("img")].filter((i) => i.width > 150).map((i) => i.currentSrc || i.src),
      ...[...root.querySelectorAll("video[poster]")].map((v) => v.poster),
    ].slice(0, 4),
    links: [],
    savedAt: Date.now(),
  };
}
