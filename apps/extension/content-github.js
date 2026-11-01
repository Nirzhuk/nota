// Star a repo -> save it. The button label carries the repo: "Star owner/repo",
// so this works on repo pages and in lists (explore, trending, search).
document.removeEventListener("click", window.notaClickGitHub, true);
window.notaClickGitHub = (e) => {
  if (e.__notaHandled) return;
  const repo = e.target.closest?.('button[aria-label^="Star "]')?.getAttribute("aria-label").match(/^Star (\S+\/\S+)/)?.[1];
  if (repo) saveRepo(repo);
};
document.addEventListener("click", window.notaClickGitHub, true);

async function saveRepo(repo) {
  const note = {
    id: `github:${repo.toLowerCase()}`,
    source: "github",
    url: `https://github.com/${repo}`,
    author: repo.split("/")[0],
    title: repo,
    images: [`https://opengraph.githubassets.com/1/${repo}`],
    links: [],
    savedAt: Date.now(),
  };
  // public API, 60 req/h unauthenticated: plenty for starring by hand
  const r = await fetch(`https://api.github.com/repos/${repo}`).then((r) => (r.ok ? r.json() : null), () => null);
  if (r) {
    note.text = [r.description, r.topics?.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n\n");
    if (r.homepage) note.links = [{ url: r.homepage, label: r.homepage.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") }];
  }
  notaSave(note, "star");
}
