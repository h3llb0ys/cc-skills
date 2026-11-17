import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { optionsSchema, snapshotSchema, type Snapshot } from "./model";
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
    const retryMs =
      cache.error || cache.rows.some((row) => row.status === "error")
        ? Math.min(config.refreshSeconds * 1000, 60_000)
        : config.refreshSeconds * 1000;
    const resetDue = cache.rows.some((row) =>
      row.windows.some((window) => {
        const reset = Date.parse(window.resetsAt ?? "");
        return reset <= Date.now() && reset > (lastAttempt ?? 0);
      }),
    );
    if (lastAttempt !== null && Date.now() - lastAttempt < retryMs && !resetDue)
      return cache;
    lastAttempt = Date.now();
    flight = (async () => {
      try {
        const usage = await bb.sdk.system.usageLimits({
          refresh: true,
          signal: AbortSignal.any([
            lifecycle.signal,
            AbortSignal.timeout(25000),
          ]),
        });
        cache = {
          rows: Object.entries(usage).map(([id, result]) => ({
            id,
            status: result.status,
            plan: result.status === "ok" ? result.planLabel : null,
            windows:
              result.status === "ok"
                ? result.windows.map((w) => ({
                    label: w.label,
                    usedPercent: w.usedPercent,
                    resetsAt: w.resetsAt,
                  }))
                : [],
          })),
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
