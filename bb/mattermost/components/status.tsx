import { useColors } from "../hooks/use-colors";
import { defaults, labels, type Signal, type Watch } from "../contract";

export type Colors = Record<Signal, string | null>;

export function Marker({ status, colors }: { status: Watch["status"]; colors: Colors }) {
  return !status || status === "normal" ? null : <span className="mm-marker">
    <i style={{ backgroundColor: colors[status] ?? defaults[status] }} />{labels[status]}
  </span>;
}

export function MessageStatus({ attributes }: { attributes: Readonly<Record<string, string>> }) {
  const query = useColors();
  const status = attributes.status;
  if (status !== "answer" && status !== "attention" && status !== "resolved") return null;
  return <span className="mm-ui"><Marker status={status} colors={query.data ?? defaults} /></span>;
}
