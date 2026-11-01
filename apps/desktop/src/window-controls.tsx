import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const Glyph = ({ d }: { d: string }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

// Windows has no title bar (tauri.windows.conf.json), so the app draws these itself.
// ponytail: no Windows 11 snap-layout flyout on hover; Win+Arrow and dragging to an edge still snap.
export function WindowControls() {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const sync = () => win.isMaximized().then(setMaximized);
    sync();
    const off = win.onResized(sync);
    return () => {
      off.then((f) => f());
    };
  }, []);
  return (
    <div className="winctl">
      <button tabIndex={-1} aria-label="Minimize" onClick={() => win.minimize()}>
        <Glyph d="M0 5.5h10" />
      </button>
      <button tabIndex={-1} aria-label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        <Glyph d={maximized ? "M.5 2.5h7v7h-7zM2.5 2.5v-2h7v7h-2" : "M.5.5h9v9h-9z"} />
      </button>
      <button tabIndex={-1} className="close" aria-label="Close" onClick={() => win.close()}>
        <Glyph d="M.5.5l9 9M9.5.5l-9 9" />
      </button>
    </div>
  );
}
