import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { ALT, MAC, MOD, SHIFT } from "./platform";
import { Select } from "./select";

// Stored by the Rust side in settings.json; it reads hoverKey + sound itself (hover.rs) and applies theme.
type Prefs = { sound: boolean; hoverKey: "shift" | "option" | "control" | "command" | "off"; theme: "system" | "light" | "dark"; keepImages: boolean; hideImages: boolean };
const DEFAULTS: Prefs = { sound: true, hoverKey: "shift", theme: "system", keepImages: true, hideImages: false };

const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes > 0 && bytes < 1e6 ? "Less than 1 MB" : `${Math.round(bytes / 1e6)} MB`;

// Each combo's keys share one well; `sep` is the plain text between alternative combos.
const SHORTCUTS: { what: string; combos: string[][]; sep?: string }[] = [
  { what: "Bring Nota forward and search (any app)", combos: [[ALT, SHIFT, "Space"]] },
  { what: "Save the link on the clipboard (any app)", combos: [MAC ? [ALT, MOD, "S"] : [ALT, SHIFT, "C"]] },
  { what: "Search", combos: [["/"], [MOD, "F"]], sep: "or" },
  { what: "Select next / previous card", combos: [["J"], ["K"]], sep: "/" },
  { what: "Open the selected card", combos: [[MAC ? "↩" : "Enter"]] },
  { what: "Remove the selected card", combos: [["X"]] },
  { what: "Clear selection", combos: [["Esc"]] },
  { what: "Add a card to the selection", combos: [[MOD, "Click"]] },
  { what: "Filter by source", combos: [[MOD, "1"], [MOD, "9"]], sep: "…" },
  { what: "Bigger / smaller cards", combos: [[MOD, "="], [MOD, "−"]], sep: "/" },
  { what: "Toggle sidebar", combos: [MAC ? ["⌃", "⌘", "S"] : ["Ctrl", "Shift", "S"]] },
  { what: "Settings", combos: [[MOD, ","]] },
];

