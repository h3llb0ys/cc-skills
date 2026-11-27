import { useEffect, useState } from 'react';
import { experimental_useRpcKeyedQuery, useSettings } from '@get-bb/plugin-sdk/app';
import { rpc } from './contract';
import { decorateSidebar } from './sidebar-rows';

function VisibleSidebarBadges() {
  const [keys, setKeys] = useState<string[]>([]);
  const [decorator, setDecorator] = useState<ReturnType<typeof decorateSidebar>>();
  const { data } = experimental_useRpcKeyedQuery({ contract: rpc, method: 'snapshot', keys });
  useEffect(() => {
    const sidebar = decorateSidebar(document, setKeys);
    setDecorator(sidebar);
    return () => sidebar.dispose();
  }, []);
  useEffect(() => decorator?.update(data ?? {}), [decorator, data]);
  return null;
}

export function SidebarBadges() {
  const { values } = useSettings();
  return values?.showSidebarBadges === true ? <VisibleSidebarBadges /> : null;
}
