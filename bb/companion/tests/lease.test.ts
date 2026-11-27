import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { leases } from "../lease";

const wrapper = fileURLToPath(new URL("../codex-hook.py", import.meta.url));

test("only a live claimed Codex session delegates and returns an exact Stop receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "companion-lease-"));
  const local = leases();
  function stop(session: string, turn?: string, event = "stop") {
    const payload = JSON.stringify({ session_id: session, turn_id: turn });
    const result = spawnSync("python3", [wrapper, dir, "python3", "-c",
      "import sys; print(sys.stdin.read(), end='')", "--event", event], { input: payload, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return { output: result.stdout, payload };
  }
  try {
    assert.deepEqual(stop("standalone", "outside").output, stop("standalone", "outside").payload);
    await local.acquire("bb-thread", "bb-session", dir);
    assert.equal(stop("bb-session", "turn-1").output.trim(), "{}");
    assert.equal(await local.accepted("bb-session", dir, "turn-1"), true);
    assert.equal(await local.accepted("bb-session", dir, "turn-2"), false);
    const guard = stop("bb-session", "turn-1", "pre-tool-use");
    assert.equal(guard.output, guard.payload);
    const cue = stop("bb-session", undefined, "user-prompt");
    assert.equal(cue.output, cue.payload);
    const incomplete = stop("bb-session");
    assert.equal(incomplete.output, incomplete.payload);
    await local.release("bb-thread");
    const fallback = stop("bb-session", "turn-2");
    assert.equal(fallback.output, fallback.payload);
    assert.equal(await leases().accepted("bb-session", dir, "turn-1"), true);
    await local.forgetReceipt("bb-session", dir);
    assert.equal(await local.accepted("bb-session", dir, "turn-1"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
