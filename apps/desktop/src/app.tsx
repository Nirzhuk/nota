import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DownloadSimple, FunnelSimple, MagnifyingGlass, Shuffle, X, SidebarSimple, SquaresFour } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Card, Player } from "./card";
import { MAC, withMod } from "./platform";
import { WindowControls } from "./window-controls";
import { Sidebar } from "./sidebar";
import { Settings } from "./settings";
import { Select, type Option } from "./select";
import { NOTHING, SelectionBar, startMarquee } from "./selection";
import { parseLikeArchive } from "./archive";
import { SITES, linksOf, type Note, type NotePatch, type Source, type View } from "./notes";

const SIZE = { min: 160, max: 480, step: 40, initial: 240 };
const clampSize = (n: number) => Math.min(SIZE.max, Math.max(SIZE.min, n));
const readSize = () => {
  try {
    return clampSize(Number(localStorage.getItem("cardSize")) || SIZE.initial);
  } catch {
    return SIZE.initial;
  }
};
const readSidebar = () => {
  try {
    return localStorage.getItem("sidebar") !== "hidden";
  } catch {
    return true;
  }
};
const EXTENSION = "https://chromewebstore.google.com/detail/pgdlcaikjpnmhcipgocnmilnilakafem";
type NoteFilter = "all" | "unread" | "read" | "media" | "links" | "note";
const FILTERS: Option<NoteFilter>[] = [
  { value: "all", label: "All notes" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "media", label: "With media" },
  { value: "links", label: "With links" },
  { value: "note", label: "With my note" },
];
const readFilter = (): NoteFilter => {
  try {
    const saved = localStorage.getItem("filter");
    return FILTERS.find((f) => f.value === saved)?.value ?? "all";
  } catch {
    return "all";
  }
};
const matchesFilter = (n: Note, f: NoteFilter) => {
  switch (f) {
    case "all":
      return true;
    case "unread":
      return !n.read;
    case "read":
      return !!n.read;
    case "media":
      return !!n.images?.length || n.source === "youtube";
    case "links":
      return linksOf(n).length > 0;
    case "note":
      return !!n.mine;
  }
};
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const setFlag = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {}
};

// Search text per note. Note objects are replaced when they change, so entries can't go stale.
const hays = new WeakMap<Note, string>();
const hayOf = (n: Note) => {
  let hay = hays.get(n);
  if (hay === undefined) {
    hay = `${n.author} ${n.title} ${n.text} ${n.url} ${n.folder ?? ""} ${n.mine ?? ""} ${(n.tags ?? []).join(" ")} ${linksOf(n)
      .map((l) => l.label)
      .join(" ")}`.toLowerCase();
    hays.set(n, hay);
  }
  return hay;
};

