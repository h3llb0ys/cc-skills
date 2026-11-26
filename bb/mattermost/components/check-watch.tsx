import { useState } from "react";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import { contract, type Watch } from "../contract";

const outcomes = { busy: "Проверка уже идёт", reviewing: "Идёт разбор сообщений", quiet: "Новых сообщений нет" };

export function CheckWatch({ watch }: { watch: Watch }) {
  const rpc = useRpc<typeof contract>();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  async function check() {
    setBusy(true);
    setInfo("");
    try {
      const result = await rpc.call("check", { id: watch.id });
      setInfo(result.outcome === "failed" ? (result.problem || "Ошибка проверки") : outcomes[result.outcome]);
    } catch (err) { setInfo(String(err)); }
    finally { setBusy(false); }
  }
  return <span className="mm-check-now">
    <button className="mm-icon" aria-label={`Проверить сейчас: ${watch.title || watch.url}`}
      title="Проверить сейчас" disabled={busy || watch.paused || watch.suspended} onClick={() => void check()}>
      <Icon name="RefreshCw" className="mm-action-glyph" aria-hidden />
    </button>{!watch.suspended && (busy || info) && <small role="status">{busy ? "Проверяем…" : info}</small>}
  </span>;
}
