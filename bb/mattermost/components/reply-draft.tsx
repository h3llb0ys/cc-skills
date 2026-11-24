import { useState } from "react";
import { experimental_copyToClipboard, useBbNavigate } from "@get-bb/plugin-sdk/app";

export function ReplyDraft({ text, update, url }: { text: string; update: (s: string) => void; url: string }) {
  const nav = useBbNavigate();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  async function copyAndOpen() {
    setBusy(true);
    try {
      if (!await experimental_copyToClipboard({ text })) {
        setFeedback("Не удалось скопировать. Выдели текст и скопируй вручную.");
      } else {
        setFeedback(nav.openUrl(url) ? "Черновик скопирован" : "Черновик скопирован. Открой ссылку на сообщение.");
      }
    } catch (err) { setFeedback(String(err)); }
    finally { setBusy(false); }
  }
  return <div className="mm-reply">
    <textarea aria-label="Черновик ответа" value={text} onChange={e => { update(e.target.value); setFeedback(""); }} />
    <button disabled={busy || !text.trim()} onClick={() => void copyAndOpen()}>Скопировать и открыть в Mattermost</button>
    {feedback && <small role="status">{feedback}</small>}
  </div>;
}
