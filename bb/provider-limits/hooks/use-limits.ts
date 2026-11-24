import { useCallback, useEffect, useState } from "react";
import { useRpc, useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { type rpcContract } from "../server";
import { optionsSchema, type Options, type Snapshot } from "../model";

export function useLimits() {
  const rpc = useRpc<typeof rpcContract>();
  const [options, setOptions] = useState<Options>(optionsSchema.parse({}));
  const [snapshot, setSnapshot] = useState<Snapshot>({
    rows: [],
    updatedAt: null,
    error: null,
  });
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const connection = useRealtimeConnectionState();
  const [revision, setRevision] = useState(0);
  useRealtime("options-changed", () => setRevision((n) => n + 1));
  useEffect(() => {
    let live = true;
    void rpc
      .call("options", null)
      .then((v) => {
        if (live) {
          setOptions(v);
          setLoaded(true);
          setOptionsError("");
        }
      })
      .catch(() => {
        if (live) setOptionsError("Не удалось загрузить настройки");
      });
    return () => {
      live = false;
    };
  }, [rpc, revision, connection]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await rpc.call("snapshot", null);
        if (live) {
          setSnapshot(value);
          setError("");
        }
      } catch {
        if (live) setError("Нет связи с плагином");
      } finally {
        if (live)
          timer = setTimeout(poll, Math.min(options.refreshSeconds, 30) * 1000);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, options.refreshSeconds, connection]);
  const save = useCallback(
    async (value: Options) => {
      await rpc.call("save", value);
      setOptions(value);
    },
    [rpc],
  );
  return { options, snapshot, error: optionsError || error, save, loaded };
}
