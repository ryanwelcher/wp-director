import { useMemo, useState } from 'react';
import {
  useCurrentBlueprintQuery,
  useDefaultBlueprintQuery,
} from '../utils/apiHooks.js';

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

  const isBlueprintModified = useMemo(() => (
    !!defaultBlueprint && JSON.stringify(blueprint) !== JSON.stringify(defaultBlueprint)
  ), [blueprint, defaultBlueprint]);

  return {
    blueprint,
    setBlueprint,
    defaultBlueprint,
    isBlueprintModified,
  };
}
