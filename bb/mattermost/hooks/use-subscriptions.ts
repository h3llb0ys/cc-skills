import { useEffect, useRef } from "react";
import { experimental_useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import { contract } from "../contract";

type Refetch = () => Promise<unknown>;

function startPolling(refresh: () => void) {
  const poll = () => { if (!document.hidden) refresh(); };
  const timer = window.setInterval(poll, 30000);
  document.addEventListener("visibilitychange", poll);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", poll);
  };
}

// The SDK shares list(null) across surfaces in this window. One observer can refresh it for all of them.
const listObservers = new Set<{ current: Refetch }>();
let stopPollingList: (() => void) | undefined;
function firstListObserver() { return listObservers.values().next().value; }

export function useSubscriptions() {
  const query = experimental_useRpcQuery({ contract, method: "list", input: null });
  const observer = useRef(query.refetch);
  observer.current = query.refetch;
  useRealtime("changed", () => {
    if (firstListObserver() === observer) void observer.current();
  });
  useEffect(() => {
    listObservers.add(observer);
    stopPollingList ??= startPolling(() => { void firstListObserver()?.current(); });
    return () => {
      listObservers.delete(observer);
      if (!listObservers.size) {
        stopPollingList?.();
        stopPollingList = undefined;
      }
    };
  }, []);
  return query;
}

export function useWatchRefresh(refetch: Refetch) {
  const refresh = useRef(refetch);
  refresh.current = refetch;
  useRealtime("changed", () => { void refresh.current(); });
  useEffect(() => startPolling(() => { void refresh.current(); }), []);
}
