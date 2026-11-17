import { test } from "node:test";
import assert from "node:assert/strict";
import {
  optionsSchema,
  remaining,
  visibleRows,
  selectedWindows,
  type Row,
} from "../model";
const row: Row = {
  id: "codex",
  status: "ok",
  plan: null,
  windows: [
    { label: "5 hours", usedPercent: 20, resetsAt: null },
    { label: "Weekly limit", usedPercent: 100, resetsAt: null },
  ],
};
test("remaining decreases, clamps overuse and does not invent reset data", () => {
  assert.equal(remaining(row.windows[0]), 80);
  assert.equal(remaining(row.windows[1]), 0);
  assert.equal(remaining({ ...row.windows[0], usedPercent: 120 }), 0);
  assert.equal(remaining({ ...row.windows[0], usedPercent: -10 }), 100);
  assert.equal(
    remaining({ ...row.windows[0], resetsAt: "2020-01-01T00:00:00Z" }),
    null,
  );
});
test("filters auth and windows independently for each provider", () => {
  const rows = [
    row,
    { ...row, id: "claude-code" },
    { ...row, id: "logged-out", status: "unauthenticated" as const },
  ];
  const opts = optionsSchema.parse({
    providers: {
      codex: { enabled: true, windows: ["Weekly limit"] },
      "claude-code": { enabled: false, windows: null },
    },
  });
  assert.deepEqual(
    visibleRows(rows, opts).map((r) => r.id),
    ["codex"],
  );
  assert.deepEqual(
    selectedWindows(row, opts).map((w) => w.label),
    ["Weekly limit"],
  );
  assert.equal(
    visibleRows(rows, { ...opts, onlyAuthenticated: false }).length,
    2,
  );
  assert.equal(
    visibleRows([row], {
      ...opts,
      providers: { codex: { enabled: true, windows: [] } },
    }).length,
    0,
  );
});
test("rejects dangerous refresh intervals", () => {
  for (const refreshSeconds of [0, 29, 86401, NaN, Infinity])
    assert.equal(optionsSchema.safeParse({ refreshSeconds }).success, false);
});
