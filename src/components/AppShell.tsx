/** App frame: top bar, rail, workspace, detail panel, and the mobile chrome. */

import type { ReactNode } from 'react';

import { useMediaQuery } from '../state/hooks';

/** THE breakpoint. Regions are mounted conditionally, not hidden with CSS. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 860px)');
}

interface AppShellProps {
  topbar: ReactNode;
  rail?: ReactNode;
  panel?: ReactNode;
  tabbar?: ReactNode;
  fab?: ReactNode;
  children: ReactNode;
}

export function AppShell({ topbar, rail, panel, tabbar, fab, children }: AppShellProps) {
  const isMobile = useIsMobile();

  return (
    <div className="app">
      <header className="topbar">{topbar}</header>
      <div className="app__body">
        {!isMobile && rail}
        <main className="workspace">{children}</main>
        {!isMobile && panel}
      </div>
      {isMobile && tabbar}
      {isMobile && fab}
    </div>
  );
}
