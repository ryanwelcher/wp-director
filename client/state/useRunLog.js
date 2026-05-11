import clsx from 'clsx';
import { useCallback, useState } from 'react';

export function useRunLog() {
  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState('');
  const [logBadge, setLogBadge] = useState({ text: 'recording', className: 'badge hidden' });

  const startLog = useCallback(() => {
    setLogText('');
    setLogOpen(true);
    setLogBadge({ text: 'recording', className: 'badge' });
  }, []);

  const appendLog = useCallback((text) => {
    setLogText((current) => `${current}${text}`);
  }, []);

  const markStopped = useCallback(() => {
    setLogText((current) => `${current}\n--- Stopped ---\n`);
    setLogBadge({ text: 'stopped', className: 'badge badge-fail' });
  }, []);

  const markDone = useCallback((code) => {
    setLogText((current) => `${current}\n--- Done (exit ${code}) ---\n`);
    setLogBadge({
      text: code === 0 ? 'complete' : 'failed',
      className: clsx('badge', code === 0 ? 'badge-pass' : 'badge-fail'),
    });
  }, []);

  const markFailed = useCallback((message) => {
    setLogText((current) => `${current}\n--- Failed ---\n${message}\n`);
    setLogBadge({ text: 'failed', className: 'badge badge-fail' });
  }, []);

  return {
    logOpen,
    setLogOpen,
    logText,
    logBadge,
    startLog,
    appendLog,
    markStopped,
    markDone,
    markFailed,
  };
}
