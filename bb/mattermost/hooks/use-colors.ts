import { experimental_useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import { contract } from "../contract";

export function useColors() {
  const query = experimental_useRpcQuery({ contract, method: "colors", input: null });
  useRealtime("colors", () => { void query.refetch(); });
  return query;
}
