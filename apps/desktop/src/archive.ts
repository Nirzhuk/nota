// Parse X's "Download your data" archive. data/like.js assigns one or more
// JSON arrays to window.YTD.like.partN; entries look like
// { like: { tweetId, fullText, expandedUrl } }.

export type ArchiveLike = { id: string; url: string; text: string };

export function parseLikeArchive(source: string): ArchiveLike[] {
  const likes: ArchiveLike[] = [];
  const seen = new Set<string>();
  const assignment = /window\.YTD\.like\.part\d+\s*=\s*/g;
  let match: RegExpExecArray | null;

  while ((match = assignment.exec(source))) {
    const start = match.index + match[0].length;
    const end = endOfArray(source, start);
    if (end < 0) continue;
    let entries: unknown;
    try {
      entries = JSON.parse(source.slice(start, end + 1));
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      const like = (entry as { like?: { tweetId?: string; fullText?: string; expandedUrl?: string } })
        ?.like;
      if (!like?.tweetId || seen.has(like.tweetId)) continue;
      seen.add(like.tweetId);
      likes.push({
        id: `x:${like.tweetId}`,
        url: likeUrl(like.tweetId, like.expandedUrl),
        text: like.fullText ?? "",
      });
    }
    assignment.lastIndex = end + 1;
  }

  return likes;
}

function likeUrl(id: string, expanded?: string): string {
  if (expanded && /\/status\/\d+/.test(expanded))
    return expanded
      .replace(/^https?:\/\/(www\.)?(twitter|x)\.com/, "https://x.com")
      .split("?")[0];
  return `https://x.com/i/status/${id}`;
}

// Index of the ] closing the array that starts at `start`, respecting strings.
function endOfArray(source: string, start: number): number {
  if (source[start] !== "[") return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "[") {
      depth++;
    } else if (c === "]" && --depth === 0) {
      return i;
    }
  }

  return -1;
}
