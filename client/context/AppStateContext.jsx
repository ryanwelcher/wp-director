import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
  directionsForJSON,
  directionsForRun,
  endPauseMs,
  errorMessage,
  normalizeDirections,
  videoSizeFromValue,
} from '../utils/actions.js';
import { fetchJSON } from '../utils/api.js';

const AppStateContext = createContext(null);

function remapMovedIndex(index, from, to) {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

export function AppStateProvider({ children }) {
  const [directions, setDirections] = useState([]);
  const [name, setName] = useState('');
  const [endPause, setEndPause] = useState('2');
  const [videoSize, setVideoSize] = useState('1920x1080');
  const [blueprint, setBlueprint] = useState(null);
  const [defaultBlueprint, setDefaultBlueprint] = useState(null);
  const [savedScripts, setSavedScripts] = useState([]);
  const [selectedScripts, setSelectedScripts] = useState([]);
  const [libraryEntries, setLibraryEntries] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [startFromIndex, setStartFromIndex] = useState(null);
  const [alwaysRunIndices, setAlwaysRunIndices] = useState(() => new Set());
  const [directionsView, setDirectionsView] = useState('actions');

  const runDirections = useMemo(
    () => directionsForRun(directions, alwaysRunIndices),
    [directions, alwaysRunIndices]
  );

  const cleanDirections = useMemo(() => directionsForJSON(directions), [directions]);

  const isBlueprintModified = useMemo(() => (
    !!defaultBlueprint && JSON.stringify(blueprint) !== JSON.stringify(defaultBlueprint)
  ), [blueprint, defaultBlueprint]);

  const currentVideoSize = useMemo(() => videoSizeFromValue(videoSize), [videoSize]);
  const currentEndPause = useMemo(() => endPauseMs(endPause), [endPause]);

  const loadSavedScripts = useCallback(async () => {
    try {
      const data = await fetchJSON('/api/scripts');
      const scripts = data?.scripts ?? [];
      setSavedScripts(scripts);
      setSelectedScripts((current) => current.filter((name) => scripts.some((script) => script.name === name)));
    } catch {
      setSavedScripts([]);
    }
  }, []);

  const loadDirectionLibrary = useCallback(async () => {
    try {
      const data = await fetchJSON('/api/directions');
      setLibraryEntries(data?.directions ?? []);
    } catch {
      setLibraryEntries([]);
    }
  }, []);

  const loadRecordings = useCallback(async () => {
    try {
      const data = await fetchJSON('/api/recordings');
      setRecordings(data?.recordings ?? []);
    } catch {
      setRecordings([]);
    }
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([
      fetchJSON('/api/default-blueprint'),
      fetchJSON('/api/current-blueprint').catch(() => null),
    ]).then(([defaultRes, currentRes]) => {
      if (!active) return;
      const nextDefault = defaultRes?.blueprint ?? null;
      setDefaultBlueprint(nextDefault);
      setBlueprint(currentRes?.blueprint ?? nextDefault);
    }).catch((err) => {
      toast.error(errorMessage(err, 'Could not load blueprint'));
    });

    loadSavedScripts();
    loadDirectionLibrary();
    loadRecordings();

    return () => { active = false; };
  }, [loadDirectionLibrary, loadRecordings, loadSavedScripts]);

  const resetRunMarkers = useCallback(() => {
    setStartFromIndex(null);
    setAlwaysRunIndices(new Set());
  }, []);

  const replaceDirections = useCallback((raw) => {
    setDirections(normalizeDirections(raw));
    resetRunMarkers();
  }, [resetRunMarkers]);

  const clearDirections = useCallback(() => {
    setDirections([]);
    setName('');
    setEndPause('2');
    resetRunMarkers();
  }, [resetRunMarkers]);

  const updateDirectionLabel = useCallback((index, label) => {
    setDirections((current) => current.map((direction, i) => (
      i === index ? { ...direction, label } : direction
    )));
  }, []);

  const toggleDirectionOpen = useCallback((index) => {
    setDirections((current) => current.map((direction, i) => (
      i === index ? { ...direction, _open: !direction._open } : direction
    )));
  }, []);

  const deleteDirection = useCallback((index) => {
    setDirections((current) => current.filter((_, i) => i !== index));
    setStartFromIndex((current) => {
      if (current == null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
    setAlwaysRunIndices((current) => new Set([...current]
      .filter((i) => i !== index)
      .map((i) => (i > index ? i - 1 : i))));
  }, []);

  const insertDirectionAt = useCallback((direction, index) => {
    setDirections((current) => {
      const insertIndex = Math.max(0, Math.min(index ?? current.length, current.length));
      return [
        ...current.slice(0, insertIndex),
        direction,
        ...current.slice(insertIndex),
      ];
    });
    setStartFromIndex((current) => (current != null && current >= index ? current + 1 : current));
    setAlwaysRunIndices((current) => new Set([...current].map((i) => (i >= index ? i + 1 : i))));
  }, []);

  const reorderDirections = useCallback((from, to) => {
    if (from === to) return;
    setDirections((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setStartFromIndex((current) => (
      current == null ? null : remapMovedIndex(current, from, to)
    ));
    setAlwaysRunIndices((current) => new Set([...current].map((index) => remapMovedIndex(index, from, to))));
  }, []);

  const toggleStartFrom = useCallback((index) => {
    setStartFromIndex((current) => (current === index ? null : index));
  }, []);

  const toggleAlwaysRun = useCallback((index) => {
    setAlwaysRunIndices((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const loadScriptIntoEditor = useCallback((script) => {
    setDirections(normalizeDirections(script.directions ?? script.actions ?? script.steps ?? []));
    setName(script.name);
    setEndPause(((script.endPause ?? 2000) / 1000).toString());
    resetRunMarkers();
  }, [resetRunMarkers]);

  const value = useMemo(() => ({
    directions,
    setDirections,
    cleanDirections,
    runDirections,
    name,
    setName,
    endPause,
    setEndPause,
    currentEndPause,
    videoSize,
    setVideoSize,
    currentVideoSize,
    blueprint,
    setBlueprint,
    defaultBlueprint,
    setDefaultBlueprint,
    isBlueprintModified,
    savedScripts,
    selectedScripts,
    setSelectedScripts,
    libraryEntries,
    recordings,
    startFromIndex,
    alwaysRunIndices,
    directionsView,
    setDirectionsView,
    loadSavedScripts,
    loadDirectionLibrary,
    loadRecordings,
    replaceDirections,
    clearDirections,
    updateDirectionLabel,
    toggleDirectionOpen,
    deleteDirection,
    insertDirectionAt,
    reorderDirections,
    toggleStartFrom,
    toggleAlwaysRun,
    loadScriptIntoEditor,
  }), [
    alwaysRunIndices,
    blueprint,
    cleanDirections,
    clearDirections,
    currentEndPause,
    currentVideoSize,
    defaultBlueprint,
    deleteDirection,
    directions,
    directionsView,
    endPause,
    insertDirectionAt,
    isBlueprintModified,
    libraryEntries,
    loadDirectionLibrary,
    loadRecordings,
    loadSavedScripts,
    loadScriptIntoEditor,
    name,
    recordings,
    replaceDirections,
    reorderDirections,
    runDirections,
    savedScripts,
    selectedScripts,
    startFromIndex,
    toggleAlwaysRun,
    toggleDirectionOpen,
    toggleStartFrom,
    updateDirectionLabel,
    videoSize,
  ]);

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
