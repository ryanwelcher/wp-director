import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from './api.js';

function invalidate(queryClient, queryKey) {
  return queryClient.invalidateQueries({ queryKey });
}

export function useDefaultBlueprintQuery() {
  return useQuery({
    queryKey: queryKeys.blueprint.default,
    queryFn: api.getDefaultBlueprint,
    meta: { errorMessage: 'Could not load blueprint' },
  });
}

export function useCurrentBlueprintQuery() {
  return useQuery({
    queryKey: queryKeys.blueprint.current,
    queryFn: api.getCurrentBlueprint,
  });
}

export function useSavedScriptsQuery() {
  return useQuery({
    queryKey: queryKeys.scripts,
    queryFn: api.listScripts,
  });
}

export function useIntentCatalogQuery() {
  return useQuery({
    queryKey: queryKeys.intents.all,
    queryFn: api.listIntents,
  });
}

export function useRecordingsQuery() {
  return useQuery({
    queryKey: queryKeys.recordings,
    queryFn: api.listRecordings,
  });
}

export function useDeleteRecordingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteRecording,
    onSuccess: () => invalidate(queryClient, queryKeys.recordings),
  });
}

export function useSaveLatestPreviewMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.saveLatestPreview,
    onSuccess: () => invalidate(queryClient, queryKeys.recordings),
  });
}

export function useIntentLoader() {
  const queryClient = useQueryClient();

  return useCallback((id) => queryClient.fetchQuery({
    queryKey: queryKeys.intents.detail(id),
    queryFn: ({ signal }) => api.getIntent(id, { signal }),
  }), [queryClient]);
}

export function useExpandIntentMutation() {
  return useMutation({
    mutationFn: api.expandIntent,
  });
}

export function useTranslateMutation() {
  return useMutation({
    mutationFn: api.translateCommand,
  });
}

export function useTranslateFreeFormMutation() {
  return useMutation({
    mutationFn: api.translateCommandFreeForm,
  });
}

export function useSaveScriptMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.saveScript,
    onSuccess: () => invalidate(queryClient, queryKeys.scripts),
  });
}

export function useDeleteScriptMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteScript,
    onSuccess: () => invalidate(queryClient, queryKeys.scripts),
  });
}

export function useSaveIntentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.saveIntent,
    onSuccess: () => invalidate(queryClient, queryKeys.intents.all),
  });
}

export function useProposeIntentMutation() {
  return useMutation({
    mutationFn: api.proposeIntent,
  });
}

export function useCheckIntentConflictsMutation() {
  return useMutation({
    mutationFn: api.checkIntentConflicts,
  });
}

export function useFixDirectionMutation() {
  return useMutation({
    mutationFn: api.fixDirection,
  });
}

export function useDeleteIntentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteIntent,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.intents.detail(id) });
      return invalidate(queryClient, queryKeys.intents.all);
    },
  });
}

export function usePreviewBlueprintMutation() {
  return useMutation({
    mutationFn: api.previewBlueprint,
  });
}
