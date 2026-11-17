import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import type { Snapshot } from "../model";
test("coalesces parallel requests, respects cache and strips account details", async () => {
  let calls = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "provider-limits",
    sdk: {
      system: {
        usageLimits: async () => {
          calls++;
          return {
            codex: {
              status: "ok",
              accountEmail: "private@example.test",
              planLabel: "Pro",
              windows: [{ label: "Weekly", usedPercent: 30, resetsAt: null }],
            },
          };
        },
      },
    },
  });
  plugin(bb);
  try {
    const [a, b] = await Promise.all([
      harness.behavior.callRpc("snapshot", null),
      harness.behavior.callRpc("snapshot", null),
    ]);
    assert.deepEqual(a, b);
    assert.equal((a as Snapshot).rows[0].windows[0].usedPercent, 30);
    await harness.behavior.callRpc("snapshot", null);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(a).includes("private@example.test"));
    await harness.behavior.callRpc("save", {
      refreshSeconds: 60,
      onlyAuthenticated: true,
      providers: { codex: { enabled: true, windows: ["Weekly"] } },
    });
    const reloaded = await harness.lifecycle.reload(plugin);
    try {
      assert.equal(
        (
          (await reloaded.harness.behavior.callRpc("options", null)) as {
            refreshSeconds: number;
          }
        ).refreshSeconds,
        60,
      );
    } finally {
      await reloaded.harness.lifecycle.dispose();
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});
test("handles failures without leaking provider errors and validates options", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "provider-limits",
    sdk: {
      system: {
        usageLimits: async () => {
          throw new Error("secret provider transport detail");
        },
      },
    },
  });
  plugin(bb);
  try {
    const result = (await harness.behavior.callRpc(
      "snapshot",
      null,
    )) as Snapshot;
    assert.equal(result.updatedAt, null);
    assert.ok(result.error);
    assert.ok(!result.error.includes("secret"));
    await assert.rejects(() =>
      harness.behavior.callRpc("save", { refreshSeconds: 1 }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("refreshes at reset and recovers from failure before the 30-minute interval", async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  let calls = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "provider-limits",
    sdk: {
      system: {
        usageLimits: async () => {
          calls++;
          if (calls === 2) throw new Error("offline");
          return {
            codex: {
              status: "ok",
              accountEmail: null,
              planLabel: null,
              windows: [
                {
                  label: "Session",
                  usedPercent: calls === 1 ? 90 : 5,
                  resetsAt: new Date(now + 120_000).toISOString(),
                },
              ],
            },
          };
        },
      },
    },
  });
  plugin(bb);
  try {
    await harness.behavior.callRpc("snapshot", null);
    now += 120_000;
    const failed = (await harness.behavior.callRpc(
      "snapshot",
      null,
    )) as Snapshot;
    assert.equal(calls, 2);
    assert.ok(failed.error);
    assert.equal(failed.rows[0].windows[0].usedPercent, 90);
    now += 30_000;
    await harness.behavior.callRpc("snapshot", null);
    assert.equal(calls, 2);
    now += 30_000;
    const recovered = (await harness.behavior.callRpc(
      "snapshot",
      null,
    )) as Snapshot;
    assert.equal(calls, 3);
    assert.equal(recovered.error, null);
    assert.equal(recovered.rows[0].windows[0].usedPercent, 5);
  } finally {
    Date.now = originalNow;
    await harness.lifecycle.dispose();
  }
});

test("aborts provider requests on disposal", async () => {
  let signal: AbortSignal | undefined;
  const { bb, harness } = createFakePluginHost({
    pluginId: "provider-limits",
    sdk: {
      system: {
        usageLimits: async (args) => {
          signal = args?.signal;
          return {};
        },
      },
    },
  });
  plugin(bb);
  await harness.behavior.callRpc("snapshot", null);
  assert.equal(signal?.aborted, false);
  await harness.lifecycle.dispose();
  assert.equal(signal?.aborted, true);
});
