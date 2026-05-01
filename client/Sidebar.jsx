import { BlueprintPanel } from './Sidebar/BlueprintPanel.jsx';
import { DirectionLibraryPanel } from './Sidebar/DirectionLibraryPanel.jsx';
import { LogPanel } from './Sidebar/LogPanel.jsx';
import { RecordingsPanel } from './Sidebar/RecordingsPanel.jsx';
import { SavedScriptsPanel } from './Sidebar/SavedScriptsPanel.jsx';

export function Sidebar({ open, style }) {
  return (
    <div id="right-sidebar" className={`right-sidebar${open ? ' open' : ''}`} aria-label="Tools sidebar" style={style}>
      <div className="sidebar-content">
        <SavedScriptsPanel />
        <DirectionLibraryPanel />
        <RecordingsPanel />
        <BlueprintPanel />
        <LogPanel />
      </div>
    </div>
  );
}
