import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { api, queryKeys } from './utils/api.js';
import { errorMessage } from './utils/actions.js';

/**
 * Phase 5: Google Drive account status in the header. When signed in, shows the
 * account email + a Sign out button; when configured but signed out, shows a
 * Sign in button (opening OAuth here is friendlier than the just-in-time prompt
 * on the upload button). Renders nothing when Drive isn't configured, so the
 * header stays clean on installs that don't use the feature.
 *
 * `refetchOnWindowFocus` is on for this query specifically: sign-in happens in a
 * separate tab, so refetching when the user returns updates the header without a
 * manual reload. Email is null for tokens granted before the userinfo.email
 * scope existed — in that case we just show "Google Drive".
 */
export function DriveAccount() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: queryKeys.drive.status,
    queryFn: ({ signal }) => api.getDriveStatus({ signal }),
    refetchOnWindowFocus: true,
  });

  // Sign-in happens in a separate tab; the query refetches when the user returns
  // (refetchOnWindowFocus). Announce success only on the not-authed → authed
  // transition, so we don't toast on initial load when already signed in.
  const wasAuthed = useRef(data?.authed);
  useEffect(() => {
    if (data?.authed && wasAuthed.current === false) {
      toast.success('Successfully signed in to Google Drive.');
    }
    if (data) wasAuthed.current = data.authed;
  }, [data?.authed]);

  const signOut = useMutation({
    mutationFn: () => api.signOutDrive(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.drive.status });
      queryClient.removeQueries({ queryKey: queryKeys.drive.uploads });
      toast.success('Signed out of Google Drive.');
    },
    onError: (err) => {
      toast.error(errorMessage(err, 'Could not sign out of Google Drive'));
    },
  });

  if (!data?.configured) return null;

  if (!data.authed) {
    return (
      <div className="drive-account">
        <button
          className="drive-account-signin"
          type="button"
          onClick={() => window.open('/api/drive/oauth/start', '_blank', 'noopener')}
        >
          Sign in to Google Drive
        </button>
      </div>
    );
  }

  return (
    <div className="drive-account">
      <span className="drive-account-label" title={data.email || 'Signed in to Google Drive'}>
        <span className="drive-account-dot" aria-hidden="true" />
        {data.email || 'Google Drive'}
      </span>
      <button
        className="drive-account-signout"
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
      >
        {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
