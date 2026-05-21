import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_VIDEO_SIZE_VALUE,
  endPauseMs,
  videoSizeFromValue,
  videoSizeValueFromSize,
} from '../utils/actions.js';

export const HUD_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

export const DEFAULT_RUN_SETTINGS = {
  endPause: '2',
  stepPause: '0',
  typingDelay: '100',
  videoSize: DEFAULT_VIDEO_SIZE_VALUE,
  hudScale: '1',
  hudPosition: 'bottom-center',
};

function hudScaleFromValue(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(0.25, Math.min(4, Math.round(num * 100) / 100));
}

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
  const [hudScale, setHudScale] = useState(DEFAULT_RUN_SETTINGS.hudScale);
  const [hudPosition, setHudPosition] = useState(DEFAULT_RUN_SETTINGS.hudPosition);

  const currentVideoSize = useMemo(() => videoSizeFromValue(videoSize), [videoSize]);
  const currentEndPause = useMemo(() => endPauseMs(endPause), [endPause]);
  const currentStepPause = useMemo(() => secondsToMilliseconds(stepPause, 0, 10), [stepPause]);
  const currentTypingDelay = useMemo(() => (
    millisecondsFromValue(typingDelay, Number(DEFAULT_RUN_SETTINGS.typingDelay), 1000)
  ), [typingDelay]);
  const currentHudScale = useMemo(
    () => hudScaleFromValue(hudScale, Number(DEFAULT_RUN_SETTINGS.hudScale)),
    [hudScale],
  );

  const resetRecordingSettings = useCallback(() => {
    setEndPause(DEFAULT_RUN_SETTINGS.endPause);
    setStepPause(DEFAULT_RUN_SETTINGS.stepPause);
    setTypingDelay(DEFAULT_RUN_SETTINGS.typingDelay);
    setVideoSize(DEFAULT_RUN_SETTINGS.videoSize);
    setHudScale(DEFAULT_RUN_SETTINGS.hudScale);
    setHudPosition(DEFAULT_RUN_SETTINGS.hudPosition);
  }, []);

  const resetScriptSettings = useCallback(() => {
    setName('');
    resetRecordingSettings();
  }, [resetRecordingSettings]);

  const loadScriptSettings = useCallback((script) => {
    setName(script.name);
    if (!script.recordingSettings) return;

    const { endPause, stepPause, typingDelay, videoSize, hudScale, hudPosition } = script.recordingSettings;
    if (endPause != null) setEndPause((endPause / 1000).toString());
    if (stepPause != null) setStepPause((stepPause / 1000).toString());
    if (typingDelay != null) setTypingDelay(typingDelay.toString());
    if (videoSize != null) setVideoSize(videoSizeValueFromSize(videoSize));
    if (hudScale != null) setHudScale(String(hudScale));
    if (hudPosition != null && HUD_POSITIONS.includes(hudPosition)) setHudPosition(hudPosition);
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
    hudScale,
    setHudScale,
    currentHudScale,
    hudPosition,
    setHudPosition,
    resetRecordingSettings,
    resetScriptSettings,
    loadScriptSettings,
  };
}
