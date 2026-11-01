// Same rule as the app: every word has to match, and tags count.
export const matches = (query: string, hay: string) =>
  query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
