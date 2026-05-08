import { createContext, useCallback, useContext } from 'react';
import { useBlueprintState } from '../state/useBlueprintState.js';
import { useDirectionsState } from '../state/useDirectionsState.js';
import { usePoolStatus } from '../state/usePoolStatus.js';
import { useRunSettingsState } from '../state/useRunSettingsState.js';
import { useServerCollections } from '../state/useServerCollections.js';
import { api } from '../utils/api.js';

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
  const poolStatus = usePoolStatus();

  const clearDirections = useCallback(() => {
    clearDirectionState();
    resetScriptSettings();
  }, [clearDirectionState, resetScriptSettings]);

  const loadScriptIntoEditor = useCallback(async (script) => {
    if (script.blueprint) {
      await api.saveBlueprint(script.blueprint);
      blueprintState.setBlueprint(script.blueprint);
    }

    replaceDirections(script.directions ?? script.actions ?? []);
    loadScriptSettings(script);
  }, [blueprintState, loadScriptSettings, replaceDirections]);

  const value = {
    ...directionsState,
    replaceDirections,
    ...runSettings,
    ...blueprintState,
    ...collections,
    clearDirections,
    loadScriptIntoEditor,
    poolStatus,
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
