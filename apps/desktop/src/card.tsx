import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowSquareOut, Check, CheckCircle, Circle, Copy, FolderSimple, FolderSimplePlus, LinkSimple, NotePencil, Play, Tag, X } from "@phosphor-icons/react";
import { SITES, ago, fullDate, linksOf, type Note } from "./notes";

type Props = {
  n: Note;
  folders: string[];
  isNew: boolean;
  expanded: boolean;
  selected?: boolean;
  onToggle: (id: string) => void;
  onPlay: (videoId: string) => void;
  onRemove: (id: string) => void;
  onRead: (id: string, read: boolean) => void;
  onMove: (id: string, folder: string | null) => void;
  onMine: (id: string, mine: string) => void;
  onDrag: (dragging: boolean) => void;
  onTag: (tag: string) => void;
  onTags: (id: string, tags: string[]) => void;
};

type PopKind = "note" | "tag";

const onFocus = (cb: () => void) => {
  window.addEventListener("focus", cb);
  return () => window.removeEventListener("focus", cb);
};

// Offline copy first (images.rs). With no copy, fall back to the remote link; if that's dead too, hide the image.
function Picture({ src, className, alt }: { src: string; className?: string; alt: string }) {
  const [remote, setRemote] = useState(false);
  return (
    <img
      className={className}
      src={remote ? src : convertFileSrc(src, "notaimg")}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={(e) => {
        if (remote) e.currentTarget.style.display = "none";
        else setRemote(true);
      }}
    />
  );
}

// memo(Card) rarely re-renders, so the age label refreshes itself when the window regains focus.
function Ago({ t }: { t: number }) {
  return <>{useSyncExternalStore(onFocus, () => ago(t))}</>;
}

// Same shape as the import tags (x-archive): lowercase, dashes, no leading #.
export const cleanTag = (raw: string) => raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();

// native macOS menu: one "Move to" list for the folder button, right-click and the selection bar
export const moveItems = (notes: Note[], folders: string[], onPick: (folder: string | null) => void) => [
  { text: "No Folder", checked: notes.every((n) => !n.folder), action: () => onPick(null) },
  { item: "Separator" as const },
  ...(folders.length
    ? folders.map((f) => ({ text: f, checked: notes.every((n) => n.folder === f), action: () => onPick(f) }))
    : [{ text: "Add folders in the sidebar", enabled: false }]),
];

