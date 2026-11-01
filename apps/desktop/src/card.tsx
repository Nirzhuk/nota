import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowSquareOut, Check, Copy, FolderSimple, FolderSimplePlus, LinkSimple, Play, X } from "@phosphor-icons/react";
import { SITES, ago, linksOf, type Note } from "./notes";

type Props = {
  n: Note;
  folders: string[];
  isNew: boolean;
  expanded: boolean;
  selected?: boolean;
  onToggle: (id: string) => void;
  onPlay: (videoId: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, folder: string | null) => void;
  onMine: (id: string, mine: string) => void;
  onDrag: (dragging: boolean) => void;
  onTag: (tag: string) => void;
};

export function Card({ n, folders, isNew, expanded, selected, onToggle, onPlay, onRemove, onMove, onMine, onDrag, onTag }: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
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

  // native macOS menus: same "Move to" list for the folder button and right-click
  const moveItems = () => [
    { text: "No Folder", checked: !n.folder, action: () => onMove(n.id, null) },
    { item: "Separator" as const },
    ...(folders.length
      ? folders.map((f) => ({ text: f, checked: n.folder === f, action: () => onMove(n.id, f) }))
      : [{ text: "Add folders in the sidebar", enabled: false }]),
  ];
  const folderMenu = async () => (await Menu.new({ items: moveItems() })).popup();
  const contextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        { text: "Open Post", action: () => openUrl(n.url) },
        { text: "Move to", items: moveItems() },
        { item: "Separator" },
        { text: "Remove", action: () => onRemove(n.id) },
      ],
    });
    menu.popup();
  };

  return (
    <article
      className={`${isNew ? "new" : ""}${selected ? " selected" : ""}`.trim()}
      onContextMenu={contextMenu}
      aria-label={`${SITES[n.source]?.label ?? "Post"}${n.author ? ` by ${n.author}` : ""}`}
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
      <button className="remove" title="Remove" aria-label="Remove note" onClick={() => onRemove(n.id)}>
        <X size={12} />
      </button>

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
        n.images?.map((src) => (
          <img
            key={src}
            className="media"
            src={src}
            alt="Attached image"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ))
      )}

      {linksOf(n).map((l) => (
        <button key={l.url} className="link" title={l.url} onClick={() => openUrl(l.url)}>
          <LinkSimple size={12} />
          <span>{l.label}</span>
          <ArrowSquareOut size={11} className="out" />
        </button>
      ))}

      {editing ? (
        <textarea
          className="mine"
          autoFocus
          rows={3}
          placeholder="Your note"
          defaultValue={n.mine ?? ""}
          onKeyDown={(e) => {
            e.stopPropagation(); // keep global shortcuts out of the textarea
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v !== (n.mine ?? "")) onMine(n.id, v);
            setEditing(false);
          }}
        />
      ) : n.mine ? (
        <p className="mine" title="Edit note" onClick={() => setEditing(true)}>
          {n.mine}
        </p>
      ) : (
        <button className="more" onClick={() => setEditing(true)}>
          Add note
        </button>
      )}

      <footer className="bar">
        <span className="when" title={new Date(n.savedAt).toLocaleString()}>
          {ago(n.savedAt)}
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
        <span className="tools">
          <button title="Open post" aria-label="Open post in browser" onClick={() => openUrl(n.url)}>
            <ArrowSquareOut size={13} />
          </button>
          <button title="Copy link" aria-label={copied ? "Link copied" : "Copy link"} onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button title="Move to folder" aria-label="Move to folder" aria-haspopup="menu" onClick={folderMenu}>
            <FolderSimplePlus size={13} />
          </button>
        </span>
      </footer>
    </article>
  );
}

// Thumbnail in the card; the player opens big in a <dialog> (Esc / backdrop closes).
// One iframe at a time: a grid of embeds would load dozens of players.
function YouTube({ id, title, onPlay }: { id: string; title?: string; onPlay: (id: string) => void }) {
  return (
    <button className="video poster" title="Play" aria-label={`Play video${title ? `: ${title}` : ""}`} onClick={() => onPlay(id)}>
      <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" />
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
