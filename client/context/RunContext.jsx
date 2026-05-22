import { createContext, useCallback, useContext, useMemo } from 'react';
import { useRunActions } from '../state/useRunActions.js';
import { useRunLog } from '../state/useRunLog.js';
import { useRunPreview } from '../state/useRunPreview.js';
import { useRunStream } from '../state/useRunStream.js';
import { useAppState } from './AppStateContext.jsx';

const RunContext = createContext(null);

export function RunProvider({ children }) {
  const {
    blueprint,
    clearAllFailures,
    currentEndPause,
    currentStepPause,
    currentTypingDelay,
    currentVideoSize,
    currentHudScale,
    hudPosition,
    loadRecordings,
    markDirectionFailed,
    name,
    runDirections,
    selectedScripts,
    startFromIndex,
  } = useAppState();

  const runLog = useRunLog();
  const runPreview = useRunPreview();
  const previewMessageHandler = runPreview.handlePreviewMessage;
  const handlePreviewMessage = useCallback((msg) => {
    previewMessageHandler(msg);
  }, [previewMessageHandler]);
  const {
    activeStepIndex,
    running,
    startRunRequest,
    streamRun,
    stopRun,
  } = useRunStream({
    appendLog: runLog.appendLog,
    handlePreviewMessage,
    markDirectionFailed,
    markDone: runLog.markDone,
    markFailed: runLog.markFailed,
    markStopped: runLog.markStopped,
    startLog: runLog.startLog,
    startPreview: runPreview.startPreview,
    stopPreview: runPreview.stopPreview,
  });

  const { runActions, recordAll } = useRunActions({
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
