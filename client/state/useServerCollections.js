import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../utils/api.js';
import {
  useDirectionLibraryQuery,
  useRecordingsQuery,
  useSavedScriptsQuery,
} from '../utils/apiHooks.js';

export function useServerCollections() {
  const [selectedScriptNames, setSelectedScriptNames] = useState([]);
  const queryClient = useQueryClient();
  const savedScriptsQuery = useSavedScriptsQuery();
  const directionLibraryQuery = useDirectionLibraryQuery();
  const recordingsQuery = useRecordingsQuery();

  const savedScripts = savedScriptsQuery.data ?? [];
  const libraryEntries = directionLibraryQuery.data ?? [];
  const recordings = recordingsQuery.data ?? [];
  const savedScriptNames = useMemo(() => (
    new Set(savedScripts.map((script) => script.name))
  ), [savedScripts]);
  const selectedScripts = useMemo(() => (
    selectedScriptNames.filter((name) => savedScriptNames.has(name))
  ), [savedScriptNames, selectedScriptNames]);
  const setSelectedScripts = useCallback((next) => {
    setSelectedScriptNames((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      return value.filter((name) => savedScriptNames.has(name));
    });
  }, [savedScriptNames]);

  const loadSavedScripts = useCallback(() => (
    queryClient.invalidateQueries({ queryKey: queryKeys.scripts })
  ), [queryClient]);

  const loadDirectionLibrary = useCallback(() => (
    queryClient.invalidateQueries({ queryKey: queryKeys.directions.all })
  ), [queryClient]);

  const loadRecordings = useCallback(() => (
    queryClient.invalidateQueries({ queryKey: queryKeys.recordings })
  ), [queryClient]);

  return {
    savedScripts,
    selectedScripts,
    setSelectedScripts,
    libraryEntries,
    recordings,
    loadSavedScripts,
    loadDirectionLibrary,
    loadRecordings,
  };
}
