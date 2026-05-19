import { useCallback, useMemo, useState } from 'react';
import {
  directionsForJSON,
  directionsForRun,
  normalizeDirections,
  withDirectionId,
} from '../utils/actions.js';

function remapMovedIndex(index, from, to) {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

function pendingDirection(command, label = command) {
  return withDirectionId({
    label,
    actions: [],
    _translation: {
      status: 'pending',
      command,
      createdAt: Date.now(),
    },
  });
}

function translatedDirections(raw, command, { freeForm = false } = {}) {
  return normalizeDirections(raw).map((direction) => ({
    ...direction,
    ...(freeForm ? { _freeForm: true } : {}),
    _translation: {
      status: 'resolved',
      command,
      resolvedAt: Date.now(),
    },
  }));
}

export function useDirectionsState() {
  const [directions, setDirections] = useState([]);
  const [startFromIndex, setStartFromIndex] = useState(null);
  const [alwaysRunIndices, setAlwaysRunIndices] = useState(() => new Set());
  const [directionsView, setDirectionsView] = useState('actions');

  const runDirections = useMemo(
    () => directionsForRun(directions, alwaysRunIndices),
    [directions, alwaysRunIndices]
  );

  const cleanDirections = useMemo(() => directionsForJSON(directions), [directions]);

  const resetRunMarkers = useCallback(() => {
    setStartFromIndex(null);
    setAlwaysRunIndices(new Set());
  }, []);

  const replaceDirections = useCallback((raw) => {
    setDirections(normalizeDirections(raw));
    resetRunMarkers();
  }, [resetRunMarkers]);

  const appendDirections = useCallback((raw) => {
    const nextDirections = normalizeDirections(raw);
    setDirections((current) => [...current, ...nextDirections]);
    return nextDirections;
  }, []);

  const appendPendingDirection = useCallback((command) => {
    const direction = pendingDirection(command);
    setDirections((current) => [...current, direction]);
    return direction;
  }, []);

  const replaceWithPendingDirection = useCallback((index, label, command) => {
    if (index < 0 || index >= directions.length) return null;

    const direction = pendingDirection(command, label);
    setDirections((current) => current.map((item, i) => (
      i === index ? direction : item
    )));
    return direction;
  }, [directions.length]);

  const resolvePendingDirection = useCallback((id, raw, command, replaceIndex = null, options = {}) => {
    const nextDirections = translatedDirections(raw, command, options);
    const delta = nextDirections.length - 1;

    setDirections((current) => current.flatMap((direction) => (
      direction._id === id ? nextDirections : [direction]
    )));

    if (replaceIndex != null && delta !== 0) {
      setStartFromIndex((current) => {
        if (current == null || current <= replaceIndex) return current;
        return current + delta;
      });
      setAlwaysRunIndices((current) => new Set([...current].map((i) => (i > replaceIndex ? i + delta : i))));
    }

    return nextDirections;
  }, []);

  const resolveUnmatchedDirection = useCallback((id, originalText) => {
    setDirections((current) => current.map((direction) => (
      direction._id === id
        ? {
            ...direction,
            _translation: {
              ...(direction._translation || {}),
              status: 'unmatched',
              command: originalText,
              unmatchedAt: Date.now(),
            },
          }
        : direction
    )));
  }, []);

  const failPendingDirection = useCallback((id, err) => {
    setDirections((current) => current.map((direction) => (
      direction._id === id
        ? {
            ...direction,
            _translation: {
              ...direction._translation,
              status: 'error',
              error: err instanceof Error ? err.message : 'Translation failed',
            },
          }
        : direction
    )));
  }, []);

  const clearDirections = useCallback(() => {
    setDirections([]);
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
    const nextDirection = withDirectionId(direction);

    setDirections((current) => {
      const insertIndex = Math.max(0, Math.min(index ?? current.length, current.length));
      return [
        ...current.slice(0, insertIndex),
        nextDirection,
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

  return {
    directions,
    cleanDirections,
    runDirections,
    startFromIndex,
    alwaysRunIndices,
    directionsView,
    setDirectionsView,
    replaceDirections,
    appendDirections,
    appendPendingDirection,
    replaceWithPendingDirection,
    resolvePendingDirection,
    resolveUnmatchedDirection,
    failPendingDirection,
    clearDirections,
    updateDirectionLabel,
    toggleDirectionOpen,
    deleteDirection,
    insertDirectionAt,
    reorderDirections,
    toggleStartFrom,
    toggleAlwaysRun,
  };
}