export const Card = memo(function Card({ n, folders, isNew, expanded, selected, onToggle, onPlay, onRemove, onRead, onMove, onMine, onDrag, onTag, onTags }: Props) {
  const [copied, setCopied] = useState(false);
  const [pop, setPop] = useState<{ kind: PopKind; at: DOMRect } | null>(null); // open popover, anchored to the tools
  const tools = useRef<HTMLSpanElement>(null);
  const Glyph = SITES[n.source]?.icon ?? LinkSimple;
  const textRef = useRef<HTMLParagraphElement>(null);
  const [full, setFull] = useState(0); // real text height in px
  const [preview, setPreview] = useState(Infinity); // 10-line preview height in px
  const long = full > preview;

  // Measure the real text height (not a char count), and again when the card width changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return setFull(0);
    const measure = () => {
      setFull(el.scrollHeight);
      setPreview(parseFloat(getComputedStyle(el).lineHeight) * 10 + 2);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n.text]);
  // Expanding animates max-height to the measured height; collapsing animates back to 10 lines.
  const expand = () => {
    if (window.getSelection()?.isCollapsed !== false) onToggle(n.id); // not while selecting text
  };

  const copy = async () => {
    await navigator.clipboard.writeText(n.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const openPop = (kind: PopKind) => setPop({ kind, at: tools.current!.getBoundingClientRect() });
  // Keep focus on mousedown, so a second click on the same icon closes instead of reopening.
  const popToggle = (kind: PopKind) => ({
    "aria-expanded": pop?.kind === kind,
    onMouseDown: (e: React.MouseEvent) => pop?.kind === kind && e.preventDefault(),
    onClick: () => (pop?.kind === kind ? (document.activeElement as HTMLElement).blur() : openPop(kind)),
  });
  const saveNote = (raw: string) => {
    const mine = raw.trim();
    if (mine !== (n.mine ?? "")) onMine(n.id, mine);
  };
  const addTag = (raw: string) => {
    const tag = cleanTag(raw);
    if (tag && !n.tags?.includes(tag)) onTags(n.id, [...(n.tags ?? []), tag]);
  };

  const items = () => moveItems([n], folders, (f) => onMove(n.id, f));
  const folderMenu = async () => (await Menu.new({ items: items() })).popup();
  const contextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        { text: "Open Post", action: () => openUrl(n.url) },
        { text: "Move to", items: items() },
        { text: n.mine ? "Edit Note…" : "Add Note…", action: () => openPop("note") },
        { text: "Add Tag…", action: () => openPop("tag") },
        ...(n.tags?.length
          ? [{ text: "Remove Tag", items: n.tags.map((t) => ({ text: `#${t}`, action: () => onTags(n.id, n.tags!.filter((x) => x !== t)) })) }]
          : []),
        { text: n.read ? "Mark as Unread" : "Mark as Read", action: () => onRead(n.id, !n.read) },
        { item: "Separator" },
        { text: "Remove", action: () => onRemove(n.id) },
      ],
    });
    menu.popup();
  };

  return (
    <article
      data-id={n.id}
      className={`${isNew ? "new" : ""}${selected ? " selected" : ""}${n.read ? " read" : ""}`.trim()}
      onContextMenu={contextMenu}
      aria-label={`${SITES[n.source]?.label ?? "Post"}${n.author ? ` by ${n.author}` : ""}${n.read ? ", read" : ""}`}
    >
      {/* drag handle: dragging the whole card would block selecting its text */}
      <div
        className="meta"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/nota-id", n.id);
          e.dataTransfer.effectAllowed = "move";
          // Small pill instead of a snapshot of the card: WebKit garbles the
          // column layout when it snapshots an element inside it.
          const ghost = document.getElementById("drag-ghost")!;
          ghost.textContent = n.title || n.text?.split("\n")[0] || n.author || "Note";
          e.dataTransfer.setDragImage(ghost, 12, 12);
          onDrag(true);
        }}
        onDragEnd={() => onDrag(false)}
      >
        <Glyph size={12} />
        <span className="author">{n.author}</span>
      </div>
      <span className="corner">
        <button
          className={n.read ? "read-toggle on" : "read-toggle"}
          title={n.read ? "Mark as unread" : "Mark as read"}
          aria-label={n.read ? "Mark as unread" : "Mark as read"}
          aria-pressed={!!n.read}
          onClick={() => onRead(n.id, !n.read)}
        >
          {n.read ? <CheckCircle size={12} weight="fill" /> : <Circle size={12} />}
        </button>
        <button className="remove" title="Remove" aria-label="Remove note" onClick={() => onRemove(n.id)}>
          <X size={12} />
        </button>
      </span>

      {n.title && <h3>{n.title}</h3>}
      {n.text && (
        <p
          ref={textRef}
          className={long ? (expanded ? "text open" : "text clamp") : "text"}
          style={long && expanded ? { maxHeight: full } : undefined}
          onClick={long && !expanded ? expand : undefined}
        >
          {n.text}
        </p>
      )}
      {long && (
        <button className="more" aria-expanded={expanded} onClick={() => onToggle(n.id)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      {n.source === "youtube" ? (
        <YouTube id={n.id.slice("youtube:".length)} title={n.title} onPlay={onPlay} />
      ) : (
        n.images?.map((src) => <Picture key={src} className="media" src={src} alt="Attached image" />)
      )}

      {linksOf(n).map((l) => (
        <button key={l.url} className="link" title={l.url} onClick={() => openUrl(l.url)}>
          <LinkSimple size={12} />
          <span>{l.label}</span>
          <ArrowSquareOut size={11} className="out" />
        </button>
      ))}

      {n.mine && (
        <p className="mine" title="Edit note" onClick={() => openPop("note")}>
          {n.mine}
        </p>
      )}

      {pop && (
        <FieldPopover
          kind={pop.kind}
          anchor={pop.at}
          value={pop.kind === "note" ? (n.mine ?? "") : ""}
          onDone={(value) => {
            (pop.kind === "note" ? saveNote : addTag)(value);
            setPop(null);
          }}
        />
      )}

      <footer className="bar">
        <span className="chips">
          <span className="when" title={fullDate(n.savedAt)}>
            <Ago t={n.savedAt} />
          </span>
          {n.folder && (
            <span className="chip">
              <FolderSimple size={11} />
              {n.folder}
            </span>
          )}
          {n.tags?.map((t) => (
            <button key={t} className="chip tag" onClick={() => onTag(t)}>
              #{t}
            </button>
          ))}
        </span>
        <span className="tools" ref={tools}>
          <button title="Open post" aria-label="Open post in browser" onClick={() => openUrl(n.url)}>
            <ArrowSquareOut size={13} />
          </button>
          <button title="Copy link" aria-label={copied ? "Link copied" : "Copy link"} onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button title={n.mine ? "Edit note" : "Add note"} aria-label={n.mine ? "Edit note" : "Add note"} {...popToggle("note")}>
            <NotePencil size={13} />
          </button>
          <button title="Add tag" aria-label="Add tag" {...popToggle("tag")}>
            <Tag size={13} />
          </button>
          <button title="Move to folder" aria-label="Move to folder" aria-haspopup="menu" onClick={folderMenu}>
            <FolderSimplePlus size={13} />
          </button>
        </span>
      </footer>
    </article>
  );
});

