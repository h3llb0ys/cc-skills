import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { contract } from "../contract";

export function useHeaderMode() {
  return experimental_useRpcQuery({ contract, method: "headerMode", input: null });
}
