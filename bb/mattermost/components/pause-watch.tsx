import { useAsyncAction } from "../hooks/use-async-action";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { contract, type Watch } from "../contract";

export function PauseGlyph({ resume = false }: { resume?: boolean }) {
  return <svg viewBox="0 0 24 24" className="mm-action-glyph" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {resume ? <path d="m7 4 13 8-13 8z" /> : <path d="M8 5v14M16 5v14" />}
  </svg>;
}

export type DemoPause = (id: string, suspended: boolean) => void;
type PauseTarget = Pick<Watch, "id" | "paused" | "suspended"> & { schedule?: string | null };

export function PauseWatch({ watch, name, demo }: { watch: PauseTarget; name: string; demo?: DemoPause }) {
  const rpc = useRpc<typeof contract>();
  const { run: toggle, busy, error } = useAsyncAction(async () => {
    if (demo) demo(watch.id, !watch.suspended);
    else await rpc.call("setPaused", { id: watch.id, suspended: !watch.suspended });
  });
  if (watch.paused || (!watch.schedule && !demo)) return null;
  const label = watch.suspended ? "Возобновить подписку" : "Приостановить подписку";
  return <><button type="button" className="mm-icon" title={label} aria-label={label + ": " + name}
    disabled={busy} onClick={event => { event.stopPropagation(); void toggle(); }}>
    <PauseGlyph resume={watch.suspended} /></button>{error && <small role="alert">{error}</small>}</>;
}
