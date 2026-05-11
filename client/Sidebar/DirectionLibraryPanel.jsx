import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { useDeleteDirectionMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';
import { TrashIcon } from './TrashIcon.jsx';

export function DirectionLibraryPanel() {
  const { libraryEntries } = useAppState();
  const deleteDirectionMutation = useDeleteDirectionMutation();

  async function deleteDirection(entry) {
    try {
      await deleteDirectionMutation.mutateAsync(entry.filename);
      toast.success(`Deleted direction "${entry.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    }
  }

  return (
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
                  onClick={() => deleteDirection(entry)}
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
