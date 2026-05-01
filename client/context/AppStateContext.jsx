import { createContext, useCallback, useContext } from 'react';
import { useBlueprintState } from '../state/useBlueprintState.js';
import { useDirectionsState } from '../state/useDirectionsState.js';
import { useRunSettingsState } from '../state/useRunSettingsState.js';
import { useServerCollections } from '../state/useServerCollections.js';

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const {
    clearDirections: clearDirectionState,
    replaceDirections,
    ...directionsState
  } = useDirectionsState();
  const {
    loadScriptSettings,
    resetScriptSettings,
    ...runSettings
  } = useRunSettingsState();
  const blueprintState = useBlueprintState();
  const collections = useServerCollections();

  const clearDirections = useCallback(() => {
    clearDirectionState();
    resetScriptSettings();
  }, [clearDirectionState, resetScriptSettings]);

  const loadScriptIntoEditor = useCallback((script) => {
    replaceDirections(script.directions ?? script.actions ?? script.steps ?? []);
    loadScriptSettings(script);
  }, [loadScriptSettings, replaceDirections]);

  const value = {
    ...directionsState,
    replaceDirections,
    ...runSettings,
    ...blueprintState,
    ...collections,
    clearDirections,
    loadScriptIntoEditor,
  };

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
