import { definePluginApp, useBbContext, useSettings } from "@get-bb/plugin-sdk/app";
import { Preview } from "./components/preview";
import { useHoveredFile } from "./hooks/hover";
import { delayOptions, placementOptions } from "./settings";
import "./app.css";

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
