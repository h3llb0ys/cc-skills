import { useState } from "react";

export function useAsyncAction<Args extends unknown[]>(action: (...args: Args) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(...args: Args) {
    setBusy(true);
    setError("");
    try {
      await action(...args);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
