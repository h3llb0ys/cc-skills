// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WatchEditor } from "./components/watch-editor";
import type { Watch } from "./contract";

const sdk = vi.hoisted(() => ({
  call: vi.fn(async () => null),
  targets: [] as string[],
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call: sdk.call }),
  useBbContext: () => ({ threadId: "bound" }),
  experimental_useSidebarThreads: () => ({
    status: sdk.targets.length ? "ready" : "loading",
    threads: sdk.targets.map(id => ({ id, displayTitle: id, environment: { id: "env" } })),
  }),
}));

it("keeps the bound destination during loading and the user selection across sidebar updates", async () => {
  const watch: Watch = { id: "a".repeat(20), chat: "bound", owner: "p", url: "https://mm.example/t/pl/a",
    interval: 5, rule: "QA", push: null, until: null, draft: false, schedule: null, timezone: "UTC",
    kind: "thread", status: "normal", paused: false };
  const editor = () => <WatchEditor watch={watch} close={() => {}} />;
  const view = render(editor());
  try {
    const target = view.getByLabelText("Куда присылать") as HTMLSelectElement;
    expect(target.value).toBe("bound");
    sdk.targets = ["another", "bound"];
    view.rerender(editor());
    expect(target.value).toBe("bound");
    fireEvent.click(view.getByText("Сохранить"));
    await waitFor(() => expect(sdk.call).toHaveBeenCalledTimes(1));
    expect(sdk.call).toHaveBeenLastCalledWith("edit", expect.not.objectContaining({ chat: expect.anything() }));

    fireEvent.change(target, { target: { value: "another" } });
    sdk.targets = [];
    view.rerender(editor());
    sdk.targets = ["bound", "another"];
    view.rerender(editor());
    expect(target.value).toBe("another");
    fireEvent.click(view.getByText("Сохранить"));
    await waitFor(() => expect(sdk.call).toHaveBeenLastCalledWith("edit", expect.objectContaining({ chat: "another" })));
  } finally { view.unmount(); }
});
