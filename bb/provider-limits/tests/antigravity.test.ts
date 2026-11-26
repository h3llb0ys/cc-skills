import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAntigravityUsage } from "../antigravity";

test("reads Gemini account quota and ignores unrelated or unavailable buckets", () => {
  const windows = parseAntigravityUsage(JSON.stringify({
    command: {
      name: "usage",
      data: {
        groups: [
          {
            buckets: [
              { id: "gemini-weekly", remaining_fraction: 0.75, reset_time: "2026-12-03T13:10:36Z" },
              { id: "gemini-5h", remaining_fraction: 0, reset_time: "1970-01-01T00:00:00Z" },
              { id: "gemini-weekly", remaining_amount: 20 },
              { id: "gemini-5h", remaining_fraction: 1, disabled: true },
            ],
          },
          { buckets: [{ id: "3p-weekly", remaining_fraction: 0.5 }] },
        ],
      },
    },
  }));

  assert.deepEqual(windows, [
    { label: "Gemini 7d", usedPercent: 25, resetsAt: "2026-12-03T13:10:36.000Z" },
    { label: "Gemini 5h", usedPercent: 100, resetsAt: null },
  ]);
  assert.throws(() => parseAntigravityUsage('{"result":"model output"}'));
});
