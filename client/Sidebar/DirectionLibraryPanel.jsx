import clsx from 'clsx';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog } from '../Dialog.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { useDeleteIntentMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';
import { TrashIcon } from './TrashIcon.jsx';

export function DirectionLibraryPanel() {
  const { intentCatalog } = useAppState();
  const deleteIntentMutation = useDeleteIntentMutation();
  const [pendingDeleteIntent, setPendingDeleteIntent] = useState(null);
  const deletingIntent = deleteIntentMutation.isPending;

  function closeDeleteDialog() {
    if (!deletingIntent) setPendingDeleteIntent(null);
  }

  async function confirmDeleteIntent() {
    if (!pendingDeleteIntent) return;

    try {
      await deleteIntentMutation.mutateAsync(pendingDeleteIntent.id);
      toast.success(`Deleted intent "${pendingDeleteIntent.id}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      setPendingDeleteIntent(null);
    }
  }

  return (
    <>
      <details id="directions-section">
        <summary>
          <span>Intents</span>
          <SectionBadge hidden={intentCatalog.length === 0}>{intentCatalog.length}</SectionBadge>
        </summary>
        <div className="directions-body">
          <div id="directions-list">
            {!intentCatalog.length && <p className="hint">No intents yet.</p>}

            {intentCatalog.map((intent) => (
              <div className={clsx('direction-item', !intent.userSaved && 'direction-item--builtin')} key={intent.id}>
                <span className="direction-name" title={intent.description}>{intent.id}</span>
                <span className="direction-meta">
                  {intent.slots.length ? `${intent.slots.length} slot${intent.slots.length === 1 ? '' : 's'}` : 'no slots'}
                </span>
                {intent.userSaved ? (
                  <button
                    className="direction-delete-btn sidebar-delete-icon-btn danger"
                    type="button"
                    aria-label={`Delete ${intent.id}`}
                    title="Delete"
                    disabled={deletingIntent && deleteIntentMutation.variables === intent.id}
                    onClick={() => setPendingDeleteIntent(intent)}
                  >
                    <TrashIcon />
                  </button>
                ) : (
                  <span className="direction-builtin-badge" title="Built-in intent">&#128274;</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </details>

      {pendingDeleteIntent && (
        <Dialog
          title="Delete saved intent?"
          description={`Delete "${pendingDeleteIntent.id}"? This cannot be undone.`}
          closeDisabled={deletingIntent}
          onClose={closeDeleteDialog}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              disabled={deletingIntent}
              onClick={closeDeleteDialog}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              disabled={deletingIntent}
              onClick={confirmDeleteIntent}
            >
              {deletingIntent ? 'Deleting...' : 'Delete intent'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
