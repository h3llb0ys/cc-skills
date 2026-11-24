import {
  definePluginApp,
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useThreadContextKind as useThreadContextKind,
  useComposer,
  useRpc,
  type ExperimentalThreadContextCardProps,
  type ExperimentalThreadRowMetadataDataInput,
  type ExperimentalThreadRowMetadataProps,
} from "@get-bb/plugin-sdk/app";

import { rpcContract } from "./contract";
import { caption, CycleView, heading, ProgressRing } from "./components/cycle-view";
import { ChecklistIcon, CYCLE_ICON } from "./components/icons";
import { progress, type Cycle } from "./model";

type Cycles = Record<string, Cycle | null>;

function useCycles(keys: readonly string[]): Cycles {
  return useRpcKeyedQuery({ contract: rpcContract, method: "cycle_get", keys }).data ?? {};
}

function useCycle(threadId: string): Cycle | null {
  return useCycles([threadId])[threadId] ?? null;
}

function CardSection({ threadId }: ExperimentalThreadContextCardProps) {
  const cycle = useCycle(threadId);

  return cycle === null ? null : <CycleView cycle={cycle} />;
}

function StackCard({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const cycle = useCycle(threadId);
  const kind = useThreadContextKind();
  // The context card already shows the cycle in wide panes.
  if (kind === "card" || cycle === null || cycle.dismissed) return null;
  const { complete } = progress(cycle);

  return (
    <CollapsibleStackCard
      label="MR cycle"
      title={`${heading(cycle)} · ${caption(cycle)}`}
      icon={CYCLE_ICON}
      isActive={!complete}
      dismiss={{
        label: "Скрыть MR cycle",
        failureMessage: "Не удалось скрыть MR cycle.",
        onDismiss: async () => {
          await rpc.call("cycle_dismiss", { threadId });
        },
      }}
    >
      <div className="px-1 pb-1">
        <CycleView cycle={cycle} />
      </div>
    </CollapsibleStackCard>
  );
}

function ComposerBanner() {
  const { scope } = useComposer();

  return scope.kind === "thread" ? <StackCard threadId={scope.threadId} /> : null;
}

function useRowCycles({ threads }: ExperimentalThreadRowMetadataDataInput): Cycles {
  return useCycles(threads.map((thread) => thread.id));
}

function RowBadge({ thread, data }: ExperimentalThreadRowMetadataProps<Cycles>) {
  const cycle = data[thread.id];
  if (cycle == null || cycle.dismissed) return null;
  const { done, total, complete } = progress(cycle);

  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground"
      title={`${heading(cycle)} · ${caption(cycle)}`}
    >
      <ProgressRing cycle={cycle} />
      {complete ? "✓" : `${done}/${total}`}
    </span>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: CYCLE_ICON, component: ChecklistIcon });
  app.slots.experimental_threadContextCardSection({
    id: "mr-cycle",
    title: "MR cycle",
    group: "0_mr-cycle",
    component: CardSection,
  });
  app.composer.customize({
    id: "mr-cycle",
    scopes: ["thread"],
    banners: [{ id: "mr-cycle", chrome: "bare", component: ComposerBanner }],
  });
  app.slots.experimental_threadRowMetadata<Cycles>({
    id: "mr-cycle",
    useData: useRowCycles,
    component: RowBadge,
  });
});
