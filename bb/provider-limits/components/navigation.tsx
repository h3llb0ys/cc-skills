import { useState } from "react";
import {
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  experimental_SidebarNavigationIcon as NavIcon,
  experimental_Icon as Icon,
  type ExperimentalSidebarNavigationItem,
} from "@get-bb/plugin-sdk/app";
import { visibleRows } from "../model";
import { useLimits } from "../hooks/use-limits";
import { Ring } from "./ring";

function NavButton({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { actions, activeItemId, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const label = item.badge ? `${item.label}, ${item.badge.label}` : item.label;
  return (
    <button
      className="pl-nav-button"
      title={label}
      aria-label={label}
      aria-current={item.id === activeItemId ? "page" : undefined}
      disabled={item.isDisabled || item.isLoading}
      {...split.splitProps}
      onClick={(e) =>
        actions.activate(item.id, {
          target: e.metaKey || e.ctrlKey ? "split" : "current",
        })
      }
    >
      <NavIcon icon={item.icon} />
      {item.badge && <span className="pl-dot" />}
      {isShortcutModifierHeld && item.shortcut && (
        <small>{item.shortcut.label}</small>
      )}
    </button>
  );
}
export function Header() {
  const { items } = experimental_useSidebarNavigation();
  const item = items.find((i) => i.id === "__bb__/new-thread");
  return item ? (
    <div className="pl-header" data-bb-plugin="provider-limits">
      <NavButton item={item} />
    </div>
  ) : null;
}
export function Rail() {
  const { items, actions, isHomeActive } = experimental_useSidebarNavigation();
  const { options, snapshot, error } = useLimits();
  const [overflow, setOverflow] = useState(false);
  return (
    <div className="pl-rail" data-bb-plugin="provider-limits">
      <div className="pl-nav">
        <button
          className="pl-nav-button"
          title="Главная"
          aria-label="Главная"
          aria-current={isHomeActive ? "page" : undefined}
          onClick={() => actions.goHome()}
        >
          <Icon name="Home" />
        </button>
        {items
          .filter((i) => i.isVisible && i.id !== "__bb__/new-thread")
          .map((i) => (
            <NavButton key={i.id} item={i} />
          ))}
        <button
          className="pl-nav-button"
          title="Ещё"
          aria-label="Ещё"
          aria-expanded={overflow}
          onClick={() => setOverflow(!overflow)}
        >
          <Icon name="Ellipsis" />
        </button>
        {overflow && (
          <div className="pl-overflow">
            {items
              .filter((i) => !i.isVisible)
              .map((i) => (
                <NavButton key={i.id} item={i} />
              ))}
            <button
              className="pl-nav-button"
              title="Настроить навигацию"
              aria-label="Настроить навигацию"
              onClick={() => {
                setOverflow(false);
                actions.openCustomize();
              }}
            >
              <Icon name="SlidersHorizontal" />
            </button>
          </div>
        )}
      </div>
      <div className="pl-rings" aria-label="Лимиты провайдеров">
        {visibleRows(snapshot.rows, options).map((row) => (
          <Ring
            key={row.id}
            row={row}
            options={options}
            updatedAt={snapshot.updatedAt}
            error={error || snapshot.error}
          />
        ))}
        {(error || snapshot.error) && (
          <span className="pl-status" title={error || snapshot.error || ""}>
            !
          </span>
        )}
      </div>
    </div>
  );
}
