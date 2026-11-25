import { useSyncExternalStore } from "react";

type Row = { threadId: string; title: Element; key: string };
let rows: Row[] = [];
const listeners = new Set<() => void>();
let observeRows: ((enabled: boolean) => void) | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) observeRows?.(true);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) observeRows?.(false);
  };
}
export function useSidebarRows() { return useSyncExternalStore(subscribe, () => rows); }

export function mountSidebarRows() {
  const anchor = "[data-sidebar-thread-id]";
  const selectors = anchor + ",.bb-thread-title";
  // Pinned and regular rows may show the same thread. Each mounted title owns its popover.
  const titleIds = new WeakMap<Element, number>();
  let nextTitleId = 0;
  function publish(next: Row[]) {
    if (next.length === rows.length && next.every((row, i) =>
      row.threadId === rows[i].threadId && row.title === rows[i].title)) return;
    rows = next;
    listeners.forEach(listener => listener());
  }
  function scan() {
    const next: Row[] = [];
    document.querySelectorAll<HTMLElement>(anchor).forEach(node => {
      const title = node.parentElement?.querySelector(".bb-thread-title")?.parentElement;
      const threadId = node.dataset.sidebarThreadId;
      if (!title || !threadId) return;
      let titleId = titleIds.get(title);
      if (titleId === undefined) {
        titleId = nextTitleId++;
        titleIds.set(title, titleId);
      }
      next.push({ threadId, title, key: threadId + ":" + titleId });
    });
    publish(next);
  }
  const affectsRow = (node: Node) =>
    node instanceof Element && (node.matches(selectors) || node.querySelector(selectors) !== null);
  const observer = new MutationObserver(records => {
    if (records.some(r => r.type === "attributes" ||
      Array.from(r.addedNodes).some(affectsRow) || Array.from(r.removedNodes).some(affectsRow))) scan();
  });
  function observe(enabled: boolean) {
    if (enabled) {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-sidebar-thread-id"] });
      scan();
    } else {
      observer.disconnect();
      publish([]);
    }
  }
  observeRows = observe;
  if (listeners.size) observe(true);
  return () => { observeRows = undefined; observe(false); };
}
