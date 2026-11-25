import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";

import { fileExcerpt } from "../file-link";
import { usePreviewPosition, type Anchor } from "../hooks/hover";

const maxFileSize = 1024 * 1024;

export function FileLinkPreview({ anchor, lineNumbers, dismiss }: {
  anchor: Extract<Anchor, { kind: "link" }>;
  lineNumbers: boolean;
  dismiss: () => void;
}) {
  const sdk = useSdk();
  const position = usePreviewPosition(anchor, false, dismiss);
  const visible = position !== null;
  const [result, setResult] = useState<ReturnType<typeof fileExcerpt> | string>("Loading file…");
  const { threadId, link: { path, start, end } } = anchor;

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const { signal } = controller;
    setResult("Loading file…");
    const load = async () => {
      try {
        const thread = await sdk.threads.get({ threadId, signal });
        if (signal.aborted) return;
        if (!thread.environmentId) throw new Error("Missing thread environment");
        const environment = await sdk.environments.get({ environmentId: thread.environmentId, signal });
        if (signal.aborted) return;
        if (!environment.hostId) throw new Error("Missing environment host");
        const file = await sdk.files.read({ hostId: environment.hostId, path, signal });
        if (signal.aborted) return;
        if (file.contentEncoding !== "utf8") {
          setResult("Preview is available for text files.");
        } else if (file.sizeBytes > maxFileSize) {
          setResult("This file is too large to preview.");
        } else {
          const lines = fileExcerpt(file.content, { path, start, end });
          setResult(lines.length ? lines : file.content ? "The linked line is outside the file." : "The file is empty.");
        }
      } catch {
        if (!signal.aborted) setResult("File preview unavailable.");
      }
    };
    void load();
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: event => {
        if (event.changes.includes("environment-changed")) dismiss();
      },
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [sdk, threadId, path, start, end, dismiss, visible]);

  if (!position) return null;
  const title = start === null ? path : `${path}:${start}${end !== start ? `–${end}` : ""}`;
  return (
    <section data-diff-preview="" className="bb-diff-preview" aria-label="File preview" style={position}>
      <header className="bb-diff-preview-path" title={title}>{title}</header>
      <div className="bb-diff-preview-content">
        {typeof result === "string"
          ? <div className="bb-diff-preview-notice" role="status">{result}</div>
          : <pre className="bb-file-preview-lines">{result.map(line => (
              <span key={line.number} className="bb-file-preview-line" data-highlighted={line.highlighted || undefined}>
                {lineNumbers && <span className="bb-file-preview-number">{line.number}</span>}
                {line.text}
              </span>
            ))}</pre>}
      </div>
    </section>
  );
}
