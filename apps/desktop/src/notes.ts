import {
  Butterfly,
  GithubLogo,
  InstagramLogo,
  LinkSimple,
  Newspaper,
  RedditLogo,
  XLogo,
  YoutubeLogo,
  type Icon,
} from "@phosphor-icons/react";

// order = sidebar order = View menu ⌘2…⌘9 (see main.rs)
export const SITES = {
  x: { label: "X", icon: XLogo },
  reddit: { label: "Reddit", icon: RedditLogo },
  youtube: { label: "YouTube", icon: YoutubeLogo },
  github: { label: "GitHub", icon: GithubLogo },
  hn: { label: "Hacker News", icon: Newspaper },
  bluesky: { label: "Bluesky", icon: Butterfly },
  instagram: { label: "Instagram", icon: InstagramLogo },
  web: { label: "Web", icon: LinkSimple },
} satisfies Record<string, { label: string; icon: Icon }>;
export type Source = keyof typeof SITES;

export type Link = { url: string; label: string };
export type Note = {
  id: string;
  source: Source;
  url: string;
  author?: string;
  title?: string;
  text?: string;
  images?: string[];
  links?: Link[];
  folder?: string;
  tags?: string[];
  mine?: string; // personal note, written in the app
  savedAt: number;
};

export type View = "all" | "settings" | `src:${Source}` | `folder:${string}` | `tag:${string}`;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// Notes saved before link capture: fall back to URLs found in the text.
export const linksOf = (n: Note): Link[] =>
  n.links ?? (n.text?.match(URL_RE) ?? []).map((url) => ({ url, label: url.replace(/^https?:\/\/(www\.)?/, "") }));


// One shared formatter each: creating an Intl formatter per call is slow across thousands of cards.
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});
export const fullDate = (t: number) => fullFormat.format(t);

export const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return dayFormat.format(t);
};
