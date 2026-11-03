import { useRef, useState } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { Check, CheckCircle, Circle, Copy, FolderSimplePlus, Tag, Trash, X } from "@phosphor-icons/react";
import { FieldPopover, cleanTag, moveItems } from "./card";
import { MAC } from "./platform";
import type { Note, NotePatch } from "./notes";

export const NOTHING: ReadonlySet<string> = new Set();

const EDGE = 40; // px from the top/bottom of the grid where dragging starts to scroll
const MAX_SPEED = 18; // px per frame

// Rubber-band selection, like the Finder. Plain drags start from anywhere that isn't text, a control
// or the card's drag handle. With ⌘/Shift they start on text too, add to the selection, and a click toggles.
// ponytail: card positions are read once at mousedown, re-measure if cards can change size mid-drag.
export function startMarquee(e: React.MouseEvent<HTMLElement>, marked: ReadonlySet<string>, setMarked: (ids: ReadonlySet<string>) => void) {
  const box = e.currentTarget;
  const target = e.target as HTMLElement;
  if (e.button !== 0 || (MAC && e.ctrlKey) || !box.querySelector(":scope > main")) return; // ⌃click is right click on a Mac
  const add = e.shiftKey || (MAC ? e.metaKey : e.ctrlKey);
  if (target.closest(add ? "button, input, textarea, iframe" : "button, input, textarea, iframe, h3, p, .meta")) return;
  const area = box.getBoundingClientRect();
  if (e.clientX >= area.left + box.clientWidth) return; // the scrollbar

  e.preventDefault(); // no text selection and no card drag from here
  window.getSelection()?.removeAllRanges();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // saves an open field; frees X and Esc from the search box
  const base = add ? marked : NOTHING;
  if (!add) setMarked(NOTHING);

  const inContent = (x: number, y: number) => ({
    x: Math.max(0, Math.min(box.clientWidth, x - area.left + box.scrollLeft)),
    y: Math.max(0, Math.min(box.scrollHeight, y - area.top + box.scrollTop)),
  });
  const cards = Array.from(box.querySelectorAll<HTMLElement>("main > article"), (el) => {
    const r = el.getBoundingClientRect();
    const { x, y } = inContent(r.left, r.top);
    return { id: el.dataset.id!, left: x, top: y, right: x + r.width, bottom: y + r.height };
  });
  const clicked = target.closest("article")?.getAttribute("data-id");
  const start = inContent(e.clientX, e.clientY);
  let pointer = { x: e.clientX, y: e.clientY };
  let frame: HTMLDivElement | null = null; // the visible rectangle, created once the drag is real
  let current = base;
  let raf = 0;

  const tick = () => {
    const over = pointer.y < area.top + EDGE ? pointer.y - area.top - EDGE : pointer.y > area.bottom - EDGE ? pointer.y - area.bottom + EDGE : 0;
    if (frame && over) box.scrollTop += Math.max(-MAX_SPEED, Math.min(MAX_SPEED, over / 2));
    const now = inContent(pointer.x, pointer.y);
    const [left, right] = [Math.min(start.x, now.x), Math.max(start.x, now.x)];
    const [top, bottom] = [Math.min(start.y, now.y), Math.max(start.y, now.y)];
    if (!frame && right - left < 4 && bottom - top < 4) return void (raf = requestAnimationFrame(tick)); // still a click
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "marquee";
      box.append(frame);
    }
    frame.style.transform = `translate(${left}px, ${top}px)`;
    frame.style.width = `${right - left}px`;
    frame.style.height = `${bottom - top}px`;
    const next = new Set(base);
    for (const c of cards) if (c.left < right && c.right > left && c.top < bottom && c.bottom > top) next.add(c.id);
    if (next.size !== current.size || [...next].some((id) => !current.has(id))) {
      current = next;
      setMarked(next);
    }
    raf = requestAnimationFrame(tick);
  };
  const move = (ev: MouseEvent) => {
    if (!ev.buttons) return up(); // released outside the window
    pointer = { x: ev.clientX, y: ev.clientY };
  };
  const up = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    if (frame) frame.remove();
    else if (add && clicked) {
      const next = new Set(base);
      if (!next.delete(clicked)) next.add(clicked);
      setMarked(next);
    }
    if (!add) return;
    // the click that follows would also expand the card's text or open its note
    const stop = (c: MouseEvent) => c.stopPropagation();
    box.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => box.removeEventListener("click", stop, true));
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  raf = requestAnimationFrame(tick);
}

