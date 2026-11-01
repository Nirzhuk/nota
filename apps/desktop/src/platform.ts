export const MAC = navigator.userAgent.includes("Mac");
export const MOD = MAC ? "⌘" : "Ctrl";
export const ALT = MAC ? "⌥" : "Alt";
export const SHIFT = MAC ? "⇧" : "Shift";
export const withMod = (key: string) => (MAC ? `⌘${key}` : `Ctrl+${key}`);
