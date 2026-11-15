import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { COMMANDS, runCli } from "./cli";
import { rpcContract } from "./contract";
import { metadataStore } from "./store";

export default async function plugin(bb: BbPluginApi) {
  const store = metadataStore(bb);
  const now = () => new Date().toISOString();

  bb.rpc.register(rpcContract, {
    cycle_get: ({ keys }) => store.readMany(keys),
    cycle_dismiss: async ({ threadId }) => {
      const cycle = await store.read(threadId);
      if (cycle !== null) await store.write(threadId, { ...cycle, dismissed: true, updatedAt: now() });

      return { ok: true as const };
    },
  });

  bb.cli.register({
    name: "mr-cycle",
    summary: "Track the mr-cycle skill's stages in the current thread",
    commands: COMMANDS,
    run: (argv, ctx) => runCli(store, argv, ctx.threadId, now),
  });
}
