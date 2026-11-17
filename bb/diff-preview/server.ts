import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { defaults, delayOptions, placementOptions } from "./settings";

export default function diffPreview(bb: BbPluginApi) {
  bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Preview on hover",
      default: defaults.enabled,
    },
    delay: {
      type: "select",
      label: "Hover delay",
      options: [...delayOptions],
      default: defaults.delay,
    },
    placement: {
      type: "select",
      label: "Preview placement",
      options: [...placementOptions],
      default: defaults.placement,
    },
    lineNumbers: {
      type: "boolean",
      label: "Show line numbers",
      default: defaults.lineNumbers,
    },
  });
}
