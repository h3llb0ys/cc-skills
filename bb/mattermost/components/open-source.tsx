import { useState } from "react";
import type { MouseEvent } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { sourceTargets } from "../settings";
import type { Watch } from "../contract";

type Target = keyof typeof sourceTargets;
const icons = { web: "Globe", app: "Laptop" } as const;

export function sourceLink(nav: ReturnType<typeof useBbNavigate>, url: string, target: Target) {
  const href = target === "web" ? url : url.replace(/^https:/i, "mattermost:");
  return {
    href,
    target: target === "web" ? "_blank" : undefined,
    rel: "noopener noreferrer",
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && nav.openUrl(href)) {
        event.preventDefault();
      }
    },
  };
}

export function OpenSource({ watch }: { watch: Watch }) {
  const settings = useSettings();
  const nav = useBbNavigate();
  const [open, setOpen] = useState(false);
  const target: Target = settings.values?.openTarget === sourceTargets.app ? "app" : "web";
  const title = watch.title || watch.channel || watch.url;
  const action = target === "app" ? "Открыть в приложении" : "Открыть в браузере";
  const disabled = settings.isLoading || watch.source_link_blocked;
  const glyph = <Icon name={icons[target]} className="mm-action-glyph" aria-hidden />;
  return <span className="mm-open-group">
    {disabled ? <button type="button" disabled aria-label={action + ": " + title} title={watch.source_problem || action}>{glyph}</button> :
      <a {...sourceLink(nav, watch.url, target)} title={action} aria-label={action + ": " + title}>{glyph}</a>}
    <Menu.Root open={open && !disabled} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild><button type="button" className="mm-open-arrow" disabled={disabled}
        title="Выбрать, где открыть" aria-label={"Выбрать, где открыть: " + title}>
        <Icon name="ChevronDown" className="mm-action-glyph" aria-hidden />
      </button></Menu.Trigger>
      <Menu.Portal><Menu.Content className="mm-open-menu" align="end" sideOffset={4} collisionPadding={6}
        aria-label="Открыть в Mattermost">
        {(["web", "app"] as const).map(option => {
          const props = sourceLink(nav, watch.url, option);
          return <Menu.Item asChild key={option}><a {...props} onClick={event => {
            props.onClick(event);
            setOpen(false);
          }}><Icon name={icons[option]} className="mm-action-glyph" aria-hidden />{sourceTargets[option]}</a></Menu.Item>;
        })}
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </span>;
}
