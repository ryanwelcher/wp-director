import clsx from 'clsx';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog } from '../Dialog.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { useDeleteDirectionMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';
import { TrashIcon } from './TrashIcon.jsx';

export function DirectionLibraryPanel() {
  const { libraryEntries } = useAppState();
  const deleteDirectionMutation = useDeleteDirectionMutation();
  const [pendingDeleteDirection, setPendingDeleteDirection] = useState(null);
  const deletingDirection = deleteDirectionMutation.isPending;

  function closeDeleteDialog() {
    if (!deletingDirection) setPendingDeleteDirection(null);
  }

  async function confirmDeleteDirection() {
    if (!pendingDeleteDirection) return;

    try {
      await deleteDirectionMutation.mutateAsync(pendingDeleteDirection.filename);
      toast.success(`Deleted direction "${pendingDeleteDirection.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      setPendingDeleteDirection(null);
    }
  }

  return (
    <>
      <details id="directions-section">
        <summary>
          <span>Directions</span>
          <SectionBadge hidden={libraryEntries.length === 0}>{libraryEntries.length}</SectionBadge>
        </summary>
        <div className="directions-body">
          <div id="directions-list">
            {!libraryEntries.length && <p className="hint">No directions yet.</p>}

            {libraryEntries.map((entry) => (
              <div className={clsx('direction-item', entry.builtin && 'direction-item--builtin')} key={entry.filename}>
                <span className="direction-name">{entry.name}</span>
                <span className="direction-meta">
                  {entry.directionCount} step{entry.directionCount !== 1 ? 's' : ''}
                </span>
                {entry.builtin ? (
                  <span className="direction-builtin-badge" title="Built-in direction">&#128274;</span>
                ) : (
                  <button
                    className="direction-delete-btn sidebar-delete-icon-btn danger"
                    type="button"
                    aria-label={`Delete ${entry.name}`}
                    title="Delete"
                    disabled={deletingDirection && deleteDirectionMutation.variables === entry.filename}
                    onClick={() => setPendingDeleteDirection(entry)}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </details>

      {pendingDeleteDirection && (
        <Dialog
          title="Delete saved direction?"
          description={`Delete "${pendingDeleteDirection.name}"? This cannot be undone.`}
          closeDisabled={deletingDirection}
          onClose={closeDeleteDialog}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              disabled={deletingDirection}
              onClick={closeDeleteDialog}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              disabled={deletingDirection}
              onClick={confirmDeleteDirection}
            >
              {deletingDirection ? 'Deleting...' : 'Delete direction'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
