import type { ReactNode } from "react";
import { useBbNavigate, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import type { Watch } from "../contract";
import { sourceLink } from "./open-source";
import { watchActions } from "../settings";

export function WatchAction({ watch, className, children, onEdit }: {
  watch: Watch; className?: string; children: ReactNode; onEdit(): void;
}) {
  const settings = useSettings();
  const nav = useBbNavigate();
  const sdk = useSdk();
  const action = settings.values?.subscriptionClick ?? watchActions.thread;
  if (action === watchActions.thread) {
    return <button type="button" className={className} title={action} disabled={settings.isLoading}
      onClick={async () => {
        if (watch.summary_thread) {
          const child = await sdk.threads.get({ threadId: watch.summary_thread }).catch(() => null);
          if (child && !child.archivedAt && !child.deletedAt && child.parentThreadId === watch.chat) {
            nav.toThread(child.id);
            return;
          }
        }
        nav.toThread(watch.chat);
      }}>{children}</button>;
  }
  if (action === watchActions.edit) {
    return <button type="button" className={className} title={watch.paused ? "Наблюдение завершено" : action}
      disabled={settings.isLoading || watch.paused} onClick={onEdit}>{children}</button>;
  }
  const desktop = action === watchActions.app;
  const title = desktop ? watchActions.app : "Открыть в браузере";
  if (settings.isLoading || watch.source_link_blocked) {
    return <button type="button" className={className} disabled title={watch.source_problem || title}>{children}</button>;
  }
  return <a {...sourceLink(nav, watch.url, desktop ? "app" : "web")} className={className} title={title}>{children}</a>;
}
