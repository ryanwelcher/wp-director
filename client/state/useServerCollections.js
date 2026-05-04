import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../utils/api.js';
import {
  useDirectionLibraryQuery,
  useRecordingsQuery,
  useSavedScriptsQuery,
} from '../utils/apiHooks.js';

export function useServerCollections() {
  const [selectedScripts, setSelectedScripts] = useState([]);
  const queryClient = useQueryClient();
  const savedScriptsQuery = useSavedScriptsQuery();
  const directionLibraryQuery = useDirectionLibraryQuery();
  const recordingsQuery = useRecordingsQuery();

  const savedScripts = savedScriptsQuery.data ?? [];
  const libraryEntries = directionLibraryQuery.data ?? [];
  const recordings = recordingsQuery.data ?? [];

  const loadSavedScripts = useCallback(() => (
    queryClient.invalidateQueries({ queryKey: queryKeys.scripts })
  ), [queryClient]);

  const loadDirectionLibrary = useCallback(() => (
    queryClient.invalidateQueries({ queryKey: queryKeys.directions.all })
  ), [queryClient]);

  const loadRecordings = useCallback(() => (
    queryClient.invalidateQueries({ queryKey: queryKeys.recordings })
  ), [queryClient]);

  useEffect(() => {
    setSelectedScripts((current) => current.filter((name) => savedScripts.some((script) => script.name === name)));
  }, [savedScripts]);

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
