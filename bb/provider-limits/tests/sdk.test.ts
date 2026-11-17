import { test } from "node:test";
import assert from "node:assert/strict";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";
test("uses only public SDK and package-local imports", async () => {
  const result = await experimental_scanPublicSdkOnly(
    fileURLToPath(new URL("..", import.meta.url)),
    { allow: [/^react$/, /^react-dom$/] },
  );
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.privateDependencies, []);
});
