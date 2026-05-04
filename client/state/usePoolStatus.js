import { useEffect, useState } from 'react';
import { api } from '../utils/api.js';

const POLL_INTERVAL_MS = 3000;

export function usePoolStatus() {
  const [status, setStatus] = useState({ warm: 0, booting: 0, total: 0, ready: false });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await api.getPoolStatus();
        if (!cancelled) setStatus(data);
      } catch {}
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
