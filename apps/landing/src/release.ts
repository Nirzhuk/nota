// Download links, read at build time. A stale build still works: the old installer
// stays on GitHub and the app updates itself, so no client side call is needed.
export const REPO = "https://github.com/Nirzhuk/nota";
export const EXTENSION = "https://chromewebstore.google.com/detail/pgdlcaikjpnmhcipgocnmilnilakafem";
const ALL = `${REPO}/releases/latest`;

export const release = { mac: ALL, win: ALL, all: ALL, version: "" };

try {
  const res = await fetch("https://api.github.com/repos/Nirzhuk/nota/releases/latest");
  if (res.ok) {
    const data = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
    const find = (end: string) => data.assets.find((a) => a.name.endsWith(end))?.browser_download_url ?? ALL;
    release.mac = find(".dmg");
    release.win = find("-setup.exe");
    release.version = data.tag_name;
  }
} catch {
  // ponytail: offline build falls back to the releases page, which always works
}