type Props = {
  notes: Note[]; // the selection, empty = bar closed
  folders: string[];
  onPatch: (patches: Map<string, NotePatch>) => void;
  onRemove: (notes: Note[]) => void;
  onClear: () => void;
};

// Stays mounted so it can slide away. The last selection stays on it during the exit, so the count never flashes 0.
export function SelectionBar({ notes, folders, onPatch, onRemove, onClear }: Props) {
  const open = notes.length > 0;
  const last = useRef(notes);
  if (open) last.current = notes;
  const [copied, setCopied] = useState(false);
  const [tagAt, setTagAt] = useState<DOMRect | null>(null);
  const tagButton = useRef<HTMLButtonElement>(null);
  const patchEach = (patch: (n: Note) => NotePatch) => onPatch(new Map(notes.map((n) => [n.id, patch(n)])));

  const moveMenu = async () => {
    const items = moveItems(notes, folders, (folder) => {
      patchEach(() => ({ folder }));
      onClear();
    });
    (await Menu.new({ items })).popup();
  };
  const tagMenu = async () => {
    const at = tagButton.current!.getBoundingClientRect();
    const used = [...new Set(notes.flatMap((n) => n.tags ?? []))];
    if (!used.length) return setTagAt(at);
    const removeTag = (t: string) =>
      patchEach((n) => {
        const rest = (n.tags ?? []).filter((x) => x !== t);
        return { tags: rest.length ? rest : null };
      });
    const items = [
      { text: "Add Tag…", action: () => setTagAt(at) },
      { text: "Remove Tag", items: used.map((t) => ({ text: `#${t}`, action: () => removeTag(t) })) },
    ];
    (await Menu.new({ items })).popup();
  };
  const addTag = (raw: string) => {
    const tag = cleanTag(raw);
    if (tag) patchEach((n) => ({ tags: [...new Set([...(n.tags ?? []), tag])] }));
  };
  const copyLinks = async () => {
    await navigator.clipboard.writeText(notes.map((n) => n.url).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const unread = notes.some((n) => !n.read);
  const toggleRead = () => patchEach(() => ({ read: unread || null }));

  return (
    <div className={open ? "selbar open" : "selbar"} role="toolbar" aria-label="Selected notes" inert={!open}>
      <span className="count" role="status">{last.current.length} selected</span>
      <button onClick={moveMenu} aria-haspopup="menu">
        <FolderSimplePlus size={13} /> Move
      </button>
      <button ref={tagButton} onClick={tagMenu}>
        <Tag size={13} /> Tag
      </button>
      <button onClick={toggleRead} title={unread ? "Mark as read" : "Mark as unread"}>
        {unread ? <CheckCircle size={13} /> : <Circle size={13} />} {unread ? "Read" : "Unread"}
      </button>
      <button onClick={copyLinks}>
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy links"}
      </button>
      <button className="danger" onClick={() => onRemove(notes)}>
        <Trash size={13} /> Remove
      </button>
      <button title="Clear selection  Esc" aria-label="Clear selection" onClick={onClear}>
        <X size={12} />
      </button>
      {tagAt && (
        <FieldPopover
          kind="tag"
          anchor={tagAt}
          value=""
          onDone={(value) => {
            addTag(value);
            setTagAt(null);
          }}
        />
      )}
    </div>
  );
}
