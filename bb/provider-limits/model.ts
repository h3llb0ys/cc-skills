import { z } from "zod";
export const optionsSchema = z.object({
  refreshSeconds: z.number().int().min(30).max(86400).default(1800),
  iconSize: z.number().int().min(28).max(44).default(36),
  onlyAuthenticated: z.boolean().default(true),
  providers: z
    .record(
      z.string().max(200),
      z.object({
        enabled: z.boolean(),
        windows: z.array(z.string().max(200)).max(50).nullable(),
      }),
    )
    .default({}),
});
export type Options = z.infer<typeof optionsSchema>;
export const windowSchema = z.object({
  label: z.string(),
  usedPercent: z.number().finite(),
  resetsAt: z.string().nullable(),
});
export type UsageWindow = z.infer<typeof windowSchema>;
export const rowSchema = z.object({
  id: z.string(),
  status: z.enum([
    "ok",
    "not_installed",
    "unauthenticated",
    "expired",
    "error",
  ]),
  plan: z.string().nullable(),
  windows: z.array(windowSchema),
});
export type Row = z.infer<typeof rowSchema>;
export const snapshotSchema = z.object({
  rows: z.array(rowSchema),
  updatedAt: z.number().nullable(),
  error: z.string().nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export function remaining(
  window: UsageWindow,
  now = Date.now(),
): number | null {
  if (window.resetsAt && Date.parse(window.resetsAt) <= now) return null;
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}
export function selectedWindows(row: Row, options: Options) {
  const selection = options.providers[row.id]?.windows;
  const windows = row.windows.filter(
    (w) => selection == null || selection.includes(w.label),
  );
  if (row.id === "claude-code") {
    const rank = (label: string) =>
      label === "Weekly limit" ? 0 : label === "Current session" ? 1 : 2;
    windows.sort((a, b) => rank(a.label) - rank(b.label));
  }
  return windows;
}
export function visibleRows(rows: Row[], options: Options) {
  return rows.filter(
    (r) =>
      options.providers[r.id]?.enabled !== false &&
      r.status !== "not_installed" &&
      (!options.onlyAuthenticated || r.status === "ok") &&
      (r.status !== "ok" || selectedWindows(r, options).length > 0),
  );
}
