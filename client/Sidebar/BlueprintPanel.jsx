import { useState } from 'react';
import { useAppState } from '../context/AppStateContext.jsx';
import { BlueprintConfigOverlay } from '../BlueprintConfigOverlay.jsx';
import { SectionBadge } from './SectionBadge.jsx';

function getBlueprintSummary(blueprint) {
  if (!blueprint) return 'No blueprint loaded';
  const plugins = (blueprint.steps ?? []).filter((s) => s.step === 'installPlugin').length;
  const themes = (blueprint.steps ?? []).filter((s) => s.step === 'installTheme').length;
  const wp = blueprint.preferredVersions?.wp;
  const parts = [];
  if (plugins > 0) parts.push(`${plugins} plugin${plugins === 1 ? '' : 's'}`);
  if (themes > 0) parts.push(`${themes} theme${themes === 1 ? '' : 's'}`);
  if (wp && wp !== 'latest') parts.push(`WP ${wp}`);
  return parts.length > 0 ? parts.join(', ') : 'Default configuration';
}

export function BlueprintPanel() {
  const { blueprint, isBlueprintModified } = useAppState();
  const [overlayOpen, setOverlayOpen] = useState(false);

  return (
    <>
      <details id="blueprint-section">
        <summary>
          <span>Environment / Blueprint</span>
          <SectionBadge hidden={!isBlueprintModified}>custom</SectionBadge>
        </summary>
        <div className="blueprint-body">
          <p className="blueprint-summary">{getBlueprintSummary(blueprint)}</p>
          <button
            className="configure-blueprint-btn"
            type="button"
            onClick={() => setOverlayOpen(true)}
          >
            Configure Blueprint
          </button>
        </div>
      </details>
      {overlayOpen && (
        <BlueprintConfigOverlay onClose={() => setOverlayOpen(false)} />
      )}
    </>
  );
}
