import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { contract, type Watch } from "../contract";
import { useAsyncAction } from "../hooks/use-async-action";
import { checkTime } from "../time";
import { SummaryContent, type OpenSummary } from "./summary-content";

function resultLabel(w: Watch) {
  if (w.paused) return "Наблюдение завершено";
  if (w.suspended) return "На паузе";
  if (!w.schedule) return "Расписание не включено";
  const problem = w.source_problem || w.dispatch_problem || w.delivery_problem;
  if (problem) return problem;
  if (w.review_stage === "reading") return "Читаем историю канала…";
  if (w.review_stage === "reviewing") return "Разбираем сообщения…";
  if (w.review_stage === "queued") return "Первый разбор в очереди";
  const checked = w.last_checked_at ?? 0;
  const processed = w.last_processed_at ?? 0;
  if (checked && (w.last_check_quiet ?? (processed > 0 && checked > processed))) return "Проверено " + checkTime.format(checked * 1000) + " · изменений нет";
  if (processed) {
    const when = checkTime.format(processed * 1000);
    if (w.last_review_notified && w.latest_summary) return "Сводка готова · " + when;
    return "Разобрано " + when + (w.last_review_notified === false ? " · без уведомления" : "");
  }
  return checked ? "Прочитано " + checkTime.format(checked * 1000) : "Ожидает проверки";
}

export function WatchResult({ watch, feedback }: { watch: Watch; feedback: string }) {
  const rpc = useRpc<typeof contract>();
  const [detail, setDetail] = useState<OpenSummary | null>(null);
  const [draft, setDraft] = useState<string>();
  const latest = watch.latest_summary;
  const open = useAsyncAction(async () => {
    if (detail) return setDetail(null);
    if (!latest) return;
    const summary = await rpc.call("openSummary", { chat: watch.chat, id: latest.id });
    setDraft(undefined);
    setDetail(summary);
  });
  return <>
    <div className="mm-result"><span role="status">{feedback || resultLabel(watch)}</span>
      {(latest || detail) && <button type="button" aria-expanded={!!detail} disabled={open.busy} onClick={() => void open.run()}>
        {detail ? "Свернуть сводку" : "Открыть сводку в BB →"}</button>}
    </div>
    {open.error && <small role="alert">{open.error}</small>}
    {detail && <article className="mm-event mm-result-detail"><strong>{detail.headline}</strong>
      <SummaryContent detail={detail} source={watch} draft={draft} update={setDraft} /></article>}
  </>;
}
