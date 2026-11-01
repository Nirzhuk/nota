// Double-tap Shift saves the link under the pointer: same path as right-click →
// "Save link to Nota". Any other key in between (typing "Hi There") cancels.
// window.* instead of let: background.js re-injects this into open tabs on update.
document.removeEventListener("keydown", window.notaHoverKey, true);
window.notaHoverKey = (e) => {
  if (e.key !== "Shift" || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return (window.notaShiftAt = 0);
  const now = performance.now();
  if (now - (window.notaShiftAt || 0) > 400) return (window.notaShiftAt = now);
  window.notaShiftAt = 0;
  const a = [...document.querySelectorAll("a[href]:hover")].pop(); // innermost hovered link
  if (!a || !chrome.runtime?.id) return;
  chrome.runtime
    .sendMessage({ type: "save-link", linkUrl: a.href, text: a.innerText.trim().slice(0, 200) })
    .catch(() => {});
};
document.addEventListener("keydown", window.notaHoverKey, true);
