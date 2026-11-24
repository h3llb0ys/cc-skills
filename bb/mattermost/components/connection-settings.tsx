import { useState } from "react";
import { experimental_useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";
import { contract } from "../contract";

export function ConnectionSettings() {
  const rpc = useRpc<typeof contract>();
  const connection = experimental_useRpcQuery({ contract, method: "connection", input: null });
  const [editedUrl, setUrl] = useState<string | null>(null);
  const [cookie, setCookie] = useState("");
  const [pending, setPending] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const url = editedUrl ?? connection.data?.url ?? "";
  const reuse = !!connection.data?.hasCookie && url.trim().replace(/\/+$/, "") === connection.data.url;
  async function submit(action: "save" | "test") {
    setPending(action);
    setError("");
    setMessage("");
    try {
      if (action === "test") {
        const result = await rpc.call("testConnection", { url, cookie });
        setMessage("Соединение установлено · @" + result.username);
      } else {
        const result = await rpc.call("saveConnection", { url, cookie });
        setUrl(result.url);
        setCookie("");
        await connection.refetch();
        setMessage("Подключение сохранено");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить запрос");
    } finally { setPending(null); }
  }
  if (connection.error && !connection.data) return <div role="alert">Не удалось загрузить настройки подключения. <button onClick={() => void connection.refetch()}>Повторить</button></div>;
  if (!connection.data) return <p>Загрузка настроек…</p>;
  return <form className="mm-ui mm-sheet" onSubmit={e => { e.preventDefault(); void submit("save"); }}>
    {connection.data.needsRepair && <p role="alert">Проверьте настройки подключения. Введите адрес сервера и cookie заново.</p>}
    <fieldset disabled={pending !== null} className="mm-fields">
      <label className="wide">Адрес сервера Mattermost<input type="url" required value={url} placeholder="https://mattermost.example.org"
        onChange={e => { setUrl(e.target.value); setMessage(""); setError(""); }} /></label>
      <label className="wide">Cookie<input type="password" autoComplete="new-password" spellCheck={false}
        placeholder={reuse ? "Сохранена · введите новую для замены" : "MMAUTHTOKEN=…"} value={cookie}
        onChange={e => { setCookie(e.target.value); setMessage(""); setError(""); }} /></label>
      <div className="mm-actions wide"><button type="submit" disabled={!url.trim() || (!cookie.trim() && !reuse)}>Сохранить</button>
        <button type="button" disabled={!url.trim() || (!cookie.trim() && !reuse)} onClick={() => void submit("test")}>
          {pending === "test" ? "Проверяем…" : "Проверить соединение"}</button></div>
    </fieldset>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </form>;
}
