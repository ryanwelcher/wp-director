import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_VIDEO_SIZE_VALUE,
  endPauseMs,
  videoSizeFromValue,
  videoSizeValueFromSize,
} from '../utils/actions.js';

const DEFAULT_RUN_SETTINGS = {
  endPause: '2',
  stepPause: '0',
  typingDelay: '100',
  videoSize: DEFAULT_VIDEO_SIZE_VALUE,
};

function millisecondsFromValue(value, fallback, max) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return fallback;
  return Math.max(0, Math.min(max, Math.round(milliseconds)));
}

function secondsToMilliseconds(value, fallbackSeconds, maxSeconds) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallbackSeconds * 1000;
  return Math.max(0, Math.min(maxSeconds * 1000, Math.round(seconds * 1000)));
}

export function useRunSettingsState() {
  const [name, setName] = useState('');
  const [endPause, setEndPause] = useState(DEFAULT_RUN_SETTINGS.endPause);
  const [stepPause, setStepPause] = useState(DEFAULT_RUN_SETTINGS.stepPause);
  const [typingDelay, setTypingDelay] = useState(DEFAULT_RUN_SETTINGS.typingDelay);
  const [videoSize, setVideoSize] = useState(DEFAULT_RUN_SETTINGS.videoSize);

  const currentVideoSize = useMemo(() => videoSizeFromValue(videoSize), [videoSize]);
  const currentEndPause = useMemo(() => endPauseMs(endPause), [endPause]);
  const currentStepPause = useMemo(() => secondsToMilliseconds(stepPause, 0, 10), [stepPause]);
  const currentTypingDelay = useMemo(() => (
    millisecondsFromValue(typingDelay, Number(DEFAULT_RUN_SETTINGS.typingDelay), 1000)
  ), [typingDelay]);

  const resetScriptSettings = useCallback(() => {
    setName('');
    setEndPause(DEFAULT_RUN_SETTINGS.endPause);
    setStepPause(DEFAULT_RUN_SETTINGS.stepPause);
    setTypingDelay(DEFAULT_RUN_SETTINGS.typingDelay);
    setVideoSize(DEFAULT_RUN_SETTINGS.videoSize);
  }, []);

  const loadScriptSettings = useCallback((script) => {
    setName(script.name);
    setEndPause(((script.endPause ?? 2000) / 1000).toString());
    setStepPause(((script.stepPause ?? 0) / 1000).toString());
    setTypingDelay((script.typingDelay ?? Number(DEFAULT_RUN_SETTINGS.typingDelay)).toString());
    setVideoSize(videoSizeValueFromSize(script.videoSize));
  }, []);

  return {
    name,
    setName,
    endPause,
    setEndPause,
    currentEndPause,
    stepPause,
    setStepPause,
    currentStepPause,
    typingDelay,
    setTypingDelay,
    currentTypingDelay,
    videoSize,
    setVideoSize,
    currentVideoSize,
    resetScriptSettings,
    loadScriptSettings,
  };
}
