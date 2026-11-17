export type Candidate = { key: string; context: string };

export function collectCandidates(text: string, candidates: Map<string, Candidate>) {
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_-])([A-Za-z][A-Za-z0-9_]*-[1-9]\d*)(?![\p{L}\p{N}_-])/gu)) {
    if (match[1].length > 100) continue;
    const key = match[1].toUpperCase();
    if (candidates.has(key) || candidates.size >= 100) continue;
    const start = Math.max(0, match.index! - 60);
    const end = Math.min(text.length, match.index! + match[0].length + 100);
    const context = `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
    candidates.set(key, { key, context });
  }
}
