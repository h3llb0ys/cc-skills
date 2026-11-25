import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { parseFileLink, type FileLink } from "../file-link";

const listId = "thread-prompt-banner-git-body";
const rowSelector = `#${listId} button[aria-label^="Open "]`;
const previewSelector = "[data-diff-preview]";
const closeDelay = 240;

export type Anchor =
  | { kind: "git"; row: HTMLButtonElement; list: HTMLElement; path: string }
  | {
      kind: "link";
      row: HTMLAnchorElement;
      list: HTMLElement;
      link: FileLink;
      href: string;
      threadId: string;
    };

function element(target: EventTarget | null) {
  return target instanceof Element ? target : null;
}

export function findAnchor(target: EventTarget | null): Anchor | null {
  const source = element(target);
  const row = source?.closest<HTMLButtonElement>(rowSelector);
  const list = row?.closest<HTMLElement>(`#${listId}`);
  const path = row?.getAttribute("aria-label")?.slice("Open ".length);
  if (row && list && path) return { kind: "git", row, list, path };

  const linkRow = source?.closest<HTMLAnchorElement>('a[href^="file:///"]');
  const timelineRow = linkRow?.closest<HTMLElement>("[data-timeline-row-id]");
  const rowId = timelineRow?.getAttribute("data-timeline-row-id");
  const threadId = rowId && !rowId.includes(":child:")
    ? /^(thr_[a-z0-9_]+):/u.exec(rowId)?.[1]
    : undefined;
  const href = linkRow?.getAttribute("href");
  const link = href ? parseFileLink(href) : null;
  return linkRow && timelineRow && threadId && href && link
    ? { kind: "link", row: linkRow, list: timelineRow, link, href, threadId }
    : null;
}

function sameAnchor(first: Anchor | null, second: Anchor) {
  if (!first || first.row !== second.row) return false;
  if (first.kind === "git") return second.kind === "git" && first.path === second.path;
  return second.kind === "link" && first.href === second.href && first.threadId === second.threadId;
}

export function isCurrentAnchor(anchor: Anchor) {
  return anchor.row.isConnected &&
    anchor.list.contains(anchor.row) &&
    sameAnchor(findAnchor(anchor.row), anchor) &&
    !anchor.row.closest("[hidden], [inert], [aria-hidden=true]");
}

function isPreview(target: EventTarget | null) {
  return Boolean(element(target)?.closest(previewSelector));
}

export function previewPosition(
  row: DOMRectReadOnly,
  list: DOMRectReadOnly,
  viewport: { width: number; height: number },
  overlay: boolean,
): CSSProperties | null {
  const margin = 8;
  if (row.width <= 0 || row.height <= 0 ||
      row.bottom <= Math.max(list.top, 0) ||
      row.top >= Math.min(list.bottom, viewport.height)) return null;

  const width = Math.min(720, list.width - 12, viewport.width - 2 * margin);
  if (width <= 0) return null;
  const left = Math.max(margin, Math.min(list.left + 6, viewport.width - margin - width));
  const gap = overlay ? 4 : 7;
  const aboveEdge = (overlay ? row.top : list.top) - gap;
  const belowEdge = (overlay ? row.bottom : list.bottom) + gap;
  const aboveSpace = aboveEdge - margin;
  const belowSpace = viewport.height - margin - belowEdge;
  const above = aboveSpace >= 170 || aboveSpace >= belowSpace;
  const maxHeight = Math.min(320, above ? aboveSpace : belowSpace);
  return maxHeight >= 65 ? {
    left,
    width,
    maxHeight,
    ...(above ? { bottom: viewport.height - aboveEdge } : { top: belowEdge }),
  } : null;
}

export function linkPreviewPosition(
  row: DOMRectReadOnly,
  viewport: { width: number; height: number },
): CSSProperties | null {
  const margin = 8;
  const gap = 4;
  if (row.width <= 0 || row.height <= 0 || row.bottom <= 0 || row.top >= viewport.height ||
      row.right <= 0 || row.left >= viewport.width) return null;
  const width = Math.min(560, viewport.width - 2 * margin);
  if (width <= 0) return null;
  const left = Math.max(margin, Math.min(row.left, viewport.width - margin - width));
  const aboveSpace = row.top - gap - margin;
  const belowSpace = viewport.height - row.bottom - gap - margin;
  const below = belowSpace >= 170 || belowSpace >= aboveSpace;
  const maxHeight = Math.min(320, below ? belowSpace : aboveSpace);
  return maxHeight >= 65 ? {
    left, width, maxHeight,
    ...(below ? { top: row.bottom + gap } : { bottom: viewport.height - row.top + gap }),
  } : null;
}

