import type { IconName } from "./icons";

// Sample content for the demos. Everyone here is made up, except the tauri repo,
// which is the one shown in the real screenshots.
export type Source = "x" | "reddit" | "youtube" | "github" | "hn" | "bluesky" | "instagram";
export const SITES: Record<Source, { label: string; icon: IconName }> = {
  x: { label: "X", icon: "x" },
  reddit: { label: "Reddit", icon: "reddit" },
  youtube: { label: "YouTube", icon: "youtube" },
  github: { label: "GitHub", icon: "github" },
  hn: { label: "Hacker News", icon: "newspaper" },
  bluesky: { label: "Bluesky", icon: "butterfly" },
  instagram: { label: "Instagram", icon: "instagram" },
};

export type Note = {
  id: string;
  source: Source;
  author: string;
  title?: string;
  text?: string;
  tile?: "video" | "image";
  tags?: string[];
  when: string;
};

// The seven posts you can like in the hero. Each carries the button its site really has.
export type Post = Note & { verb: string; did: string; tint: string; off: IconName; on: IconName };
export const POSTS: Post[] = [
  { id: "p-x", did: "Liked", tint: "#f91880", source: "x", author: "Marit Olsen @maritbuilds", text: "Spent a week on a custom date picker. Deleted it. The native one was fine.", when: "now", verb: "Like", off: "heart", on: "heartFill" },
  { id: "p-reddit", did: "Upvoted", tint: "#ff4500", source: "reddit", author: "r/Breadit", title: "After 41 failed loaves, the only sourdough schedule that worked for me", when: "now", verb: "Upvote", off: "arrowUp", on: "arrowUpFill" },
  { id: "p-github", did: "Starred", tint: "#e3b341", source: "github", author: "tauri-apps/tauri", text: "Build smaller, faster, and more secure desktop apps", when: "now", verb: "Star", off: "star", on: "starFill" },
  { id: "p-youtube", did: "Liked", tint: "#f2f2f7", source: "youtube", author: "Quiet Interfaces", title: "Why good software feels calm", tile: "video", when: "now", verb: "Like", off: "thumb", on: "thumbFill" },
  { id: "p-hn", did: "Upvoted", tint: "#ff6600", source: "hn", author: "Hacker News", title: "SQLite is faster than you think for reads", when: "now", verb: "Upvote", off: "caretUp", on: "caretUpFill" },
  { id: "p-bluesky", did: "Liked", tint: "#ec4899", source: "bluesky", author: "Tomás Rivera @tomasr", text: "The Lisbon tram map teaches more about hierarchy than most design books.", when: "now", verb: "Like", off: "heart", on: "heartFill" },
  { id: "p-instagram", did: "Saved", tint: "#f2f2f7", source: "instagram", author: "@ceramics.by.noor", text: "Glaze test 14. Finally the blue I wanted.", tile: "image", when: "now", verb: "Save", off: "bookmark", on: "bookmarkFill" },
];

// Already in the hero window when the page loads.
export const SEEDED: Note[] = [
  { id: "s1", source: "x", author: "Dana Whitfield @danaw", text: "Every settings page is a list of arguments your team never finished having.", when: "2h" },
  { id: "s2", source: "reddit", author: "r/AskCulinary", title: "Why does my pasta water matter this much", when: "5h", tags: ["reddit-saved"] },
  { id: "s3", source: "github", author: "ollama/ollama", text: "Get up and running with large language models locally", when: "1d" },
  { id: "s4", source: "youtube", author: "Slow Workshop", title: "Building a shoji screen by hand", tile: "video", when: "3d" },
  { id: "s5", source: "x", author: "Priya Raman @priyatypes", text: "Rust tip: if the borrow checker hates your design, it may have a point.", when: "6d", tags: ["read later"] },
];

// The search wall: enough variety that filtering feels like finding something.
export const WALL: Note[] = [
  ...SEEDED,
  ...POSTS.map((p) => ({ ...p, when: "12m" })),
  { id: "w1", source: "reddit", author: "r/rust", title: "A gentle explanation of lifetimes, with drawings", when: "2w", tags: ["read later"] },
  { id: "w2", source: "hn", author: "Hacker News", title: "How we cut our build times from 9 minutes to 47 seconds", when: "3w" },
  { id: "w3", source: "instagram", author: "@smallkitchenbaking", text: "Sourdough focaccia, no mixer, 18 hour rise. Recipe in caption.", tile: "image", when: "1mo", tags: ["recipes"] },
  { id: "w4", source: "youtube", author: "Type Foundry Diaries", title: "Drawing a typeface in 30 days", tile: "video", when: "1mo" },
  { id: "w5", source: "bluesky", author: "Hana Sato @hanasato", text: "A checklist for design reviews that nobody on my team hates.", when: "2mo", tags: ["read later"] },
  { id: "w6", source: "github", author: "BurntSushi/ripgrep", text: "Recursively search directories for a regex pattern", when: "2mo" },
  { id: "w7", source: "x", author: "Leo Fontaine @leofontaine", text: "Cheapest flight trick nobody tells you: fly on the day the airline moves its planes back.", when: "4mo", tags: ["x-bookmarks"] },
  { id: "w8", source: "reddit", author: "r/Cooking", title: "The one soup recipe I make every single week", when: "5mo", tags: ["recipes"] },
  { id: "w9", source: "hn", author: "Hacker News", title: "Show HN: A tiny Rust library for reading PDFs", when: "7mo" },
  { id: "w10", source: "x", author: "Ana Lima @analima", text: "Good onboarding is mostly deleting steps. Design the shortest path, then delete one more.", when: "9mo", tags: ["x-likes"] },
  { id: "w11", source: "youtube", author: "Ferment Club", title: "Sourdough starter rescue, step by step", tile: "video", when: "1y", tags: ["recipes"] },
];

export const SAVES: { site: Source; verbs: string }[] = [
  { site: "x", verbs: "like, bookmark" },
  { site: "reddit", verbs: "upvote" },
  { site: "youtube", verbs: "like, Watch later, any playlist" },
  { site: "github", verbs: "star" },
  { site: "hn", verbs: "upvote, favorite" },
  { site: "bluesky", verbs: "like, bookmark" },
  { site: "instagram", verbs: "save" },
];
