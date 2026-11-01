import { createRoot } from "react-dom/client";
import App from "./app";
import "./styles.css";

// No WebKit "Reload / Inspect Element" menu on app chrome. Text fields and selected card
// text keep theirs (Copy, Look Up…); cards and folders show their own native menus.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  const editable = el.closest("input, textarea, [contenteditable]");
  if (!editable && !window.getSelection()?.toString()) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
