import { useEffect, useState } from 'react';

const RECONNECT_DELAY_MS = 2000;
const DEFAULT_POOL_STATUS = { warm: 0, booting: 0, total: 0, ready: false, slots: [] };

function normalizeStatus(status) {
  return {
    ...DEFAULT_POOL_STATUS,
    ...status,
    slots: Array.isArray(status?.slots) ? status.slots : [],
  };
}

export function usePoolStatus() {
  const [status, setStatus] = useState(DEFAULT_POOL_STATUS);

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
          if (!cancelled) setStatus(normalizeStatus(data));
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
  }, []);

  return status;
}
