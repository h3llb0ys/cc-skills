import { useLayoutEffect, useRef } from "react";
import { experimental_useRpcQuery, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { contract } from "../contract";
import { preferredSourceTarget, sourceBase, sourceLink } from "./open-source";

export function MessageLinks() {
  const settings = useSettings();
  const target = preferredSourceTarget(settings.values?.openTarget);
  const { data: server, isLoading } = experimental_useRpcQuery({ contract, method: "sourceServer", input: null });
  const nav = useBbNavigate();
  const waiting = settings.isLoading || isLoading;
  const pending = useRef(new Map<HTMLAnchorElement, string>());
  useLayoutEffect(() => {
    const base = server && URL.canParse(server) ? new URL(server) : null;
    const trustedBase = base?.href.replace(/\/$/, "");
    function follow(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== (event.type === "auxclick" ? 1 : 0)) return;
      const anchor = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("[data-message-column] [data-markdown-preview] a[href]") : null;
      if (!anchor || anchor.protocol !== "https:" || anchor.username || anchor.password) return;
      const origin = sourceBase(anchor.href);
      if (!origin || (base && origin !== trustedBase)) return;
      if (waiting) {
        // A visible old message can be clicked before BB loads the setting.
        // Replay the ordinary click once its destination is known.
        if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          pending.current.set(anchor, anchor.href);
        }
        return;
      }
      if (!base) return;

      const link = sourceLink(nav, anchor.href, target);
      // BB's Markdown click handler closes over the original HTTPS permalink.
      event.stopPropagation();
      if (event.button === 0) link.onClick(event);
      if (event.defaultPrevented || link.href === anchor.href) return;

      // Keep the trusted native click when the host hands off to the OS.
      // Restore the shareable HTTPS address after the browser's default action.
      const href = anchor.getAttribute("href")!;
      const previousTarget = anchor.getAttribute("target");
      anchor.href = link.href;
      anchor.removeAttribute("target");
      window.setTimeout(() => {
        if (anchor.getAttribute("href") !== link.href) return;
        anchor.setAttribute("href", href);
        if (previousTarget !== null) anchor.setAttribute("target", previousTarget);
      }, 0);
    }
    document.addEventListener("click", follow, true);
    document.addEventListener("auxclick", follow, true);
    if (!waiting) {
      for (const [anchor, href] of pending.current) {
        pending.current.delete(anchor);
        if (anchor.isConnected && anchor.href === href) anchor.click();
      }
    }
    return () => {
      document.removeEventListener("click", follow, true);
      document.removeEventListener("auxclick", follow, true);
    };
  }, [nav, server, waiting, target]);
  return null;
}
