import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./app";
import { MAC } from "./platform";
import "./styles.css";

document.documentElement.classList.toggle("mac", MAC);
invoke<{ hideImages?: boolean }>("get_settings").then((s) => document.documentElement.classList.toggle("no-images", !!s.hideImages));

// No WebKit "Reload / Inspect Element" menu on app chrome. Text fields and selected card
// text keep theirs (Copy, Look Up…); cards and folders show their own native menus.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  const editable = el.closest("input, textarea, [contenteditable]");
  if (!editable && !window.getSelection()?.toString()) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
