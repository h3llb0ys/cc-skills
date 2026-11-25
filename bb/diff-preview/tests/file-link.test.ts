import assert from "node:assert/strict";
import test from "node:test";

import { fileExcerpt, parseFileLink } from "../file-link";
import { linkPreviewPosition } from "../hooks/hover";

test("accepts BB's canonical local-file links and decodes the path", () => {
  assert.deepEqual(parseFileLink("file:///Users/me/extra/code%20%231.md#L44-L46"), {
    path: "/Users/me/extra/code #1.md", start: 44, end: 46,
  });
  assert.deepEqual(parseFileLink("file:///C:/repos/app.ts"), {
    path: "C:/repos/app.ts", start: null, end: null,
  });
  for (const href of [
    "https://example.com/code.md#L44", "/api/file", "file://other/etc/passwd",
    "file:////remote/path", "file:///src/app.ts#L4-L2", "file:///src/a%00b#L1", "file:///invalid%GG#L1",
  ]) assert.equal(parseFileLink(href), null, href);
});

test("shows fifteen lines around the target and highlights the linked range", () => {
  const content = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\r\n") + "\r\n";
  const link = { path: "/rules/code.md", start: 44, end: 46 };
  const excerpt = fileExcerpt(content, link);
  assert.equal(excerpt.length, 15);
  assert.deepEqual(excerpt.filter(line => line.highlighted).map(line => line.number), [44, 45, 46]);
  assert.equal(excerpt[0].number, 38);
  assert.equal(fileExcerpt(content, { ...link, start: 80, end: 80 }).at(-1)?.number, 80);
  assert.equal(fileExcerpt(content, { ...link, start: null, end: null })[0].highlighted, false);
  assert.deepEqual(fileExcerpt(content, { ...link, start: 81, end: 81 }), []);
});

test("a chat preview reverses direction near the bottom and fits the viewport", () => {
  const row = { left: 305, right: 350, top: 420, bottom: 444, width: 45, height: 24 } as DOMRectReadOnly;
  assert.deepEqual(linkPreviewPosition(row, { width: 360, height: 500 }), {
    left: 8, width: 344, bottom: 84, maxHeight: 320,
  });
});
