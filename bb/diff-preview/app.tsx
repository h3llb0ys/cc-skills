import {
  definePluginApp,
  experimental_Diff as Diff,
  experimental_useRpcKeyedQuery as useKeyedQuery,
  experimental_useRpcQuery as useQuery,
  useBbContext,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";

import { gitPluginId, gitRpc, patchKey, selectTarget, type GitTarget } from "./git";
import { useHoveredFile, usePreviewPosition, type Anchor } from "./hover";
import { delayOptions, placementOptions } from "./settings";
import "./app.css";

const loading = "Loading diff…";
const unavailable = "Diff unavailable for this file.";
const tooLarge = "This diff is too large to preview. Open it in BB to inspect the changes.";
const maxPreviewChars = 48 * 1024;
const noKeys: readonly string[] = [];

function Notice({ children }: { children: string }) {
  return <div className="bb-diff-preview-notice" role="status">{children}</div>;
}

function FileDiff({ environmentId, target, path, lineNumbers }: {
  environmentId: string;
  target: GitTarget;
  path: string;
  lineNumbers: boolean;
}) {
  const files = useQuery({
    pluginId: gitPluginId,
    contract: gitRpc,
    method: "files",
    input: { environmentId, target, ignoreWhitespace: false },
  });
  const result = files.data?.outcome === "available" ? files.data : null;
  const file = result?.files.find(entry => entry.path === path);
  const initial = result?.initialPatches.find(entry => entry.path === path);
  const key = file && !initial && !file.binary && file.loadMode === "auto"
    ? patchKey(environmentId, target, path, file.revision)
    : null;
  const patches = useKeyedQuery({
    pluginId: gitPluginId,
    contract: gitRpc,
    method: "patches",
    keys: key ? [key] : noKeys,
  });

  if (files.error) return <Notice>{unavailable}</Notice>;
  if (!files.data) return <Notice>{loading}</Notice>;
  if (!file) return <Notice>{unavailable}</Notice>;
  if (file.binary) return <Notice>Binary file.</Notice>;
  if (file.loadMode !== "auto") return <Notice>{tooLarge}</Notice>;

  const fetched = key ? patches.data?.[key] : undefined;
  const patch = initial ?? (fetched?.outcome === "available" ? fetched.patch : undefined);
  if (!patch) return <Notice>{!fetched && patches.isFetching ? loading : unavailable}</Notice>;
  if (patch.path !== path) return <Notice>{unavailable}</Notice>;
  if (patch.truncated || patch.patch.length > maxPreviewChars) return <Notice>{tooLarge}</Notice>;
  if (!patch.patch.trim()) return <Notice>{unavailable}</Notice>;

  return <Diff path={path} patch={patch.patch} view="unified" overflow="scroll" showLineNumbers={lineNumbers} />;
}

function WorkspaceDiff({ environmentId, path, lineNumbers }: {
  environmentId: string;
  path: string;
  lineNumbers: boolean;
}) {
  const status = useKeyedQuery({
    pluginId: gitPluginId,
    contract: gitRpc,
    method: "status",
    keys: [environmentId],
  });
  const result = status.data?.[environmentId];

  if (!result) return <Notice>{status.error ? unavailable : loading}</Notice>;
  const target = result.outcome === "available" ? selectTarget(result.workspace) : null;
  if (!target) return <Notice>{unavailable}</Notice>;
  return <FileDiff environmentId={environmentId} target={target} path={path} lineNumbers={lineNumbers} />;
}

function Preview({ threadId, anchor, overlay, lineNumbers, dismiss }: {
  threadId: string;
  anchor: Anchor;
  overlay: boolean;
  lineNumbers: boolean;
  dismiss: () => void;
}) {
  const sdk = useSdk();
  const position = usePreviewPosition(anchor, overlay, dismiss);
  const [environmentId, setEnvironmentId] = useState<string | null>();
  useEffect(() => {
    let request = 0;
    const load = () => {
      const id = ++request;
      void sdk.threads.get({ threadId }).then(
        thread => { if (id === request) setEnvironmentId(thread.environmentId); },
        () => { if (id === request) setEnvironmentId(null); },
      );
    };
    load();
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: event => {
        if (!event.changes.includes("environment-changed")) return;
        setEnvironmentId(undefined);
        load();
      },
    });
    return () => {
      request++;
      unsubscribe();
    };
  }, [sdk, threadId]);

  if (!position) return null;
  return (
    <section data-diff-preview="" className="bb-diff-preview" aria-label="Git diff preview" style={position}>
      <header className="bb-diff-preview-path" title={anchor.path}>{anchor.path}</header>
      <div className="bb-diff-preview-content">
        {environmentId
          ? <WorkspaceDiff environmentId={environmentId} path={anchor.path} lineNumbers={lineNumbers} />
          : <Notice>{environmentId === undefined ? loading : unavailable}</Notice>}
      </div>
    </section>
  );
}

function DiffPreviewOverlay() {
  const { threadId } = useBbContext();
  const { values } = useSettings();
  const enabled = values?.enabled !== false;
  const delay = values?.delay === delayOptions[0] ? 250 : values?.delay === delayOptions[2] ? 800 : 500;
  const { anchor, dismiss } = useHoveredFile(enabled, delay, threadId);
  if (!threadId || !anchor) return null;
  return <Preview
    key={JSON.stringify([threadId, anchor.path])}
    threadId={threadId}
    anchor={anchor}
    overlay={values?.placement !== placementOptions[1]}
    lineNumbers={values?.lineNumbers !== false}
    dismiss={dismiss}
  />;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: "diff-preview", component: DiffPreviewOverlay });
});
