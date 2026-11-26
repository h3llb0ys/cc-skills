import { tmpdir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { experimental_execHostFile } from "@get-bb/plugin-sdk/process";
import { z } from "zod";
import type { Row, UsageWindow } from "./model";

export const antigravityProviderId = "acp-antigravity-cli";

const usageResponse = z.object({
  command: z.object({
    name: z.literal("usage"),
    data: z.object({
      groups: z.array(z.object({ buckets: z.array(z.unknown()) })),
    }),
  }),
});

const bucketLabels = {
  "gemini-weekly": "Gemini 7d",
  "gemini-5h": "Gemini 5h",
};
const geminiBucket = z.object({
  id: z.enum(["gemini-weekly", "gemini-5h"]),
  remaining_fraction: z.number().min(0).max(1),
  reset_time: z.string().nullish(),
  disabled: z.boolean().optional(),
});

export function parseAntigravityUsage(stdout: string): UsageWindow[] {
  const response = usageResponse.parse(JSON.parse(stdout));
  const windows = new Map<string, UsageWindow>();
  for (const bucket of response.command.data.groups.flatMap(({ buckets }) => buckets)) {
    const parsed = geminiBucket.safeParse(bucket);
    if (!parsed.success || parsed.data.disabled) continue;
    const { id, remaining_fraction, reset_time } = parsed.data;
    const reset = Date.parse(reset_time ?? "");
    windows.set(id, {
      label: bucketLabels[id],
      usedPercent: (1 - remaining_fraction) * 100,
      resetsAt: reset > 0 ? new Date(reset).toISOString() : null,
    });
  }
  return [...windows.values()];
}

export async function readAntigravityUsage(
  providers: BbPluginApi["sdk"]["providers"],
  signal: AbortSignal,
): Promise<Row | null> {
  const base = { id: antigravityProviderId, plan: null, windows: [] };
  try {
    const catalog = await providers.list({ signal });
    if (!catalog.some(({ id, available }) => id === antigravityProviderId && available)) {
      return null;
    }
    const { stdout } = await experimental_execHostFile(
      "agy",
      [
        "-p",
        "/usage",
        "--output-format",
        "json",
        "--settings",
        '{"disableSlashCommands":false,"useG1Credits":false}',
      ],
      {
        cwd: tmpdir(),
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        signal,
      },
    );
    const windows = parseAntigravityUsage(stdout);
    return { ...base, status: windows.length ? "ok" : "error", windows };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return { ...base, status: code === "ENOENT" ? "not_installed" : "error" };
  }
}
