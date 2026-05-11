import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from './context/AppStateContext.jsx';

const SLOT_STATUS_LABELS = {
  active: 'In use',
  booting: 'Loading',
  idle: 'Idle',
  warm: 'Ready and warm',
};

function statusLabel(status) {
  return SLOT_STATUS_LABELS[status] ?? 'Unknown';
}

function poolSlotTitle(slot) {
  const port = slot.port ? ` (port ${slot.port})` : '';
  return `Playground ${slot.index + 1}${port}: ${statusLabel(slot.status)}`;
}

function poolSlotClass(status) {
  return SLOT_STATUS_LABELS[status] ? status : 'unknown';
}

function inferredPoolSlots(poolStatus = {}) {
  if (Array.isArray(poolStatus.slots) && poolStatus.slots.length > 0) {
    return poolStatus.slots;
  }

  const total = Number(poolStatus.total) || 0;
  const warm = Number(poolStatus.warm) || 0;
  const booting = Number(poolStatus.booting) || 0;

  return Array.from({ length: total }, (_, index) => ({
    index,
    port: null,
    status: index < warm ? 'warm' : index < warm + booting ? 'booting' : 'idle',
  }));
}

export function PoolStatusIndicators({ className = '' } = {}) {
  const { poolStatus } = useAppState();
  const [poolTooltip, setPoolTooltip] = useState(null);
  const poolSlots = useMemo(() => inferredPoolSlots(poolStatus ?? {}), [poolStatus]);

  function showPoolTooltip(text, target) {
    const rect = target.getBoundingClientRect();
    const minX = 140;
    const maxX = Math.max(minX, window.innerWidth - minX);
    const centerX = rect.left + rect.width / 2;
    setPoolTooltip({
      text,
      left: Math.min(Math.max(centerX, minX), maxX),
      top: rect.top - 8,
    });
  }

  function hidePoolTooltip() {
    setPoolTooltip(null);
  }

  if (poolSlots.length === 0) return null;

  return (
    <>
      <span className={`blueprint-pool-indicators${className ? ` ${className}` : ''}`} aria-label="Playground pool status">
        {poolSlots.map((slot) => {
          const title = poolSlotTitle(slot);
          return (
            <span
              key={slot.port ?? slot.index}
              className={`blueprint-pool-indicator blueprint-pool-indicator--${poolSlotClass(slot.status)}`}
              aria-label={title}
              role="img"
              onMouseEnter={(event) => showPoolTooltip(title, event.currentTarget)}
              onMouseLeave={hidePoolTooltip}
            />
          );
        })}
      </span>
      {poolTooltip && createPortal(
        <div
          className="blueprint-pool-tooltip"
          role="tooltip"
          style={{
            left: `${poolTooltip.left}px`,
            top: `${poolTooltip.top}px`,
          }}
        >
          {poolTooltip.text}
        </div>,
        document.body,
      )}
    </>
  );
}
