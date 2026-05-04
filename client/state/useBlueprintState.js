import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { errorMessage } from '../utils/actions.js';
import {
  useCurrentBlueprintQuery,
  useDefaultBlueprintQuery,
} from '../utils/apiHooks.js';

export function useBlueprintState() {
  const [blueprint, setBlueprint] = useState(null);
  const [defaultBlueprint, setDefaultBlueprint] = useState(null);
  const defaultBlueprintQuery = useDefaultBlueprintQuery();
  const currentBlueprintQuery = useCurrentBlueprintQuery();

  const isBlueprintModified = useMemo(() => (
    !!defaultBlueprint && JSON.stringify(blueprint) !== JSON.stringify(defaultBlueprint)
  ), [blueprint, defaultBlueprint]);

  useEffect(() => {
    if (!defaultBlueprintQuery.isError) return;
    toast.error(errorMessage(defaultBlueprintQuery.error, 'Could not load blueprint'));
  }, [defaultBlueprintQuery.error, defaultBlueprintQuery.isError]);

  useEffect(() => {
    if (!defaultBlueprintQuery.isSuccess) return;
    setDefaultBlueprint(defaultBlueprintQuery.data ?? null);
  }, [defaultBlueprintQuery.data, defaultBlueprintQuery.isSuccess]);

  useEffect(() => {
    const currentBlueprintSettled = currentBlueprintQuery.isSuccess || currentBlueprintQuery.isError;
    if (!defaultBlueprintQuery.isSuccess || !currentBlueprintSettled) return;

    setBlueprint(currentBlueprintQuery.data ?? defaultBlueprintQuery.data ?? null);
  }, [
    currentBlueprintQuery.data,
    currentBlueprintQuery.isError,
    currentBlueprintQuery.isSuccess,
    defaultBlueprintQuery.data,
    defaultBlueprintQuery.isSuccess,
  ]);

  return {
    blueprint,
    setBlueprint,
    defaultBlueprint,
    setDefaultBlueprint,
    isBlueprintModified,
  };
}
