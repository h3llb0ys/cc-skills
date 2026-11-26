import { useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { sourceTargets } from "../settings";
import type { Watch } from "../contract";

type Target = keyof typeof sourceTargets;
const icons = { web: "Globe", app: "Laptop" } as const;

const sourcePath = /\/[\w.-]+\/(?:pl\/[a-z0-9]{26}|channels\/[\w.-]+)\/?$/;

export function sourceBase(href: string) {
  if (!URL.canParse(href)) return null;
  const url = new URL(href);
  const route = url.pathname.match(sourcePath);
  return route && url.protocol === "https:" && !url.username && !url.password
    ? url.origin + url.pathname.slice(0, route.index) : null;
}

export function preferredSourceTarget(setting: unknown): Target {
  return setting === sourceTargets.app ? "app" : "web";
}

export function sourceLink(nav: ReturnType<typeof useBbNavigate>, url: string, target: Target, onOpen?: () => void) {
  const href = target === "web" ? url : url.replace(/^https:/i, "mattermost:");
  return {
    href,
    target: target === "web" ? "_blank" : undefined,
    rel: "noopener noreferrer",
    onClick(event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "preventDefault">) {
      onOpen?.();
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && nav.openUrl(href)) {
        event.preventDefault();
      }
    },
  };
}

export function usePreferredLink(url: string, onOpen?: () => void) {
  const settings = useSettings();
  const nav = useBbNavigate();
  const target = preferredSourceTarget(settings.values?.openTarget);
  return { link: sourceLink(nav, url, target, onOpen), loading: settings.isLoading, target };
}

export function OpenSource({ watch, onOpen }: { onOpen?: () => void; watch: Pick<Watch, "url" | "title" | "channel" | "source_link_blocked" | "source_problem"> }) {
  const settings = useSettings();
  const nav = useBbNavigate();
  const [open, setOpen] = useState(false);
  const target = preferredSourceTarget(settings.values?.openTarget);
  const title = watch.title || watch.channel || watch.url;
  const action = target === "app" ? "Открыть в приложении" : "Открыть в браузере";
  const disabled = settings.isLoading || watch.source_link_blocked;
  const glyph = <Icon name={icons[target]} className="mm-action-glyph" aria-hidden />;
  return <span className="mm-open-group">
    {disabled ? <button type="button" disabled aria-label={action + ": " + title} title={watch.source_problem || action}>{glyph}</button> :
      <a {...sourceLink(nav, watch.url, target, onOpen)} title={action} aria-label={action + ": " + title}>{glyph}</a>}
    <Menu.Root open={open && !disabled} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild><button type="button" className="mm-open-arrow" disabled={disabled}
        title="Выбрать, где открыть" aria-label={"Выбрать, где открыть: " + title}>
        <Icon name="ChevronDown" className="mm-action-glyph" aria-hidden />
      </button></Menu.Trigger>
      <Menu.Portal><Menu.Content className="mm-open-menu" align="end" sideOffset={4} collisionPadding={6}
        aria-label="Открыть в Mattermost">
        {(["web", "app"] as const).map(option => {
          const props = sourceLink(nav, watch.url, option, onOpen);
          return <Menu.Item asChild key={option}><a {...props} onClick={event => {
            props.onClick(event);
            setOpen(false);
          }}><Icon name={icons[option]} className="mm-action-glyph" aria-hidden />{sourceTargets[option]}</a></Menu.Item>;
        })}
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </span>;
}
