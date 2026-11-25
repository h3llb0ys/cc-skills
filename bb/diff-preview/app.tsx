import { definePluginApp, useBbContext, useSettings } from "@get-bb/plugin-sdk/app";

import { FileLinkPreview } from "./components/file-link-preview";
import { Preview } from "./components/preview";
import { useHoveredFile } from "./hooks/hover";
import { delayOptions, placementOptions } from "./settings";
import "./app.css";

function DiffPreviewOverlay() {
  const { threadId } = useBbContext();
  const { values } = useSettings();
  const gitEnabled = values?.enabled !== false;
  const linksEnabled = values !== undefined && values.fileLinks !== false;
  const delay = values?.delay === delayOptions[0] ? 250 : values?.delay === delayOptions[2] ? 800 : 500;
  const { anchor, dismiss } = useHoveredFile(gitEnabled, linksEnabled, delay, threadId);
  if (!threadId || !anchor) return null;
  if (anchor.kind === "link") return <FileLinkPreview
    key={JSON.stringify([anchor.threadId, anchor.href])}
    anchor={anchor}
    lineNumbers={values?.lineNumbers !== false}
    dismiss={dismiss}
  />;
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
