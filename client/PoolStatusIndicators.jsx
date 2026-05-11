import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from './context/AppStateContext.jsx';

const SLOT_STATUS_LABELS = {
  active: 'In use',
  booting: 'Loading',
  idle: 'Idle',
  warm: 'Ready and warm',
};

const SLOT_STATUS_CLASS_NAMES = {
  active: 'blueprint-pool-indicator blueprint-pool-indicator--active',
  booting: 'blueprint-pool-indicator blueprint-pool-indicator--booting',
  idle: 'blueprint-pool-indicator blueprint-pool-indicator--idle',
  warm: 'blueprint-pool-indicator blueprint-pool-indicator--warm',
  unknown: 'blueprint-pool-indicator blueprint-pool-indicator--unknown',
};

function statusLabel(status) {
  return SLOT_STATUS_LABELS[status] ?? 'Unknown';
}

function poolSlotTitle(slot) {
  const port = slot.port ? ` (port ${slot.port})` : '';
  return `Playground ${slot.index + 1}${port}: ${statusLabel(slot.status)}`;
}

function poolSlotClassName(status) {
  return SLOT_STATUS_CLASS_NAMES[status] ?? SLOT_STATUS_CLASS_NAMES.unknown;
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

export function PoolStatusIndicators({ tab = false } = {}) {
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
      <span className={clsx('blueprint-pool-indicators', tab && 'blueprint-pool-indicators--tab')} aria-label="Playground pool status">
        {poolSlots.map((slot) => {
          const title = poolSlotTitle(slot);
          return (
            <span
              key={slot.port ?? slot.index}
              className={poolSlotClassName(slot.status)}
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
