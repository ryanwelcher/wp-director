import { useCallback } from 'react';

export function useRunActions({
  blueprint,
  clearAllFailures,
  currentEndPause,
  currentStepPause,
  currentTypingDelay,
  currentVideoSize,
  currentHudScale,
  hudPosition,
  loadRecordings,
  name,
  runDirections,
  selectedScripts,
  startFromIndex,
  startRunRequest,
  streamRun,
}) {
  const runActions = useCallback(async ({ scriptName } = {}) => {
    if (!runDirections.length) return;
    // Reset failure markers before this run; the runner will re-emit
    // step-error for any direction that fails this time around.
    clearAllFailures?.();

    const runName = scriptName?.trim() || name.trim() || `play-${Date.now()}`;
    const body = {
      name: runName,
      actions: runDirections,
      blueprint,
      videoSize: currentVideoSize,
      endPause: currentEndPause,
      stepPause: currentStepPause,
      typingDelay: currentTypingDelay,
      hudScale: currentHudScale,
      hudPosition,
    };

    if (startFromIndex != null && startFromIndex > 0) {
      body.startFrom = startFromIndex;
    }

    const { fetchPromise, controller } = startRunRequest('/api/run', body);
    await streamRun(fetchPromise, {
      controller,
      onDone: () => {},
    });
  }, [
    blueprint,
    clearAllFailures,
    currentEndPause,
    currentStepPause,
    currentTypingDelay,
    currentVideoSize,
    currentHudScale,
    hudPosition,
    loadRecordings,
    name,
    runDirections,
    startFromIndex,
    startRunRequest,
    streamRun,
  ]);

  const recordAll = useCallback(async () => {
    if (!selectedScripts.length) return;
    clearAllFailures?.();

    const { fetchPromise, controller } = startRunRequest('/api/run/batch', {
      names: selectedScripts,
      blueprint,
      endPause: currentEndPause,
      stepPause: currentStepPause,
      typingDelay: currentTypingDelay,
      videoSize: currentVideoSize,
      hudScale: currentHudScale,
      hudPosition,
    });

    await streamRun(fetchPromise, {
      controller,
      onDone: (msg) => {
        if (!msg.stopped) loadRecordings();
      },
    });
  }, [
    blueprint,
    clearAllFailures,
    currentEndPause,
    currentStepPause,
    currentTypingDelay,
    currentVideoSize,
    currentHudScale,
    hudPosition,
    loadRecordings,
    selectedScripts,
    startRunRequest,
    streamRun,
  ]);

  return {
    runActions,
    recordAll,
  };
}
