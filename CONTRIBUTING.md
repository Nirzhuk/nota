# Contributing to Nota

Thanks for helping. Bug reports, site fixes and small PRs are all welcome.

## Before you start

- **Found a bug?** Open an issue with the bug template. Say which site, what you
  clicked, and what Nota did.
- **A site changed its buttons and saves stopped working?** That's the most
  common bug. A PR that fixes the selector in `apps/extension/content-<site>.js`
  is the fastest way to get it fixed.
- **Want a new feature or a new site?** Open an issue first so we can agree on
  it before you write code.

## Setup

You need [Bun](https://bun.sh), [Rust](https://rustup.rs) and Chrome.

1. `bun install`
2. `bun dev` starts the desktop app with hot reload. Debug builds run as a
   separate app, Nota Dev, with their own data folder (`app.nota.desktop.dev`),
   port (4318) and assistant entry (`nota-dev`), and no global shortcuts, so
   they can run next to an installed Nota without touching it.
3. In Chrome, open `chrome://extensions`, turn on Developer mode, click
   **Load unpacked** and pick `apps/extension`. Click the reload icon on the
   extension card after you change its files. The extension only talks to port
   4317, so to test it against Nota Dev, quit Nota and run
   `NOTA_ADDR=127.0.0.1:4317 bun dev`.

```
apps/extension   Chrome extension (MV3), plain JS, no build step
  background.js    queue, sync to the app, context menu, imports
  content-<site>.js  watches like/star/upvote buttons on one site
  shared.js        helpers shared by the content scripts and popup
  popup.*          toolbar popup
apps/desktop     Tauri 2 app
  src/             React UI
  src-tauri/src/   Rust: local HTTP server on 127.0.0.1:4317, notes.json store
```

## Checks

Run these before opening a PR. CI runs the same ones.

```
cd apps/desktop
bun run web:build   # typecheck + build
cd src-tauri
cargo test
```

The extension has no test suite. Load it unpacked and try the thing you changed
on the real site.

## Pull requests

- Keep each PR to one change. Small PRs get merged faster.
- Match the style around you. The code favors short, plain solutions over new
  dependencies or abstractions.
- Add a screenshot or short clip for anything you can see.
- Don't bump version numbers. Releases happen when a maintainer bumps them.

## Privacy rules

Nota never sends saved data anywhere except the app on the user's own computer.
PRs that add analytics, remote servers or third-party calls to the app or
extension won't be merged. The landing site uses cookieless OpenPanel analytics.

## License

By contributing, you agree that your work is released under the
[MIT License](LICENSE).