export function Settings() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [imagesSize, setImagesSize] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  // Owned by the OS (LaunchAgent / registry), not settings.json.
  const [openAtLogin, setOpenAtLogin] = useState(false);
  useEffect(() => {
    invoke<Partial<Prefs>>("get_settings").then((s) => setPrefs({ ...DEFAULTS, ...s }));
    invoke<number>("images_size").then(setImagesSize);
    isEnabled().then(setOpenAtLogin, () => {});
  }, []);
  const toggleOpenAtLogin = async (on: boolean) => {
    try {
      await (on ? enable() : disable());
      setOpenAtLogin(on);
    } catch {}
  };
  const clearImages = async () => {
    if (!confirmClear) return setConfirmClear(true);
    setConfirmClear(false);
    await invoke("clear_images");
    setImagesSize(await invoke<number>("images_size"));
  };
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    invoke("set_settings", { patch: { [key]: value } });
  };

  return (
    <section className="settings" aria-labelledby="settings-title">
      <h2 id="settings-title">Settings</h2>

      {/* Both settings drive hover.rs, which is macOS only. */}
      {MAC && (<>
      <h3>Saving</h3>
      <div className="rows">
        <Row label="Save hovered link" hint="Double-tap this key over a link in any app (Slack, Discord, Notes…). Needs Accessibility access.">
          <Select
            label="Save hovered link"
            value={prefs.hoverKey}
            onChange={(v) => set("hoverKey", v)}
            options={[
              { value: "shift", label: "Shift", hint: "⇧" },
              { value: "option", label: "Option", hint: "⌥" },
              { value: "control", label: "Control", hint: "⌃" },
              { value: "command", label: "Command", hint: "⌘" },
              { value: "off", label: "Off" },
            ]}
          />
        </Row>
        <Row label="Sound on save" hint="A short pencil scribble when a hovered link is saved.">
          <input
            type="checkbox"
            role="switch"
            aria-label="Sound on save"
            checked={prefs.sound}
            onChange={(e) => set("sound", e.target.checked)}
          />
        </Row>
      </div>
      </>)}

      <h3>Startup</h3>
      <div className="rows">
        <Row label="Open at login" hint={`Start Nota automatically when you log in to this ${MAC ? "Mac" : "PC"}.`}>
          <input
            type="checkbox"
            role="switch"
            aria-label="Open at login"
            checked={openAtLogin}
            onChange={(e) => toggleOpenAtLogin(e.target.checked)}
          />
        </Row>
      </div>

      <h3>Appearance</h3>
      <div className="rows">
        <Row label="Theme">
          <Select
            label="Theme"
            value={prefs.theme}
            onChange={(v) => set("theme", v)}
            options={[
              { value: "system", label: "Match system" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>
        <Row label="Hide images" hint="Cards show text only, without pictures or video thumbnails. Nothing is deleted.">
          <input
            type="checkbox"
            role="switch"
            aria-label="Hide images"
            checked={prefs.hideImages}
            onChange={(e) => {
              set("hideImages", e.target.checked);
              document.documentElement.classList.toggle("no-images", e.target.checked);
            }}
          />
        </Row>
      </div>

      <h3>Data</h3>
      <div className="rows">
        <Row label="Notes file" hint={`Your notes live in one notes.json on this ${MAC ? "Mac" : "PC"}.`}>
          <button className="btn" onClick={() => invoke("reveal_notes")}>
            Show in {MAC ? "Finder" : "Explorer"}
          </button>
        </Row>
        <Row
          label="Keep images offline"
          hint={`Saves a copy of each new image on this ${MAC ? "Mac" : "PC"}, so it survives if the post is deleted. Turning this off keeps the copies you already have.`}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="Keep images offline"
            checked={prefs.keepImages}
            onChange={(e) => set("keepImages", e.target.checked)}
          />
        </Row>
        <Row
          label="Offline images"
          hint={confirmClear ? "Images from deleted posts can't be recovered." : `${formatSize(imagesSize)} used.`}
        >
          <button className="btn" disabled={!imagesSize} onClick={clearImages} onBlur={() => setConfirmClear(false)}>
            {confirmClear ? "Clear for good" : "Clear"}
          </button>
        </Row>
      </div>

      <Assistants />

      <h3>Keyboard shortcuts</h3>
      <dl className="rows keys">
        {SHORTCUTS.map(({ what, combos, sep }) => (
          <div key={what} className="row">
            <dt>{what}</dt>
            <dd>
              {combos.map((c, i) => (
                <span key={i} className="pair">
                  {i > 0 && <span className="sep">{sep}</span>}
                  <kbd className="combo">
                    {c.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </kbd>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type AssistantStatus = { found: boolean; connected: boolean; started: boolean; lastUsed: number | null };
const ASSISTANTS = [
  { id: "hermes", name: "Hermes" },
  { id: "claude-code", name: "Claude Code" },
  { id: "claude-desktop", name: "Claude Desktop" },
];

const lastUsed = (t: number) => {
  const minutes = Math.floor((Date.now() - t) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
};

const statusText = (s: AssistantStatus | undefined) => {
  const computer = MAC ? "Mac" : "PC";
  if (!s) return "Checking…";
  if (!s.connected) return s.found ? `Found on this ${computer}.` : `Not found on this ${computer}.`;
  if (s.lastUsed) return `Connected. Last used ${lastUsed(s.lastUsed)}.`;
  return s.started ? "Connected." : "Connected. Restart it to start using Nota.";
};

// Detection and config edits live in mcp.rs. Rechecks on focus: an assistant restarted elsewhere changes its status.
function Assistants() {
  const [data, setData] = useState<{ command: string; assistants: Record<string, AssistantStatus> }>();
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showSetup, setShowSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = () => invoke<NonNullable<typeof data>>("assistants").then(setData);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const change = async (id: string, connected: boolean) => {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      await invoke(connected ? "disconnect_assistant" : "connect_assistant", { id });
    } catch (e) {
      setErrors((old) => ({ ...old, [id]: String(e) }));
    }
    await refresh();
    setBusy(undefined);
  };

  const snippet = `{
  "mcpServers": {
    "nota": {
      "command": ${JSON.stringify(data?.command ?? "")},
      "args": ["--mcp"]
    }
  }
}`;
  const copy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <h3>AI assistants</h3>
      <div className="rows">
        {ASSISTANTS.map(({ id, name }) => {
          const s = data?.assistants[id];
          const dot = s?.connected ? "dot on" : s?.found ? "dot found" : "dot";
          const canAct = s?.connected || s?.found;
          const action = s?.connected ? "Disconnect" : "Connect";
          return (
            <div key={id} className={`row assistant${s && !canAct ? " missing" : ""}`}>
              <span aria-hidden="true" className={dot} />
              <span className="what">
                {name}
                <small>{errors[id] || statusText(s)}</small>
              </span>
              {canAct && (
                <button
                  className="btn"
                  aria-label={`${action} ${name}`}
                  disabled={!!busy}
                  onClick={() => change(id, !!s?.connected)}
                >
                  {busy !== id ? action : s?.connected ? "Disconnecting…" : "Connecting…"}
                </button>
              )}
            </div>
          );
        })}
        <div className="row assistant">
          <span aria-hidden="true" className="dot blank" />
          <span className="what">
            Other assistant
            <small>Set up any assistant that supports MCP by hand.</small>
          </span>
          <button className="btn" aria-expanded={showSetup} onClick={() => setShowSetup(!showSetup)}>
            {showSetup ? "Hide setup" : "Show setup"}
          </button>
        </div>
        {showSetup && (
          <div className="setup">
            <pre>{snippet}</pre>
            <button className="btn" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
      <p className="caption">Connected assistants can search your saves, add tags and move saves to folders, but can't remove anything. What they read goes to their provider.</p>
    </>
  );
}

// A div, not a <label>: a label would re-click the trigger when an option inside it is picked.
// Controls carry their own aria-label instead.
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="what">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </div>
  );
}
