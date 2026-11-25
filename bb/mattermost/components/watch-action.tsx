import type { ReactNode } from "react";
import { useBbNavigate, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import type { Watch } from "../contract";
import { watchActions } from "../settings";

export function WatchAction({ watch, className, children, onEdit }: {
  watch: Watch; className?: string; children: ReactNode; onEdit(): void;
}) {
  const settings = useSettings();
  const nav = useBbNavigate();
  const sdk = useSdk();
  const action = settings.values?.subscriptionClick;
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
  if (settings.isLoading || watch.source_link_blocked) {
    return <button type="button" className={className} disabled title={watch.source_problem || watchActions.mattermost}>{children}</button>;
  }
  return <a className={className} href={watch.url} target="_blank" rel="noopener noreferrer" title={watchActions.mattermost}
    onClick={event => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && nav.openUrl(watch.url)) event.preventDefault();
    }}>{children}</a>;
}
