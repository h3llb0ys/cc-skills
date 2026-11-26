import { useState } from "react";
import { experimental_copyToClipboard, useBbNavigate } from "@get-bb/plugin-sdk/app";

import { usePreferredLink } from "./open-source";

export function ReplyDraft({ text, update, url }: { text: string; update: (s: string) => void; url: string }) {
  const nav = useBbNavigate();
  const [feedback, setFeedback] = useState("");
  const { link, loading, target } = usePreferredLink(url);
  const [fallback, setFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  async function copyAndOpen() {
    setBusy(true);
    setFallback(false);
    try {
      if (!await experimental_copyToClipboard({ text })) {
        setFeedback("Не удалось скопировать. Выдели текст и скопируй вручную.");
      } else {
        setFallback(!nav.openUrl(link.href));
        setFeedback("Черновик скопирован");
      }
    } catch (err) { setFeedback(String(err)); }
    finally { setBusy(false); }
  }
  return <div className="mm-reply">
    <textarea aria-label="Черновик ответа" value={text} onChange={e => { update(e.target.value); setFeedback(""); setFallback(false); }} />
    <button disabled={busy || loading || !text.trim()} onClick={() => void copyAndOpen()}>Скопировать и открыть в Mattermost</button>
    {fallback && <a {...link}>{target === "app" ? "Открыть в приложении" : "Открыть в браузере"}</a>}
    {feedback && <small role="status">{feedback}</small>}
  </div>;
}
