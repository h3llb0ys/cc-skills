import type { Watch } from "../contract";
import { checkTime } from "../time";

export function WatchProgress({ watch }: { watch: Watch }) {
  function stamp(label: string, seconds: number) {
    const date = new Date(seconds * 1000);
    return <time dateTime={date.toISOString()}>{label} {checkTime.format(date)}</time>;
  }
  return <span>
    {watch.last_checked_at ? stamp("Прочитано", watch.last_checked_at) : "Время чтения неизвестно"}
    {watch.last_processed_at && <> · {stamp("Обработано", watch.last_processed_at)}</>}
    {watch.processing_pending && " · Ожидает обработки"}
  </span>;
}
