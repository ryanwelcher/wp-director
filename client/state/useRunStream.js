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
  const onDoneRef = useRef(null);
  const runIdRef = useRef(0);
  const stoppedRunIdRef = useRef(null);
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

  const markRunStopped = useCallback((onDone = onDoneRef.current, runId = runIdRef.current) => {
    if (runId !== runIdRef.current || stoppedRunIdRef.current === runId) return;
    stoppedRunIdRef.current = runId;
    stopPreview();
    setRunning(false);
    setActiveStepIndex(null);
    markStopped();
    onDone?.({ stopped: true });
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
    const runId = runIdRef.current + 1;

    runIdRef.current = runId;
    onDoneRef.current = onDone;
    stoppedRunIdRef.current = null;
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
        if (runId !== runIdRef.current) return;
        if (msg.type !== 'done') {
          handleRunMessage(msg);
          return;
        }

        receivedDone = true;
        clearRunAbortController(controller);
        onDoneRef.current = null;

        if (stoppedRunIdRef.current === runId) return;
        stopPreview();
        setRunning(false);
        setActiveStepIndex(null);
        handlePreviewMessage(msg);

        if (msg.stopped) markStopped();
        else markDone(msg.code);

        onDone(msg);
      });

      if (!receivedDone) {
        if (runId !== runIdRef.current || stoppedRunIdRef.current === runId) return;
        throw new Error('Run stream ended before completion');
      }
    } catch (err) {
      if (runId !== runIdRef.current) return;

      if (isAbortError(err)) {
        if (!receivedDone) markRunStopped(onDone, runId);
        return;
      }

      if (stoppedRunIdRef.current === runId) return;
      setRunning(false);
      setActiveStepIndex(null);
      stopPreview();
      const message = errorMessage(err, 'Run failed');
      markFailed(message);
      toast.error(message);
      throw err;
    } finally {
      clearRunAbortController(controller);
      if (runId === runIdRef.current && abortControllerRef.current === null) onDoneRef.current = null;
    }
  }, [
    clearRunAbortController,
    handlePreviewMessage,
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
    const runId = runIdRef.current;
    markRunStopped(undefined, runId);
    abortControllerRef.current?.abort();
    sendStopRun();
  }, [markRunStopped, sendStopRun]);

  return {
    running,
    activeStepIndex,
    startRunRequest,
    streamRun,
    stopRun,
  };
}