// Windows has no menu bar, so the View and File shortcuts from main.rs live here.
function ctrlAction(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  if (e.shiftKey && key === "s") return "sidebar";
  if (e.shiftKey && key === "o") return "reveal";
  if (key === "f") return "search";
  if (key === ",") return "settings";
  if (key === "=" || key === "+") return "bigger";
  if (key === "-") return "smaller";
  const digit = Number(e.code.match(/^Digit([1-9])$/)?.[1]);
  if (digit === 1) return "filter:all";
  return digit ? `filter:${Object.keys(SITES)[digit - 2]}` : undefined;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q); // typing stays instant; the grid catches up
  const [removed, setRemoved] = useState<Note[] | null>(null);
  const undoTimer = useRef(0);
  const [view, setView] = useState<View>("all");
  const [filter, setFilter] = useState<NoteFilter>(readFilter);
  const [size, setSize] = useState(readSize);
  const [playing, setPlaying] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(readSidebar);
  const [hasSaved, setHasSaved] = useState(() => readFlag("hasSaved")); // first note ever retires the install prompt
  const [extensionSeen, setExtensionSeen] = useState(() => readFlag("extensionSeen"));
  const [dragging, setDragging] = useState(false);
  const [dropping, setDropping] = useState(false); // external link/image dragged over the window
  const [picks, setPicks] = useState<string[] | null>(null); // Rediscover: ids of random old saves
  const search = useRef<HTMLInputElement>(null);
  const archive = useRef<HTMLInputElement>(null);
  const busyTimer = useRef<number | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null); // j/k cursor; a multi-selection replaces it
  const [marked, setMarked] = useState<ReadonlySet<string>>(NOTHING); // multi-selection
  const nav = useRef<{ ids: string[]; sel: string | null; notes: Note[]; chosen: Note[]; remove: (id: string) => void; removeNotes: (gone: Note[]) => void }>({
    ids: [],
    sel: null,
    notes: [],
    chosen: [],
    remove: () => {},
    removeNotes: () => {},
  });
  const seen = useRef<Set<string> | null>(null); // ids present at first load: no entry animation

  useEffect(() => {
    const load = () =>
      invoke<Note[]>("list_notes").then((ns) => {
        seen.current ??= new Set(ns.map((n) => n.id));
        if (ns.length) {
          setHasSaved(true);
          setFlag("hasSaved");
        }
        // keep unchanged objects so memo(Card) skips them
        setNotes((old) => {
          const prev = new Map(old.map((n) => [n.id, n]));
          return ns.map((n) => {
            const p = prev.get(n.id);
            return p && JSON.stringify(p) === JSON.stringify(n) ? p : n;
          });
        });
      });
    load();
    invoke<string[]>("list_folders").then(setFolders);
    // An assistant organizing saves can add a folder too.
    const offNotes = listen("notes-changed", () => {
      load();
      invoke<string[]>("list_folders").then(setFolders);
    });
    const offToast = listen<string>("toast", ({ payload }) => finishImport(payload));
    // ponytail: the extension pings every minute, so an event missed during startup just arrives on the next one
    const offExtension = listen("extension-seen", () => {
      setExtensionSeen(true);
      setFlag("extensionSeen");
    });
    const run = (payload: string) => {
      if (payload === "search") {
        setView((v) => (v === "settings" ? "all" : v)); // search lives in the grid header
        requestAnimationFrame(() => {
          search.current?.focus();
          search.current?.select();
        });
      } else if (payload === "settings") setView("settings");
      else if (payload === "bigger") setSize((n) => clampSize(n + SIZE.step));
      else if (payload === "smaller") setSize((n) => clampSize(n - SIZE.step));
      else if (payload === "sidebar") setSidebar((s) => !s);
      else if (payload === "filter:all") setView("all");
      else if (payload.startsWith("filter:")) setView(`src:${payload.slice(7) as Source}`);
      else if (payload === "reveal") invoke("reveal_notes");
    };
    const offMenu = listen<string>("menu", ({ payload }) => run(payload));
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable;
      // altKey: AltGr reports as Ctrl+Alt. preventDefault also stops WebView2's find bar, print and reload.
      if (!MAC && !e.altKey) {
        const action = e.ctrlKey ? ctrlAction(e) : undefined;
        if (action) run(action);
        if (action || (e.ctrlKey && "gprus".includes(e.key.toLowerCase())) || e.key === "F3" || e.key === "F5") e.preventDefault();
      }
      if (e.key === "/" && !typing && search.current) {
        e.preventDefault();
        search.current.focus();
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const { ids, sel } = nav.current;
      if (e.key === "j" || e.key === "k") {
        if (!ids.length) return;
        e.preventDefault();
        const i = sel ? ids.indexOf(sel) : -1;
        const next = e.key === "j" ? Math.min(ids.length - 1, i + 1) : i < 0 ? 0 : Math.max(0, i - 1);
        setMarked(NOTHING);
        setSelected(ids[next]);
        document.querySelectorAll("main > article")[next]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Escape") {
        setSelected(null);
        setMarked(NOTHING);
      } else if (e.key === "x" && nav.current.chosen.length) nav.current.removeNotes(nav.current.chosen);
      else if (sel && e.key === "Enter") {
        const url = nav.current.notes.find((n) => n.id === sel)?.url;
        if (url) {
          e.preventDefault();
          openUrl(url);
        }
      } else if (sel && e.key === "x") {
        const i = ids.indexOf(sel);
        nav.current.remove(sel);
        setSelected(ids[i + 1] ?? ids[i - 1] ?? null);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      offNotes.then((f) => f());
      offMenu.then((f) => f());
      offToast.then((f) => f());
      offExtension.then((f) => f());
      window.removeEventListener("keydown", key);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("cardSize", String(size));
      localStorage.setItem("sidebar", sidebar ? "shown" : "hidden");
      localStorage.setItem("filter", filter);
    } catch {}
  }, [size, sidebar, filter]);

  useEffect(() => () => clearTimeout(busyTimer.current), []);

  // Drop a link or web image onto the window to save it (same id as the extension's page save).
  // Needs "dragDropEnabled": false on the window so the webview gets HTML5 drag events.
  useEffect(() => {
    let depth = 0;
    const mine = (e: DragEvent) => {
      const t = Array.from(e.dataTransfer?.types ?? []);
      const el = e.target as HTMLElement | null;
      if (t.includes("text/nota-id") || el?.closest?.("input, textarea")) return false;
      return t.includes("text/uri-list") || t.includes("text/html") || t.includes("text/plain");
    };
    const http = (s: string) => (/^https?:\/\/\S+$/.test(s.trim()) ? s.trim() : "");
    const site = (h: string): Source =>
      /(^|\.)(x|twitter)\.com$/.test(h) ? "x"
      : /(^|\.)reddit\.com$/.test(h) ? "reddit"
      : /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h) ? "youtube"
      : /(^|\.)github\.com$/.test(h) ? "github"
      : h === "news.ycombinator.com" ? "hn"
      : /(^|\.)bsky\.app$/.test(h) ? "bluesky"
      : /(^|\.)instagram\.com$/.test(h) ? "instagram"
      : "web";
    const over = (e: DragEvent) => {
      if (!mine(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const enter = (e: DragEvent) => {
      if (!mine(e)) return;
      depth++;
      setDropping(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const drop = async (e: DragEvent) => {
      depth = 0;
      setDropping(false);
      if (!mine(e) || !e.dataTransfer) return;
      e.preventDefault();
      const dt = e.dataTransfer;
      const list = dt.getData("text/uri-list").split(/\r?\n/).find((l) => l && !l.startsWith("#")) ?? "";
      const doc = new DOMParser().parseFromString(dt.getData("text/html"), "text/html");
      const img = http(doc.querySelector("img")?.getAttribute("src") ?? "");
      const anchor = doc.querySelector("a[href]");
      const link = http(list) || http(dt.getData("text/plain")) || http(anchor?.getAttribute("href") ?? "");
      const target = link || img;
      if (!target) return; // plain text without a URL, or a local file: ignored
      let u: URL;
      try {
        u = new URL(target);
      } catch {
        return;
      }
      u.hash = "";
      const url = u.href;
      const host = u.hostname.replace(/^www\./, "");
      const label = anchor?.textContent?.trim();
      const note: Note = {
        id: `web:${url}`,
        source: site(u.hostname),
        url,
        author: host,
        title: label && label !== url ? label : undefined,
        images: img ? [img] : [],
        links: [],
        tags: ["dropped"],
        savedAt: Date.now(),
      };
      try {
        await invoke("import_notes", { notes: [note] });
        finishImport(`Saved ${host} · #dropped`);
      } catch (error) {
        finishImport(error instanceof Error ? error.message : String(error));
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const rediscover = () => {
    const old = notes.filter((n) => n.savedAt < Date.now() - 30 * 864e5);
    const pool = old.length ? old : notes;
    setPicks([...pool].sort(() => Math.random() - 0.5).slice(0, 5).map((n) => n.id));
  };

  const shown = useMemo(() => {
    if (picks) return notes.filter((n) => picks.includes(n.id));
    // every word must match somewhere: "rust async" finds posts with both
    const words = deferredQ.toLowerCase().split(/\s+/).filter(Boolean);
    const inView = (n: Note) =>
      view === "all" ||
      (view.startsWith("src:") && n.source === view.slice(4)) ||
      (view.startsWith("folder:") && n.folder === view.slice(7)) ||
      (view.startsWith("tag:") && (n.tags ?? []).includes(view.slice(4)));
    return notes
      .filter(inView)
      .filter((n) => matchesFilter(n, filter))
      .filter((n) => words.every((w) => hayOf(n).includes(w)))
      .sort((a, b) => b.savedAt - a.savedAt);
  }, [notes, deferredQ, view, filter, picks]);

  // Actions only ever reach cards on screen: leaving the view drops the selection,
  // and a card that drops out of the view (moved, untagged) leaves it.
  useEffect(() => setMarked(NOTHING), [view, deferredQ, filter, picks]);
  const chosen = useMemo(() => (marked.size ? shown.filter((n) => marked.has(n.id)) : []), [shown, marked]);
  const live = useMemo(() => new Set(shown.map((n) => n.id)), [shown]);
  // A card that left the view (marked read, moved, retagged) can't stay selected for actions.
  useEffect(() => {
    setMarked((m) => {
      if (!m.size) return m;
      const next = new Set([...m].filter((id) => live.has(id)));
      return next.size === m.size ? m : next;
    });
    setSelected((s) => (s && !live.has(s) ? null : s));
  }, [live]);

  // Tags are the ones added on cards, keywords given to watched elements, and import collections.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    // keep the active tag visible even after its last card is removed
    if (view.startsWith("tag:") && !counts.has(view.slice(4))) counts.set(view.slice(4), 0);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes, view]);

  const finishImport = (text: string | null) => {
    setBusy(text);
    clearTimeout(busyTimer.current);
    if (text) busyTimer.current = window.setTimeout(() => setBusy(null), 4000);
  };

  const importArchive = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!file) return;
    clearTimeout(busyTimer.current);
    setBusy("Reading archive…");
    try {
      const likes = parseLikeArchive(await file.text());
      if (!likes.length) throw new Error("No likes found in that file");
      const now = Date.now();
      const imported: Note[] = likes.map((like, i) => ({
        id: like.id,
        source: "x",
        url: like.url,
        author: "X archive",
        text: like.text,
        tags: ["x-archive"],
        imported: true,
        savedAt: now - i,
      }));
      // imported cards are not "new" arrivals; avoid thousands of entry animations
      for (const n of imported) seen.current?.add(n.id);
      for (let i = 0; i < imported.length; i += 400) {
        await invoke("import_notes", { notes: imported.slice(i, i + 400) });
        const done = Math.min(i + 400, imported.length);
        setBusy(`Importing ${done.toLocaleString()} / ${imported.length.toLocaleString()}`);
      }
      finishImport(`Imported ${imported.length.toLocaleString()} likes · #x-archive`);
    } catch (error) {
      finishImport(error instanceof Error ? error.message : String(error));
    }
  };

  const removeNotes = useCallback((gone: Note[]) => {
    const ids = new Set(gone.map((n) => n.id));
    setNotes((ns) => ns.filter((n) => !ids.has(n.id)));
    setMarked(NOTHING);
    invoke("delete_notes", { ids: [...ids] });
    window.clearTimeout(undoTimer.current);
    setRemoved(gone);
    undoTimer.current = window.setTimeout(() => setRemoved(null), 6000);
  }, []);

  const remove = useCallback((id: string) => removeNotes(nav.current.notes.filter((n) => n.id === id)), [removeNotes]);

  const undoRemove = () => {
    if (!removed) return;
    window.clearTimeout(undoTimer.current);
    invoke("import_notes", { notes: removed });
    setRemoved(null);
  };

  nav.current = { ids: shown.map((n) => n.id), sel: selected, notes: shown, chosen, remove, removeNotes };

  const patchNotes = useCallback((patches: Map<string, NotePatch>) => {
    setNotes((ns) =>
      ns.map((n) => {
        const patch = patches.get(n.id);
        if (!patch) return n;
        const next: Note = { ...n };
        for (const key of ["folder", "mine", "tags", "read"] as const) {
          if (patch[key] === null) delete next[key];
          else if (patch[key] !== undefined) (next[key] as unknown) = patch[key];
        }
        return next;
      }),
    );
    invoke("update_notes", { updates: [...patches] });
  }, []);

  // Dragging a selected card takes the whole selection with it.
  const move = useCallback((id: string, folder: string | null) => {
    const group = nav.current.chosen;
    const ids = group.some((n) => n.id === id) ? group.map((n) => n.id) : [id];
    patchNotes(new Map(ids.map((i) => [i, { folder }])));
    if (ids.length > 1) setMarked(NOTHING);
  }, [patchNotes]);

  const setMine = useCallback((id: string, mine: string) => patchNotes(new Map([[id, { mine: mine || null }]])), [patchNotes]);

  const setRead = useCallback((id: string, read: boolean) => patchNotes(new Map([[id, { read: read || null }]])), [patchNotes]);

  const setTags = useCallback((id: string, tags: string[]) => patchNotes(new Map([[id, { tags: tags.length ? tags : null }]])), [patchNotes]);

  const openTag = useCallback((t: string) => setView(`tag:${t}`), []);

  const addFolder = (name: string) => {
    if (folders.includes(name)) return;
    const next = [...folders, name];
    setFolders(next);
    invoke("set_folders", { folders: next });
  };

  const renameFolder = (from: string, to: string | null) => {
    if (to !== null && folders.includes(to)) return;
    setFolders((fs) => (to === null ? fs.filter((f) => f !== from) : fs.map((f) => (f === from ? to : f))));
    setNotes((ns) => ns.map((n) => (n.folder === from ? { ...n, folder: to ?? undefined } : n)));
    if (view === `folder:${from}`) setView(to ? `folder:${to}` : "all");
    invoke("rename_folder", { from, to });
  };

  const toggle = useCallback(
    (id: string) =>
      setOpen((o) => {
        const next = new Set(o);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
    [],
  );

  return (
    <div className={sidebar ? "app" : "app nosidebar"}>
      {!MAC && <WindowControls />}
      {/* stays mounted so it can slide; inert = out of tab order / screen readers when closed */}
      <div className="side" inert={!sidebar}>
        <Sidebar
          notes={notes}
          folders={folders}
          tags={tags}
          view={view}
          dragging={dragging}
          setView={setView}
          onAdd={addFolder}
          onRename={renameFolder}
          onMove={move}
        />
      </div>
      <div className="content">
        <header data-tauri-drag-region>
          <button
            className="toggle"
            title={`Toggle sidebar  ${MAC ? "⌃⌘S" : "Ctrl+Shift+S"}`}
            aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebar}
            onClick={() => setSidebar((s) => !s)}
          >
            <SidebarSimple size={14} />
          </button>
          {view !== "settings" && (<>
          <label className="search">
            <MagnifyingGlass size={12} />
            <input
              ref={search}
              autoFocus
              placeholder="Search"
              aria-label="Search notes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQ("")}
            />
          </label>
          {!picks && (
            <div className="filter">
              <Select
                label="Filter notes"
                value={filter}
                options={FILTERS}
                onChange={setFilter}
                icon={<FunnelSimple size={12} />}
              />
            </div>
          )}
          <label className="size" title={`Card size  ${withMod("=")}  ${withMod("−")}`}>
            <SquaresFour size={12} />
            <input
              type="range"
              aria-label="Card size"
              min={SIZE.min}
              max={SIZE.max}
              step={SIZE.step}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
          <button
            className={picks ? "toggle on" : "toggle"}
            title="Rediscover: random old saves"
            aria-label="Rediscover"
            onClick={rediscover}
            disabled={!notes.length}
          >
            <Shuffle size={13} />
          </button>
          {picks && (
            <button className="exit-redo" onClick={() => setPicks(null)}>
              <X size={11} /> Back to all
            </button>
          )}
          <button
            className="import"
            title="Import X archive (data/like.js)"
            aria-label="Import X archive"
            onClick={() => archive.current?.click()}
            disabled={!!busy}
          >
            <DownloadSimple size={13} />
          </button>
          <input
            ref={archive}
            type="file"
            accept=".js,text/javascript"
            hidden
            onChange={importArchive}
          />
          <span className="count" role="status" aria-label={`${shown.length} notes`}>
            {shown.length}
          </span>
          </>)}
        </header>

        {/* only this scrolls, so the elastic bounce never drags the header */}
        <div
          className="scroll"
          onMouseDown={(e) =>
            startMarquee(e, marked, (ids) => {
              setSelected(null);
              setMarked(ids);
            })
          }
        >
        {view === "settings" ? (
          <Settings />
        ) : !hasSaved ? (
          <div className="empty">
            {extensionSeen ? (
              <p>Extension connected. Like, save, or watch something. It shows up here.</p>
            ) : (
              <>
                <p>Install the Chrome extension, then like, save, or watch something. It shows up here.</p>
                <button onClick={() => openUrl(EXTENSION)}>Get the extension</button>
              </>
            )}
          </div>
        ) : shown.length === 0 ? (
          <p className="empty">
            {notes.length
              ? view.startsWith("folder:") && !q
                ? "Empty. Drag a card by its top row onto this folder."
                : view.startsWith("tag:") && !q
                  ? `Nothing tagged #${view.slice(4)} yet.`
                  : "Nothing matches."
              : "Like, save, or watch something. It shows up here."}
          </p>
        ) : (
          <main
            className={chosen.length ? "marking" : undefined}
            style={{ columnWidth: size }}
            aria-label="Notes"
            // Bubbles after the card's own handler, so this replaces its one-card drag pill.
            onDragStart={(e) => {
              const id = (e.target as HTMLElement).closest("article")?.getAttribute("data-id");
              const ghost = document.getElementById("drag-ghost")!;
              if (chosen.length < 2 || !id || !marked.has(id)) return;
              ghost.textContent = `${chosen.length} notes`;
              e.dataTransfer.setDragImage(ghost, 12, 12);
            }}
            // A selected card's own menu would act on one card, so the bar is the only menu. Elsewhere: back to one card.
            onContextMenuCapture={(e) => {
              if (!marked.size) return;
              const id = (e.target as HTMLElement).closest("article")?.getAttribute("data-id");
              if (!id || !marked.has(id)) return setMarked(NOTHING);
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {shown.map((n) => (
              <Card
                key={n.id}
                n={n}
                folders={folders}
                isNew={!seen.current?.has(n.id)}
                expanded={open.has(n.id)}
                selected={n.id === selected || marked.has(n.id)}
                onToggle={toggle}
                onPlay={setPlaying}
                onRemove={remove}
                onRead={setRead}
                onMove={move}
                onMine={setMine}
                onTag={openTag}
                onTags={setTags}
                onDrag={setDragging}
              />
            ))}
          </main>
        )}
        </div>
        <SelectionBar
          notes={chosen}
          folders={folders}
          onPatch={patchNotes}
          onRemove={removeNotes}
          onClear={() => setMarked(NOTHING)}
        />
      </div>
      <Player id={playing} onClose={() => setPlaying(null)} />
      <div id="drag-ghost" className="ghost" aria-hidden="true" />
      {/* one shared list, so a new tag doesn't re-render every memoized card */}
      <datalist id="all-tags">
        {tags.map(([t]) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {dropping && <div className="drop-overlay">Drop to save</div>}
      {busy && (
        <div className="busy" role="status">
          {busy}
        </div>
      )}
      {removed && (
        <div className="undo-toast" role="status">
          Removed{removed.length > 1 ? ` ${removed.length} notes` : ""} · <button onClick={undoRemove}>Undo</button>
        </div>
      )}
    </div>
  );
}
