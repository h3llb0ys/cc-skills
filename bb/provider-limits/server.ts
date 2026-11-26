import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { antigravityProviderId, readAntigravityUsage } from "./antigravity";
import { optionsSchema, rowSchema, snapshotSchema, type Snapshot } from "./model";
export const rpcContract = defineRpcContract({
  options: { input: z.null(), output: optionsSchema },
  save: { input: optionsSchema, output: z.null() },
  snapshot: { input: z.null(), output: snapshotSchema },
});
export default function plugin(bb: BbPluginApi) {
  let cache: Snapshot = { rows: [], updatedAt: null, error: null };
  let lastAttempt: number | null = null;
  const lifecycle = new AbortController();
  bb.onDispose(() => lifecycle.abort());
  let flight: Promise<Snapshot> | undefined;
  const options = async () =>
    optionsSchema.parse((await bb.storage.kv.get("options")) ?? {});
  async function snapshot(): Promise<Snapshot> {
    if (flight) return flight;
    const config = await options();
    if (flight) return flight;
    const now = Date.now();
    const retryMs =
      cache.error || cache.rows.some((row) => row.status === "error")
        ? Math.min(config.refreshSeconds * 1000, 60_000)
        : config.refreshSeconds * 1000;
    const resetDue = cache.rows.some((row) =>
      row.windows.some((window) => {
        const reset = Date.parse(window.resetsAt ?? "");
        return reset <= now && reset > (lastAttempt ?? 0);
      }),
    );
    if (lastAttempt !== null && now - lastAttempt < retryMs && !resetDue)
      return cache;
    lastAttempt = now;
    flight = (async () => {
      try {
        const signal = AbortSignal.any([
          lifecycle.signal,
          AbortSignal.timeout(25_000),
        ]);
        const usage = await bb.sdk.system.usageLimits({ refresh: true, signal });
        const rows = Object.entries(usage).map(([id, result]) =>
          rowSchema.parse({
            id,
            status: result.status,
            plan: result.status === "ok" ? result.planLabel : null,
            windows: result.status === "ok" ? result.windows : [],
          }),
        );
        if (!Object.hasOwn(usage, antigravityProviderId)) {
          const fallback = await readAntigravityUsage(bb.sdk.providers, signal);
          if (fallback) rows.push(fallback);
        }
        cache = {
          rows: rows.map((row) => {
            if (row.status !== "error") return row;
            const previous = cache.rows.find(({ id }) => id === row.id);
            if (!previous?.windows.length) return row;
            return {
              ...previous,
              status: "error",
              observedAt: previous.observedAt ?? cache.updatedAt,
            };
          }),
          updatedAt: Date.now(),
          error: null,
        };
      } catch {
        cache = {
          ...cache,
          error:
            "Не удалось обновить лимиты. Показаны последние полученные данные.",
        };
      }
      return cache;
    })().finally(() => {
      flight = undefined;
    });
    return flight;
  }
  bb.rpc.register(rpcContract, {
    options,
    save: async (input) => {
      await bb.storage.kv.set("options", input);
      bb.realtime.publish("options-changed", {});
      return null;
    },
    snapshot,
  });
}
