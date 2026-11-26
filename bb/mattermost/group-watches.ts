import type { Watch } from "./contract";

export function groupWatches<T extends Watch>(watches: T[], keyOf: (watch: T) => string = watch => watch.chat) {
  const groups = new Map<string, T[]>();
  for (const watch of watches) {
    const key = keyOf(watch);
    const group = groups.get(key);
    if (group) group.push(watch);
    else groups.set(key, [watch]);
  }
  return groups;
}
