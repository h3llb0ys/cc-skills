export interface FileLink {
  path: string;
  start: number | null;
  end: number | null;
}

export function parseFileLink(href: string): FileLink | null {
  if (!href.startsWith("file:///")) return null;
  try {
    const url = new URL(href);
    if (url.host || url.search) return null;
    const pathname = decodeURIComponent(url.pathname);
    const path = /^\/[A-Za-z]:\//u.test(pathname) ? pathname.slice(1) : pathname;
    if (!path || path.startsWith("//") || path.endsWith("/") || /[\u0000-\u001f]/u.test(path)) return null;
    if (!url.hash) return { path, start: null, end: null };
    const range = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/u.exec(url.hash);
    if (!range) return null;
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    return { path, start, end };
  } catch {
    return null;
  }
}

const previewLines = 15;
const maxLineLength = 500;

export function fileExcerpt(content: string, link: FileLink) {
  if (!content) return [];
  const lines = content.split(/\r\n|\n|\r/u);
  if (lines.at(-1) === "") lines.pop();
  const start = link.start ?? 1;
  if (start > lines.length) return [];
  const end = Math.min(link.end ?? start, lines.length);
  const context = Math.floor((previewLines - Math.min(end - start + 1, previewLines)) / 2);
  const from = Math.max(0, Math.min(start - 1 - context, lines.length - previewLines));
  return lines.slice(from, from + previewLines).map((text, index) => {
    const number = from + index + 1;
    return {
      number,
      text: text.length > maxLineLength ? text.slice(0, maxLineLength) + "…" : text,
      highlighted: link.start !== null && number >= start && number <= end,
    };
  });
}
