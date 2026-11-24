import assert from "node:assert/strict";
import test from "node:test";

import { patchKey, selectTarget } from "../git";
import { previewPosition } from "../hooks/hover";

const bounds = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRectReadOnly;
const viewport = { width: 800, height: 600 };

test("overlay anchors above the selected row and keeps it clickable", () => {
  const list = bounds(40, 360, 690, 170);
  const row = bounds(45, 435, 680, 25);
  assert.deepEqual(previewPosition(row, list, viewport, true), {
    left: 46, width: 678, maxHeight: 320, bottom: 169,
  });
  assert.equal(previewPosition(row, list, viewport, false)?.bottom, 247);
});

test("the preview fits a narrow viewport and flips when the list is near the top", () => {
  const list = bounds(0, 24, 360, 120);
  const row = bounds(4, 30, 352, 24);
  const mobile = { width: 360, height: 480 };
  assert.deepEqual(previewPosition(row, list, mobile, true), {
    left: 8, width: 344, maxHeight: 320, top: 58,
  });
  assert.equal(previewPosition(row, list, mobile, false)?.top, 151);
  assert.equal(previewPosition(bounds(4, 145, 352, 24), list, mobile, true), null);
});

test("the preview uses the Git comparison shown in the native list", () => {
  const mergeBase = { fileCount: 3, mergeBaseBranch: "release" };
  const workingTree = { fileCount: 1 };
  assert.deepEqual(selectTarget({ workingTree, mergeBase }), { type: "uncommitted" });
  const committed = selectTarget({ workingTree: { fileCount: 0 }, mergeBase });
  assert.deepEqual(committed, { type: "branch_committed", mergeBaseBranch: "release" });
  assert.equal(selectTarget({ workingTree: { fileCount: 0 }, mergeBase: null }), null);
  assert.ok(committed);
  assert.equal(patchKey("env", committed, "src/old\nname.go", "rev"),
    '["env",{"type":"branch_committed","mergeBaseBranch":"release"},false,"src/old\\nname.go","rev"]');
});
