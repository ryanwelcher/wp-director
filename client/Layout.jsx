import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { CommandBar } from './CommandBar.jsx';
import { DirectionToolbar } from './DirectionToolbar.jsx';
import { DirectionsPanel } from './DirectionsPanel.jsx';
import { PreviewPanel } from './PreviewPanel.jsx';
import { Sidebar } from './Sidebar.jsx';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarStyle, setSidebarStyle] = useState({});

  useEffect(() => {
    function positionSidebar() {
      const headerHeight = document.querySelector('header')?.offsetHeight ?? 0;
      setSidebarStyle({
        top: `${headerHeight}px`,
        height: `calc(100vh - ${headerHeight}px)`,
      });
    }

    positionSidebar();
    window.addEventListener('resize', positionSidebar);
    return () => window.removeEventListener('resize', positionSidebar);
  }, []);

  return (
    <>
      <button
        id="sidebar-toggle"
        className="sidebar-toggle"
        aria-expanded={sidebarOpen}
        aria-label="Toggle sidebar"
        type="button"
        onClick={() => setSidebarOpen((open) => !open)}
      >
        &#9776;
      </button>

      <div className={clsx('main-content', sidebarOpen && 'sidebar-open')}>
        <CommandBar />
        <DirectionToolbar />
        <div className="workspace">
          <DirectionsPanel />
          <PreviewPanel />
        </div>
      </div>

      <Sidebar open={sidebarOpen} style={sidebarStyle} />
    </>
  );
}
