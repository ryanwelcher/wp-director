import { useCallback, useMemo, useState } from 'react';
import { endPauseMs, videoSizeFromValue } from '../utils/actions.js';

export function useRunSettingsState() {
  const [name, setName] = useState('');
  const [endPause, setEndPause] = useState('2');
  const [videoSize, setVideoSize] = useState('1920x1080');

  const currentVideoSize = useMemo(() => videoSizeFromValue(videoSize), [videoSize]);
  const currentEndPause = useMemo(() => endPauseMs(endPause), [endPause]);

  const resetScriptSettings = useCallback(() => {
    setName('');
    setEndPause('2');
  }, []);

  const loadScriptSettings = useCallback((script) => {
    setName(script.name);
    setEndPause(((script.endPause ?? 2000) / 1000).toString());
  }, []);

  return {
    name,
    setName,
    endPause,
    setEndPause,
    currentEndPause,
    videoSize,
    setVideoSize,
    currentVideoSize,
    resetScriptSettings,
    loadScriptSettings,
  };
}
