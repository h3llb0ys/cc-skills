import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const TTL = 75_000;
const markerPath = (sessionId: string, directory: string) =>
  join(directory, createHash("sha256").update(sessionId).digest("hex") + ".json");

export function leases() {
  const held = new Map<string, string>();
  async function release(threadId: string) {
    const path = held.get(threadId);
    if (!path) return;
    held.delete(threadId);
    await unlink(path).catch(() => {});
  }

  async function acquire(threadId: string, sessionId: string, directory: string) {
    if (!isAbsolute(directory)) return;
    const path = markerPath(sessionId, directory);
    if (held.get(threadId) !== path) await release(threadId);
    const temporary = path + "." + randomUUID();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, JSON.stringify({ pid: process.pid, expiresAt: Date.now() + TTL }), { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
      held.set(threadId, path);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async function accepted(sessionId: string, directory: string, turnId: string) {
    if (!isAbsolute(directory) || !turnId) return false;
    return (await readFile(markerPath(sessionId, directory) + ".ack", "utf8").catch(() => "")) === turnId;
  }
  async function forgetReceipt(sessionId: string, directory: string) {
    if (isAbsolute(directory)) await unlink(markerPath(sessionId, directory) + ".ack").catch(() => {});
  }

  return { held, acquire, release, accepted, forgetReceipt };
}
