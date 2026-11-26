import type { Summary, Watch } from "../contract";
import { OpenSource, sourceBase, usePreferredLink } from "./open-source";
import { ReplyDraft } from "./reply-draft";

export type OpenSummary = Summary & { body: string; draft: string };

function SummaryLink({ url }: { url: string }) {
  const { link, loading } = usePreferredLink(url);
  return loading ? <span>{url}</span> : <a {...link}>{url}</a>;
}

function SummaryBody({ body, url }: { body: string; url: string }) {
  const base = sourceBase(url);
  return <p className="mm-summary-body">{body.split(/(https:\/\/[^\s<>)\]]+)/g).map((part, i) =>
    !part.startsWith("https://") ? part : base && sourceBase(part) === base ? <SummaryLink key={i} url={part} />
      : <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
  )}</p>;
}

export function SummaryContent({ detail, source, draft, update }: {
  detail: OpenSummary; source?: Watch; draft?: string; update(text: string): void;
}) {
  return <>
      <SummaryBody body={detail.body} url={detail.url} />
      <OpenSource watch={{ url: detail.url, title: detail.headline,
        source_link_blocked: source?.source_link_blocked, source_problem: source?.source_problem }} />
      {detail.draft && <details><summary>Черновик ответа</summary>
        <ReplyDraft url={detail.url} text={draft ?? detail.draft}
          update={update} />
      </details>}
  </>;
}
