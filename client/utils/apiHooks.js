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

export function useDirectionLibraryQuery() {
  return useQuery({
    queryKey: queryKeys.directions.all,
    queryFn: api.listDirections,
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

export function usePreviewsQuery() {
  return useQuery({
    queryKey: queryKeys.previews,
    queryFn: api.listPreviews,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useClearPreviewsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.clearPreviews,
    onSuccess: () => invalidate(queryClient, queryKeys.previews),
  });
}

export function useDirectionLoader() {
  const queryClient = useQueryClient();

  return useCallback((filename) => queryClient.fetchQuery({
    queryKey: queryKeys.directions.detail(filename),
    queryFn: ({ signal }) => api.getDirection(filename, { signal }),
  }), [queryClient]);
}

export function useTranslateMutation() {
  return useMutation({
    mutationFn: api.translateCommand,
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

export function useSaveDirectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.saveDirection,
    onSuccess: () => invalidate(queryClient, queryKeys.directions.all),
  });
}

export function useDeleteDirectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteDirection,
    onSuccess: (_data, filename) => {
      queryClient.removeQueries({ queryKey: queryKeys.directions.detail(filename) });
      return invalidate(queryClient, queryKeys.directions.all);
    },
  });
}

export function usePreviewBlueprintMutation() {
  return useMutation({
    mutationFn: api.previewBlueprint,
  });
}