// In <body> at a fixed spot, so opening it never moves the cards. Clicking away saves.
// Enter saves a tag (a note needs it for new lines). Esc cancels a tag but saves a note, so typing isn't lost.
export function FieldPopover({ kind, anchor, value, onDone }: { kind: PopKind; anchor: DOMRect; value: string; onDone: (value: string) => void }) {
  useEffect(() => {
    const close = (e: WheelEvent) => {
      const field = document.activeElement as HTMLElement;
      if (e.target !== field) field.blur(); // scrolling would leave it floating away from its card
    };
    window.addEventListener("wheel", close, { passive: true });
    return () => window.removeEventListener("wheel", close);
  }, []);
  const fitsBelow = anchor.bottom + (kind === "note" ? 130 : 52) < window.innerHeight;
  const field = {
    className: "pop-field",
    style: {
      right: window.innerWidth - anchor.right,
      ...(fitsBelow ? { top: anchor.bottom + 6 } : { bottom: window.innerHeight - anchor.top + 6 }),
    },
    autoFocus: true,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.setSelectionRange(value.length, value.length),
    onContextMenu: (e: React.MouseEvent) => e.stopPropagation(), // the text menu (Paste…), not the card's
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation(); // keep global shortcuts out of the field
      if (kind === "tag" && e.key === "Escape") e.currentTarget.value = "";
      if (e.key === "Escape" || (kind === "tag" && e.key === "Enter")) e.currentTarget.blur();
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => onDone(e.currentTarget.value),
  };
  return createPortal(
    kind === "note" ? (
      <textarea {...field} rows={4} defaultValue={value} placeholder="Your note" aria-label="Your note" />
    ) : (
      <input {...field} list="all-tags" placeholder="Tag name" aria-label="Tag name" />
    ),
    document.body,
  );
}

// Thumbnail in the card; the player opens big in a <dialog> (Esc / backdrop closes).
// One iframe at a time: a grid of embeds would load dozens of players.
function YouTube({ id, title, onPlay }: { id: string; title?: string; onPlay: (id: string) => void }) {
  return (
    <button className="video poster" title="Play" aria-label={`Play video${title ? `: ${title}` : ""}`} onClick={() => onPlay(id)}>
      <Picture src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" />
      <span className="play">
        <Play size={16} weight="fill" />
      </span>
    </button>
  );
}

export function Player({ id, onClose }: { id: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (id) ref.current?.showModal();
  }, [id]);
  return (
    <dialog
      ref={ref}
      className="player"
      aria-label="Video player"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
    >
      {id && (
        <iframe
          title="YouTube video"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </dialog>
  );
}
