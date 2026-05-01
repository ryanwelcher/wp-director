import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { errorMessage } from '../utils/actions.js';
import { fetchJSON } from '../utils/api.js';

export function useBlueprintState() {
  const [blueprint, setBlueprint] = useState(null);
  const [defaultBlueprint, setDefaultBlueprint] = useState(null);

  const isBlueprintModified = useMemo(() => (
    !!defaultBlueprint && JSON.stringify(blueprint) !== JSON.stringify(defaultBlueprint)
  ), [blueprint, defaultBlueprint]);

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
      if (active) toast.error(errorMessage(err, 'Could not load blueprint'));
    });

    return () => { active = false; };
  }, []);

  return {
    blueprint,
    setBlueprint,
    defaultBlueprint,
    setDefaultBlueprint,
    isBlueprintModified,
  };
}
