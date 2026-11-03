import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ArrowCircleUp, FolderSimple, GearSix, FolderSimplePlus, Hash, Plus, Tray } from "@phosphor-icons/react";
import { SITES, type Note, type Source, type View } from "./notes";
import { withMod } from "./platform";

type Props = {
  notes: Note[];
  folders: string[];
  tags: [string, number][]; // [tag, count]: added on cards, watched-element keywords, import collections
  view: View;
  dragging: boolean; // a card is being dragged
  setView: (v: View) => void;
  onAdd: (name: string) => void;
  onRename: (from: string, to: string | null) => void; // null deletes
  onMove: (id: string, folder: string) => void;
};

const NEW = "\0new"; // drop-target id for "New folder"

export function Sidebar({ notes, folders, tags, view, dragging, setView, onAdd, onRename, onMove }: Props) {
  const [editing, setEditing] = useState<string | null>(null); // folder being renamed, "" = new folder
  const [over, setOver] = useState<string | null>(null); // drop target under a dragged card
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    const add = (key: string) => m.set(key, (m.get(key) ?? 0) + 1);
    for (const n of notes) {
      add(`src:${n.source}`);
      if (n.folder) add(`folder:${n.folder}`);
    }
    return m;
  }, [notes]);
  const sources = (Object.keys(SITES) as Source[]).filter((s) => view === `src:${s}` || counts.has(`src:${s}`));

  const folderMenu = async (e: React.MouseEvent, f: string) => {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        { text: "Rename", action: () => setEditing(f) },
        { text: "Delete Folder", action: () => onRename(f, null) },
      ],
    });
    menu.popup();
  };

  // Dropping on "New folder" creates "New Folder" (or "New Folder 2"…), files the card, and starts renaming.
  const dropIn = (target: string, id: string) => {
    let name = target;
    if (target === NEW) {
      name = "New Folder";
      for (let i = 2; folders.includes(name); i++) name = `New Folder ${i}`;
      onAdd(name);
      setEditing(name);
    }
    onMove(id, name);
  };
  const dropProps = (target: string) => ({
    drop: over === target,
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/nota-id")) return;
      e.preventDefault();
      setOver(target);
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      setOver(null);
      dropIn(target, e.dataTransfer.getData("text/nota-id"));
    },
  });

  return (
    <aside aria-label="Sidebar">
      <div className="traffic" data-tauri-drag-region />
      <div className="group">
        <Item icon={<Tray size={14} />} label="All" n={notes.length} on={view === "all"} onClick={() => setView("all")} />
        {sources.map((s) => {
          const Glyph = SITES[s].icon;
          return (
            <Item
              key={s}
              icon={<Glyph size={14} />}
              label={SITES[s].label}
              n={counts.get(`src:${s}`) ?? 0}
              on={view === `src:${s}`}
              onClick={() => setView(`src:${s}`)}
            />
          );
        })}
      </div>

      <div className="section">
        Folders
        <button title="New folder" aria-label="New folder" onClick={() => setEditing("")}>
          <Plus size={12} />
        </button>
      </div>
      {(folders.length > 0 || dragging) && (
        <div className="group">
          {folders.map((f) =>
            editing === f ? (
              <NameInput
                key={f}
                initial={f}
                onDone={(name) => {
                  setEditing(null);
                  if (name && name !== f) onRename(f, name);
                }}
              />
            ) : (
              <Item
                key={f}
                icon={<FolderSimple size={14} />}
                label={f}
                n={counts.get(`folder:${f}`) ?? 0}
                on={view === `folder:${f}`}
                onClick={() => setView(`folder:${f}`)}
                onDoubleClick={() => setEditing(f)}
                onContextMenu={(e) => folderMenu(e, f)}
                {...dropProps(f)}
              />
            ),
          )}
          {dragging && (
            <Item icon={<FolderSimplePlus size={14} />} label="New folder" n={0} on={false} dim {...dropProps(NEW)} />
          )}
        </div>
      )}

      {/* new-folder field sits on its own under the group, not inside it */}
      {editing === "" && (
        <NameInput
          initial=""
          onDone={(name) => {
            setEditing(null);
            if (name) onAdd(name);
          }}
        />
      )}

      {tags.length > 0 && (
        <>
          <div className="section">Tags</div>
          <div className="group">
            {tags.map(([t, count]) => (
              <Item
                key={t}
                icon={<Hash size={14} />}
                label={t}
                n={count}
                on={view === `tag:${t}`}
                onClick={() => setView(`tag:${t}`)}
              />
            ))}
          </div>
        </>
      )}
      <Version>
        {/* icon only; aria-label keeps the name for screen readers */}
        <button
          className={view === "settings" ? "toggle on" : "toggle"}
          title={`Settings  ${withMod(",")}`}
          aria-label="Settings"
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => setView(view === "settings" ? "all" : "settings")}
        >
          <GearSix size={15} />
        </button>
      </Version>
    </aside>
  );
}

// Footer: current version; when a newer signed release exists, a button that installs it and relaunches.
function Version({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getVersion().then(setVersion);
    // ponytail: checks once at launch; poll if people leave Nota open for days
    if (!import.meta.env.DEV) check().then(setUpdate, () => {});
  }, []);
  const install = async () => {
    setBusy(true);
    try {
      await update!.downloadAndInstall();
      await relaunch();
    } catch (e) {
      console.error("nota: update failed", e);
      setBusy(false);
    }
  };
  return (
    <div className="version">
      {update && (
        <button onClick={install} disabled={busy} title={`Update to v${update.version}`}>
          <ArrowCircleUp size={13} />
          {busy ? "Updating…" : `Update to v${update.version}`}
        </button>
      )}
      <div className="version-row">
        <span>v{version}{import.meta.env.DEV && " dev"}</span>
        {children}
      </div>
    </div>
  );
}

type ItemProps = {
  icon: ReactNode;
  label: string;
  n: number;
  on: boolean;
  drop?: boolean;
  dim?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;

function Item({ icon, label, n, on, drop, dim, ...rest }: ItemProps) {
  return (
    <button
      className={`item${on ? " on" : ""}${drop ? " drop" : ""}${dim ? " dim" : ""}`}
      aria-current={on ? "page" : undefined}
      aria-label={n ? `${label}, ${n}` : label}
      {...rest}
    >
      {icon}
      <span className="label">{label}</span>
      <span className="n" aria-hidden="true">{n || ""}</span>
    </button>
  );
}

// Enter/blur commits, Esc cancels.
function NameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  return (
    <input
      className="name"
      autoFocus
      defaultValue={initial}
      placeholder="Folder name"
      aria-label="Folder name"
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = initial;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => onDone(e.currentTarget.value.trim())}
    />
  );
}
