import { useColors } from "../hooks/use-colors";
import { defaults, labels, type Signal, type Watch } from "../contract";

export type Colors = Record<Signal, string | null>;

export function watchProblem(w: Watch) {
  return w.source_problem || w.dispatch_problem || w.delivery_problem || w.push_problem;
}

export function Marker({ status, colors }: { status: Watch["status"]; colors: Colors }) {
  return !status || status === "normal" ? null : <span className="mm-marker">
    <i style={{ backgroundColor: colors[status] ?? defaults[status] }} />{labels[status]}
  </span>;
}

export function WatchMarker({ watch, colors }: { watch: Pick<Watch, "suspended" | "status" | "paused">; colors: Colors }) {
  if (watch.paused) return null;
  if (watch.suspended) return <span className="mm-marker mm-paused-marker"><i />На паузе</span>;
  return <Marker status={watch.status} colors={colors} />;
}

export function MessageStatus({ attributes }: { attributes: Readonly<Record<string, string>> }) {
  const query = useColors();
  const status = attributes.status;
  if (status !== "answer" && status !== "attention" && status !== "resolved") return null;
  return <span className="mm-ui"><Marker status={status} colors={query.data ?? defaults} /></span>;
}
