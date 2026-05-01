import { useCallback, useEffect, useState } from 'react';
import { fetchJSON } from '../utils/api.js';

export function useServerCollections() {
  const [savedScripts, setSavedScripts] = useState([]);
  const [selectedScripts, setSelectedScripts] = useState([]);
  const [libraryEntries, setLibraryEntries] = useState([]);
  const [recordings, setRecordings] = useState([]);

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
    loadSavedScripts();
    loadDirectionLibrary();
    loadRecordings();
  }, [loadDirectionLibrary, loadRecordings, loadSavedScripts]);

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
