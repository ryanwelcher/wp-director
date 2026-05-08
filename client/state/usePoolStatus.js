import { useCallback, useEffect, useRef, useState } from 'react';

const RECONNECT_DELAY_MS = 2000;
const DEFAULT_POOL_STATUS = { warm: 0, booting: 0, total: 0, ready: false, version: -1, slots: [] };

function normalizeStatus(status) {
  return {
    ...DEFAULT_POOL_STATUS,
    ...status,
    slots: Array.isArray(status?.slots) ? status.slots : [],
  };
}

export function usePoolStatus() {
  const [status, setStatus] = useState(DEFAULT_POOL_STATUS);
  const latestVersionRef = useRef(DEFAULT_POOL_STATUS.version);

  const applyStatus = useCallback((nextStatus) => {
    setStatus((currentStatus) => {
      const resolvedStatus = typeof nextStatus === 'function'
        ? nextStatus(currentStatus)
        : nextStatus;
      const normalizedStatus = normalizeStatus(resolvedStatus);

      if (normalizedStatus.version < latestVersionRef.current) {
        return currentStatus;
      }

      latestVersionRef.current = normalizedStatus.version;
      return normalizedStatus;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source = null;
    let reconnectTimer = null;

    function connect() {
      if (cancelled) return;
      source = new EventSource('/api/pool-status/stream');

      source.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!cancelled) applyStatus(data);
        } catch {}
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [applyStatus]);

  return [status, applyStatus];
}
