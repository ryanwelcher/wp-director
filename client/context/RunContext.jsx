import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRunActions } from '../state/useRunActions.js';
import { useRunLog } from '../state/useRunLog.js';
import { useRunPreview } from '../state/useRunPreview.js';
import { useRunStream } from '../state/useRunStream.js';
import { useAppState } from './AppStateContext.jsx';
import { queryKeys } from '../utils/api.js';

const RunContext = createContext(null);

export function RunProvider({ children }) {
  const {
    blueprint,
    currentEndPause,
    currentStepPause,
    currentTypingDelay,
    currentVideoSize,
    loadRecordings,
    name,
    runDirections,
    selectedScripts,
    startFromIndex,
  } = useAppState();

  const runLog = useRunLog();
  const runPreview = useRunPreview();
  const queryClient = useQueryClient();
  const handlePreviewMessage = useCallback((msg) => {
    if (msg.type === 'previewArtifact') {
      queryClient.invalidateQueries({ queryKey: queryKeys.previews });
      return;
    }
    runPreview.handlePreviewMessage(msg);
  }, [queryClient, runPreview]);
  const {
    activeStepIndex,
    running,
    startRunRequest,
    streamRun,
    stopRun,
  } = useRunStream({
    appendLog: runLog.appendLog,
    handlePreviewMessage,
    markDone: runLog.markDone,
    markFailed: runLog.markFailed,
    markStopped: runLog.markStopped,
    startLog: runLog.startLog,
    startPreview: runPreview.startPreview,
    stopPreview: runPreview.stopPreview,
  });

  const { runActions, recordAll } = useRunActions({
    blueprint,
    currentEndPause,
    currentStepPause,
    currentTypingDelay,
    currentVideoSize,
    loadRecordings,
    name,
    runDirections,
    selectedScripts,
    startFromIndex,
    startRunRequest,
    streamRun,
  });

  const value = useMemo(() => ({
    running,
    activeStepIndex,
    logOpen: runLog.logOpen,
    setLogOpen: runLog.setLogOpen,
    logText: runLog.logText,
    logBadge: runLog.logBadge,
    preview: runPreview.preview,
    showPreviewVideo: runPreview.showPreviewVideo,
    runActions,
    recordAll,
    stopRun,
  }), [
    recordAll,
    activeStepIndex,
    runActions,
    runLog.logBadge,
    runLog.logOpen,
    runLog.logText,
    runLog.setLogOpen,
    runPreview.preview,
    runPreview.showPreviewVideo,
    running,
    stopRun,
  ]);

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
