import { useAsyncAction } from "../hooks/use-async-action";
import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { ColorPalette } from "../../shared-ui/color-palette";
import { contract, labels, type Signal } from "../contract";
import { useColors } from "../hooks/use-colors";
import { Marker } from "./status";

export function ColorSettings() {
  const rpc = useRpc<typeof contract>();
  const query = useColors();
  const [selected, select] = useState<Signal>("answer");
  const { run: save, busy, error } = useAsyncAction((color: string | null) =>
    rpc.call("color", { status: selected, color }));
  const colors = query.data;
  if (!colors) return query.error
    ? <div role="alert">Не удалось загрузить цвета. <button onClick={() => void query.refetch()}>Повторить</button></div>
    : <p>Загрузка цветов…</p>;

  return <div className="mm-ui">
    <div className="mm-tabs" role="group" aria-label="Цвет статуса">
      {(Object.keys(labels) as Signal[]).map(status => <button key={status} type="button"
        aria-pressed={status === selected} onClick={() => select(status)}>
        <Marker status={status} colors={colors} />
      </button>)}
    </div>
    <fieldset disabled={busy}><ColorPalette color={colors[selected]} commitCustomColor onChange={save} /></fieldset>
    {error && <p role="alert">{error}</p>}
  </div>;
}