export function useHoveredFile(gitEnabled: boolean, linksEnabled: boolean, delay: number, threadId: string | null) {
  const [hover, setHover] = useState<{ anchor: Anchor; threadId: string } | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const dismiss = useCallback(() => closeRef.current?.(), []);

  useEffect(() => {
    setHover(null);
    if ((!gitEnabled && !linksEnabled) || !threadId) return;

    const targetAnchor = (target: EventTarget | null) => {
      const anchor = findAnchor(target);
      return anchor && (anchor.kind === "git" ? gitEnabled : linksEnabled) ? anchor : null;
    };

    let opening: number | undefined;
    let closing: number | undefined;
    let active: Anchor | null = null;

    const cancelClose = () => window.clearTimeout(closing);
    const close = () => {
      window.clearTimeout(opening);
      cancelClose();
      active = null;
      setHover(null);
    };
    closeRef.current = close;
    const enter = (event: PointerEvent | FocusEvent) => {
      if ("pointerType" in event && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const anchor = targetAnchor(event.target);
      if (isPreview(event.target) || anchor) cancelClose();
      if (!anchor || sameAnchor(targetAnchor(event.relatedTarget), anchor)) return;
      window.clearTimeout(opening);
      if (sameAnchor(active, anchor)) return;
      close();
      opening = window.setTimeout(() => {
        if (!isCurrentAnchor(anchor)) return;
        active = anchor;
        setHover({ anchor, threadId });
      }, delay);
    };
    const leave = (event: PointerEvent | FocusEvent) => {
      if ("pointerType" in event && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const row = targetAnchor(event.target)?.row;
      const nextRow = targetAnchor(event.relatedTarget)?.row;
      if ((!row && !isPreview(event.target)) ||
          (row && row === nextRow) ||
          (isPreview(event.target) && isPreview(event.relatedTarget))) return;
      window.clearTimeout(opening);
      if (isPreview(event.relatedTarget) || (nextRow && nextRow === active?.row)) return;
      cancelClose();
      closing = window.setTimeout(close, closeDelay);
    };
    const click = (event: MouseEvent) => {
      if (!isPreview(event.target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    document.addEventListener("pointerover", enter, options);
    document.addEventListener("pointerout", leave, options);
    document.addEventListener("focusin", enter, options);
    document.addEventListener("focusout", leave, options);
    document.addEventListener("click", click, options);
    document.addEventListener("keydown", key, options);
    window.addEventListener("blur", close, { signal: controller.signal });
    return () => {
      closeRef.current = null;
      controller.abort();
      window.clearTimeout(opening);
      cancelClose();
    };
  }, [gitEnabled, linksEnabled, delay, threadId]);

  const anchor = hover && hover.threadId === threadId ? hover.anchor : null;
  const enabled = anchor?.kind === "git" ? gitEnabled : linksEnabled;
  return { anchor: enabled ? anchor : null, dismiss };
}

export function usePreviewPosition(anchor: Anchor, overlay: boolean, dismiss: () => void) {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  useEffect(() => {
    const update = () => {
      const row = anchor.row.getBoundingClientRect();
      const scrollArea = anchor.kind === "git" ? anchor.row.closest("ul")?.getBoundingClientRect() : null;
      if (!isCurrentAnchor(anchor) ||
          (scrollArea && (row.bottom <= scrollArea.top || row.top >= scrollArea.bottom))) {
        dismiss();
        return;
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const next = anchor.kind === "git"
        ? previewPosition(row, anchor.list.getBoundingClientRect(), viewport, overlay)
        : linkPreviewPosition(row, viewport);
      if (!next && anchor.kind === "link") {
        dismiss();
        return;
      }
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    update();
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const resize = new ResizeObserver(update);
    resize.observe(anchor.list);
    resize.observe(anchor.row);
    const mutation = new MutationObserver(update);
    // Observe the anchor's ancestors so closing the native card also closes the preview.
    for (let node: HTMLElement | null = anchor.row; node; node = node.parentElement) {
      mutation.observe(node, {
        childList: true,
        attributes: true,
        attributeFilter: ["aria-label", "aria-hidden", "data-timeline-row-id", "hidden", "href", "inert"],
      });
    }
    return () => {
      mutation.disconnect();
      resize.disconnect();
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor, overlay, dismiss]);
  return position;
}
