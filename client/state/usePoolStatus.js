import { useEffect, useState } from 'react';

const RECONNECT_DELAY_MS = 2000;

export function usePoolStatus() {
  const [status, setStatus] = useState({ warm: 0, booting: 0, total: 0, ready: false });

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
          if (!cancelled) setStatus(data);
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

  return [status, setStatus];
}
