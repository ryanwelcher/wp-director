import { useCallback } from 'react';

export function useRunActions({
  blueprint,
  currentEndPause,
  currentVideoSize,
  loadRecordings,
  name,
  runDirections,
  selectedScripts,
  startFromIndex,
  startRunRequest,
  streamRun,
}) {
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

  return {
    runActions,
    recordAll,
  };
}
