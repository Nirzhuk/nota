# nota

Save what you like. Find it again.

| Site | Saves when you… |
|---|---|
| Any page | right-click → Save … to Nota, or press ⌥⇧S |
| X | like, bookmark |
| Reddit | upvote |
| YouTube | like, add to Watch later / any playlist |
| GitHub | star |
| Hacker News | upvote, favorite (stories) |
| Bluesky | like, bookmark |
| Instagram | save |

Keywords from watched elements and import sources become tags. Tags are
collections: click one in the sidebar to filter, or see it on a card.

```
apps/extension   Chrome MV3, no build step: content-<site>.js -> POST to app
apps/desktop     Tauri app: listens on 127.0.0.1:4317, shows a searchable grid
```

## Run

1. `bun install`
2. `bun dev` (starts the Tauri app)
3. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `apps/extension`
4. Like a tweet. It appears in Nota.

App closed? The extension queues saves (badge shows count) and sends them when
Nota is open.

Notes live in `~/Library/Application Support/app.nota.desktop/notes.json`.

## Save anything

- Right-click a page, link, image, or selected text → **Save … to Nota**.
- **⌥⇧S** saves the current page. The toolbar popup also has **Save page**.
- The extension reads the page's own preview info (`og:` title, description,
  image), so no per-site setup is needed.

## Watch an element

1. Open the popup on any page → **Watch element**.
2. Click the button you want watched (a YouTube like, a GitHub star, anything).
3. Name the keyword, e.g. `like`, `star`, `read later`.

From then on, clicking that element saves the page/post with that keyword as a
tag. The first time you watch a site, Chrome asks for permission for that site
only. The popup's **Watching** list shows the tag, the site, and when each
trigger last fired ("3d ago", or **never fired** — useful when a site renames
its buttons).

Watched elements always save, even when automatic capture is turned off in the
popup's settings (gear icon → **What Nota saves**).

## Import

**Reddit** — popup → **Import**. While signed in to reddit.com, the extension
reads the account's own JSON for upvoted and saved posts (Reddit caps each list
at 1000). Images and outbound links come along. Tags: `#reddit-upvoted`,
`#reddit-saved`.

**X** — open `x.com/i/bookmarks`, your Likes tab (`x.com/<you>/likes`), or
`x.com/i/history`, then popup → **Import**. The extension scrolls the list and
saves every post it passes, with images and links. Tags: `#x-bookmarks`,
`#x-likes`. Esc or clicking the progress pill stops it; it also stops when the
list stops growing.

**X archive** — download your data from X and open Nota's header **Import**
button (download icon), then choose `data/like.js`. This gets every like ever,
text and link only (the archive has no images or bookmarks). Tag: `#x-archive`.
It merges with live saves of the same post.

## App

- Sidebar: sources, folders, and tags. Drag a card by its top row into a folder.
  Double-click a folder to rename; right-click to rename/delete.
- `/` or `⌘F` search. Every word must match; tags are searchable.
- ⌘2…⌘9 filter by source; ⌘= / ⌘− resize cards; ⌃⌘S toggles the sidebar.

## Release

Bump `version` in `apps/desktop/src-tauri/tauri.conf.json`, push to `main`.
CI (`.github/workflows/release.yml`) publishes GitHub Release `v<version>` with
a universal macOS `.dmg` and `latest.json`. Installed copies show
**Update to v…** in the sidebar footer. Pushes without a version bump don't release.

One-time setup on GitHub:
- Secrets `TAURI_SIGNING_PRIVATE_KEY` (= `~/.tauri/nota-updater.key`) and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (= `~/.tauri/nota-updater.password`).
- Settings → Actions → General → Workflow permissions → Read and write.

Local signed build: `cd apps/desktop && bun run release`.
