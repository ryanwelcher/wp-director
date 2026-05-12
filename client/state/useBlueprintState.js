import { useCallback, useState } from 'react';
import {
  useCurrentBlueprintQuery,
  useDefaultBlueprintQuery,
} from '../utils/apiHooks.js';
import { api } from '../utils/api.js';

export function useBlueprintState() {
  const [blueprintOverride, setBlueprint] = useState();
  const defaultBlueprintQuery = useDefaultBlueprintQuery();
  const currentBlueprintQuery = useCurrentBlueprintQuery();
  const currentBlueprintSettled = currentBlueprintQuery.isSuccess || currentBlueprintQuery.isError;
  const defaultBlueprint = defaultBlueprintQuery.data ?? null;
  const loadedBlueprint = defaultBlueprintQuery.isSuccess && currentBlueprintSettled
    ? currentBlueprintQuery.data ?? defaultBlueprint
    : null;
  const blueprint = blueprintOverride === undefined ? loadedBlueprint : blueprintOverride;

  const resetBlueprintToDefault = useCallback(async () => {
    const bp = await api.resetBlueprint();
    const target = bp ?? defaultBlueprint;
    if (target) setBlueprint(target);
    return target;
  }, [defaultBlueprint]);

  return {
    blueprint,
    setBlueprint,
    defaultBlueprint,
    resetBlueprintToDefault,
  };
}
