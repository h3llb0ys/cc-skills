import { useEffect, useRef } from "react";
import { experimental_useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import { contract } from "../contract";

export function useSubscriptions() {
  const query = experimental_useRpcQuery({ contract, method: "list", input: null });
  useWatchRefresh(query.refetch);
  return query;
}

export function useWatchRefresh(refetch: () => Promise<unknown>) {
  const refresh = useRef(refetch);
  refresh.current = refetch;
  useRealtime("changed", () => { void refresh.current(); });
  useEffect(() => {
    const poll = () => { if (!document.hidden) void refresh.current(); };
    const id = window.setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", poll); };
  }, []);
}
