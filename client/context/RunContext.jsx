import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { errorMessage } from '../utils/actions.js';
import { responseErrorMessage } from '../utils/api.js';
import { readSSE } from '../utils/sse.js';
import { useAppState } from './AppStateContext.jsx';

const RunContext = createContext(null);

function isAbortError(err) {
  return !!err && typeof err === 'object' && 'name' in err && err.name === 'AbortError';
}

export function RunProvider({ children }) {
  const {
    blueprint,
    currentEndPause,
    currentVideoSize,
    loadRecordings,
    name,
    runDirections,
    selectedScripts,
    startFromIndex,
  } = useAppState();

  const abortControllerRef = useRef(null);
  const lastScreencastVideoRef = useRef('');
  const [running, setRunning] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState('');
  const [logBadge, setLogBadge] = useState({ text: 'recording', className: 'badge hidden' });
  const [preview, setPreview] = useState({
    mode: 'idle',
    imageSrc: '',
    videoSrc: '',
    poster: '',
  });

  const startScreencast = useCallback(() => {
    lastScreencastVideoRef.current = '';
    setPreview({ mode: 'connecting', imageSrc: '', videoSrc: '', poster: '' });
  }, []);

  const stopScreencast = useCallback(() => {
    const videoSrc = lastScreencastVideoRef.current;
    setPreview((current) => (
      videoSrc
        ? { mode: 'video', imageSrc: '', videoSrc, poster: current.imageSrc }
        : { mode: 'idle', imageSrc: '', videoSrc: '', poster: '' }
    ));
  }, []);

  const clearRunAbortController = useCallback((controller) => {
    if (controller && abortControllerRef.current === controller) {
      abortControllerRef.current = null;
    }
  }, []);

  const startRunRequest = useCallback((endpoint, body) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    return {
      controller,
      fetchPromise: fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body),
      }),
    };
  }, []);

  const markStopped = useCallback(() => {
    stopScreencast();
    setRunning(false);
    setLogText((current) => `${current}\n--- Stopped ---\n`);
    setLogBadge({ text: 'stopped', className: 'badge badge-fail' });
  }, [stopScreencast]);

  const handleRunMessage = useCallback((msg) => {
    if (msg.type === 'stdout' || msg.type === 'stderr') {
      setLogText((current) => `${current}${msg.text}`);
      return;
    }

    if (msg.type === 'screencast') {
      setPreview({
        mode: 'image',
        imageSrc: `data:image/jpeg;base64,${msg.data}`,
        videoSrc: '',
        poster: '',
      });
      return;
    }

    if (msg.type === 'screencastVideo') {
      lastScreencastVideoRef.current = msg.uri;
    }
  }, []);

  const streamRun = useCallback(async (fetchPromise, { controller, onDone }) => {
    let receivedDone = false;

    setLogText('');
    setLogOpen(true);
    setLogBadge({ text: 'recording', className: 'badge' });
    setRunning(true);
    startScreencast();

    try {
      const res = await fetchPromise;
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res));
      }

      await readSSE(res, (msg) => {
        handleRunMessage(msg);
        if (msg.type !== 'done') return;

        receivedDone = true;
        clearRunAbortController(controller);
        stopScreencast();
        setRunning(false);

        if (msg.stopped) {
          setLogText((current) => `${current}\n--- Stopped ---\n`);
          setLogBadge({ text: 'stopped', className: 'badge badge-fail' });
        } else {
          setLogText((current) => `${current}\n--- Done (exit ${msg.code}) ---\n`);
          setLogBadge({
            text: msg.code === 0 ? 'complete' : 'failed',
            className: `badge${msg.code === 0 ? ' badge-pass' : ' badge-fail'}`,
          });
        }

        onDone(msg);
      });

      if (!receivedDone) {
        throw new Error('Run stream ended before completion');
      }
    } catch (err) {
      if (isAbortError(err)) {
        if (!receivedDone) {
          markStopped();
          onDone({ stopped: true });
        }
        return;
      }

      setRunning(false);
      stopScreencast();
      const message = errorMessage(err, 'Run failed');
      setLogText((current) => `${current}\n--- Failed ---\n${message}\n`);
      setLogBadge({ text: 'failed', className: 'badge badge-fail' });
      toast.error(message);
      throw err;
    } finally {
      clearRunAbortController(controller);
    }
  }, [clearRunAbortController, handleRunMessage, markStopped, startScreencast, stopScreencast]);

  const runActions = useCallback(async ({ preview: previewOnly = false } = {}) => {
    if (!runDirections.length) return;

    const runName = name.trim() || `${previewOnly ? 'preview' : 'recording'}-${Date.now()}`;
    const body = {
      name: runName,
      actions: runDirections,
      blueprint,
      videoSize: previewOnly ? null : currentVideoSize,
      preview: previewOnly || undefined,
      endPause: previewOnly ? undefined : currentEndPause,
    };

    if (previewOnly && startFromIndex != null && startFromIndex > 0) {
      body.startFrom = startFromIndex;
    }

    const { fetchPromise, controller } = startRunRequest('/api/run', body);
    await streamRun(fetchPromise, {
      controller,
      onDone: (msg) => {
        if (!msg.stopped && !previewOnly) loadRecordings();
      },
    });
  }, [
    blueprint,
    currentEndPause,
    currentVideoSize,
    loadRecordings,
    name,
    runDirections,
    startFromIndex,
    startRunRequest,
    streamRun,
  ]);

  const recordAll = useCallback(async () => {
    if (!selectedScripts.length) return;

    const { fetchPromise, controller } = startRunRequest('/api/run/batch', {
      names: selectedScripts,
      blueprint,
      videoSize: currentVideoSize,
    });

    await streamRun(fetchPromise, {
      controller,
      onDone: (msg) => {
        if (!msg.stopped) loadRecordings();
      },
    });
  }, [blueprint, currentVideoSize, loadRecordings, selectedScripts, startRunRequest, streamRun]);

  const stopRun = useCallback(() => {
    abortControllerRef.current?.abort();
    fetch('/api/stop', { method: 'POST' }).catch(() => {});
  }, []);

  const value = useMemo(() => ({
    running,
    logOpen,
    setLogOpen,
    logText,
    logBadge,
    preview,
    runActions,
    recordAll,
    stopRun,
  }), [logBadge, logOpen, logText, preview, recordAll, runActions, running, stopRun]);

  return (
    <RunContext.Provider value={value}>
      {children}
    </RunContext.Provider>
  );
}

export function useRunState() {
  const value = useContext(RunContext);
  if (!value) throw new Error('useRunState must be used inside RunProvider');
  return value;
}
