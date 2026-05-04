import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { errorMessage } from '../utils/actions.js';
import { api, responseErrorMessage } from '../utils/api.js';
import { readSSE } from '../utils/sse.js';

function isAbortError(err) {
  return !!err && typeof err === 'object' && 'name' in err && err.name === 'AbortError';
}

export function useRunStream({
  appendLog,
  handlePreviewMessage,
  markDone,
  markFailed,
  markStopped,
  startLog,
  startPreview,
  stopPreview,
}) {
  const abortControllerRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(null);
  const { mutateAsync: startRun } = useMutation({
    mutationFn: ({ endpoint, body, signal }) => api.startRun(endpoint, body, signal),
  });
  const { mutate: sendStopRun } = useMutation({
    mutationFn: api.stopRun,
    onError: () => {},
  });

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
      fetchPromise: startRun({ endpoint, body, signal: controller.signal }),
    };
  }, [startRun]);

  const markRunStopped = useCallback((onDone) => {
    stopPreview();
    setRunning(false);
    setActiveStepIndex(null);
    markStopped();
    onDone({ stopped: true });
  }, [markStopped, stopPreview]);

  const handleRunMessage = useCallback((msg) => {
    if (msg.type === 'stdout' || msg.type === 'stderr') {
      appendLog(msg.text);
      return;
    }

    if (msg.type === 'step-progress') {
      setActiveStepIndex(msg.index);
      return;
    }

    handlePreviewMessage(msg);
  }, [appendLog, handlePreviewMessage]);

  const streamRun = useCallback(async (fetchPromise, { controller, onDone }) => {
    let receivedDone = false;

    startLog();
    setRunning(true);
    setActiveStepIndex(null);
    startPreview();

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
        stopPreview();
        setRunning(false);
        setActiveStepIndex(null);

        if (msg.stopped) markStopped();
        else markDone(msg.code);

        onDone(msg);
      });

      if (!receivedDone) {
        throw new Error('Run stream ended before completion');
      }
    } catch (err) {
      if (isAbortError(err)) {
        if (!receivedDone) markRunStopped(onDone);
        return;
      }

      setRunning(false);
      setActiveStepIndex(null);
      stopPreview();
      const message = errorMessage(err, 'Run failed');
      markFailed(message);
      toast.error(message);
      throw err;
    } finally {
      clearRunAbortController(controller);
    }
  }, [
    clearRunAbortController,
    handleRunMessage,
    markDone,
    markFailed,
    markRunStopped,
    markStopped,
    startLog,
    startPreview,
    stopPreview,
  ]);

  const stopRun = useCallback(() => {
    abortControllerRef.current?.abort();
    sendStopRun();
  }, [sendStopRun]);

  return {
    running,
    activeStepIndex,
    startRunRequest,
    streamRun,
    stopRun,
  };
}
