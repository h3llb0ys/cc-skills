import { useSyncExternalStore } from "react";

const COMPACT_KEY = "mr-cycle.compact";

// One choice for every mounted widget: split panes and other windows switch together.
const compactView = {
  value: readCompact(),
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    compactView.listeners.add(listener);
    window.addEventListener("storage", onStorage);

    return () => {
      compactView.listeners.delete(listener);
      if (compactView.listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
  set(value: boolean) {
    compactView.value = value;
    writeCompact(value);
    compactView.listeners.forEach((listener) => listener());
  },
};

function onStorage(event: StorageEvent) {
  if (event.key !== COMPACT_KEY) return;
  compactView.value = event.newValue === "1";
  compactView.listeners.forEach((listener) => listener());
}

// Storage can be unavailable (privacy settings): the choice then lives until the page reloads.
function readCompact(): boolean {
  try {
    return localStorage.getItem(COMPACT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCompact(compact: boolean) {
  try {
    localStorage.setItem(COMPACT_KEY, compact ? "1" : "0");
  } catch {
    // See readCompact.
  }
}

export function useCompactView(): [boolean, () => void] {
  const compact = useSyncExternalStore(compactView.subscribe, () => compactView.value);

  return [compact, () => compactView.set(!compact)];
}
