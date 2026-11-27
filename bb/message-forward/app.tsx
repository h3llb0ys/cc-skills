import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useComposers,
  useSdk,
  type PluginMessageActionContext,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { getThreadRows } from "./thread-tree";
import "./app.css";

const actionTitle = "Переслать в чат…";
const rootPageSize = 30;
type Source = Pick<PluginMessageActionContext, "message" | "selectedText">;
type Destination = { threadId: string; content: string };

let source: Source | null = null;
const listeners = new Set<() => void>();

function showSource(next: Source | null) {
  source = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function MessageForward() {
  const request = useSyncExternalStore(subscribe, () => source);
  const navigate = useBbNavigate();
  const { threadId: activeThreadId } = useBbContext();
  const composers = useComposers();
  const [destination, setDestination] = useState<Destination | null>(null);
  const pending = useRef<Destination | null>(null);

  useEffect(() => {
    if (!destination) return;
    const timeout = window.setTimeout(() => {
      if (pending.current !== destination) return;
      pending.current = null;
      setDestination(null);
      toast.error("Не удалось открыть черновик выбранного чата");
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, [destination]);

  useEffect(() => {
    if (
      !destination ||
      pending.current !== destination ||
      activeThreadId !== destination.threadId
    ) return;
    const composer = composers.find(({ scope }) =>
      scope.kind === "thread" && scope.threadId === destination.threadId,
    );
    if (!composer) return;

    // Consume the request before inserting, since the draft update rerenders subscribers.
    pending.current = null;
    setDestination(null);
    try {
      composer.insert(destination.content, { at: "end", block: true });
    } catch {
      toast.error("Не удалось заполнить поле ввода выбранного чата");
      return;
    }
    composer.focus();
  }, [activeThreadId, composers, destination]);

  function addToDraft(threadId: string, content: string) {
    if (pending.current) return;
    const next = { threadId, content };
    pending.current = next;
    showSource(null);
    setDestination(next);
    navigate.toThread(threadId);
  }

  if (!request) return null;
  return (
    <ThreadPicker
      key={JSON.stringify([request.message.threadId, request.message.id, request.selectedText])}
      request={request}
      busy={destination !== null}
      onChoose={addToDraft}
    />
  );
}

function useSourceHref(threadId: string, sidebarHref: string | undefined, linkable: boolean, sidebarLoading: boolean) {
  const sdk = useSdk();
  const [resolvedHref, setResolvedHref] = useState<string | null>();

  useEffect(() => {
    if (!linkable || sidebarHref || sidebarLoading) return;

    // Archived sources don't appear in the active sidebar.
    const controller = new AbortController();
    sdk.threads.get({ threadId, signal: controller.signal })
      .then(thread => {
        if (controller.signal.aborted) return;
        const path = "/threads/" + encodeURIComponent(threadId);
        setResolvedHref(thread.projectId === "proj_personal"
          ? path
          : "/projects/" + encodeURIComponent(thread.projectId) + path);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolvedHref(null);
      });

    return () => controller.abort();
  }, [linkable, sdk, sidebarHref, sidebarLoading, threadId]);

  return sidebarHref ?? resolvedHref;
}

function ThreadPicker({ request, busy, onChoose }: {
  request: Source;
  busy: boolean;
  onChoose: (threadId: string, content: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [rootLimit, setRootLimit] = useState(rootPageSize);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const { projects, status, threads } = experimental_useSidebarThreads();
  const sourceThread = threads.find(thread => thread.id === request.message.threadId);
  const sequence = request.message.experimental_messageSeq;
  // BB's optimistic user messages use sequence zero until they are recorded.
  const linkable = Number.isSafeInteger(sequence) && sequence > 0;
  const [mode, setMode] = useState<"link" | "text">(linkable ? "link" : "text");
  const href = useSourceHref(request.message.threadId, sourceThread?.href, linkable, status === "loading");
  const link = href && linkable ? new URL(href, window.location.origin) : null;
  if (link) link.hash = "msg=" + sequence;
  const text = request.selectedText ?? request.message.text;
  const content = mode === "link" ? link?.href ?? "" : text;
  const search = query.trim().toLowerCase();
  const { rows, hasMore } = getThreadRows(threads, projects, {
    sourceId: request.message.threadId,
    search,
    expanded,
    rootLimit,
  });

  function toggleChildren(threadId: string) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    searchInput.current?.focus();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="message-forward-picker"
      aria-label="Переслать в чат"
      onCancel={event => {
        event.preventDefault();
        showSource(null);
      }}
      onClick={event => {
        if (event.currentTarget === event.target) showSource(null);
      }}
    >
      <section>
        <header>
          <h2>Переслать в чат</h2>
          <button type="button" aria-label="Закрыть" onClick={() => showSource(null)}>×</button>
        </header>
        <div className="message-forward-form">
          <input
            ref={searchInput}
            type="search"
            aria-label="Поиск чата"
            placeholder="Поиск чата"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setRootLimit(rootPageSize);
            }}
          />
          <div className="message-forward-modes" role="group" aria-label="Что добавить в черновик">
            <button type="button" disabled={!link} aria-pressed={mode === "link"} onClick={() => setMode("link")}>Ссылка</button>
            <button type="button" disabled={!text.trim()} aria-pressed={mode === "text"} onClick={() => setMode("text")}>Текст</button>
          </div>
        </div>
        {mode === "link" && !link && (
          <p role="status">
            {href === undefined ? "Загружаю ссылку…" : "Ссылка недоступна. Можно выбрать текст."}
          </p>
        )}
        <ul className="message-forward-targets">
          {rows.map((row, index) => {
            const { thread, rootProjectId, rootProjectName, otherProjectName, depth, hasChildren } = row;
            const isSource = thread.id === request.message.threadId;
            const isExpanded = expanded.has(thread.id);
            const title = thread.displayTitle + " · " + (otherProjectName ?? rootProjectName);
            return (
              <Fragment key={thread.id}>
                {rows[index - 1]?.rootProjectId !== rootProjectId && (
                  <li className="message-forward-project">{rootProjectName}</li>
                )}
                <li
                  className="message-forward-row"
                  style={{ paddingInlineStart: Math.min(depth, 6) * 14 }}
                >
                  {hasChildren && !search ? (
                    <button
                      type="button"
                      className="message-forward-toggle"
                      aria-label={(isExpanded ? "Свернуть: " : "Развернуть: ") + thread.displayTitle}
                      aria-expanded={isExpanded}
                      onClick={() => toggleChildren(thread.id)}
                    >
                      <span aria-hidden="true">{isExpanded ? "⌄" : "›"}</span>
                    </button>
                  ) : <span className="message-forward-toggle" />}
                  <button
                    type="button"
                    className="message-forward-target"
                    title={thread.displayTitle}
                    aria-label={title}
                    disabled={isSource || busy || !content.trim()}
                    onClick={() => onChoose(thread.id, content)}
                  >
                    <span>{thread.displayTitle}</span>
                    {otherProjectName && <small>{otherProjectName}</small>}
                  </button>
                </li>
              </Fragment>
            );
          })}
          {hasMore && (
            <li>
              <button type="button" onClick={() => setRootLimit(current => current + rootPageSize)}>
                Показать ещё
              </button>
            </li>
          )}
        </ul>
        {rows.length === 0 && (
          <p role="status">
            {status === "loading" ? "Загружаю чаты…" : status === "error" ? "Не удалось загрузить чаты" : "Чаты не найдены"}
          </p>
        )}
      </section>
    </dialog>
  );
}

export default definePluginApp(app => {
  app.slots.messageAction({
    id: "forward-message",
    title: actionTitle,
    icon: "ArrowTurnBackward",
    run: ({ message, selectedText }) => showSource({ message, selectedText }),
  });
  app.slots.experimental_appOverlay({ id: "message-forward", component: MessageForward });
});
