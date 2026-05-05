import { toast } from 'react-toastify';

const ADDED_DIRECTIONS_AUTO_CLOSE_MS = 3000;

let addedDirectionsToastId = null;
let addedDirectionsCount = 0;

function addedDirectionsMessage(count) {
  return `Added ${count} direction${count !== 1 ? 's' : ''}`;
}

function resetAddedDirectionsToast(toastId) {
  if (addedDirectionsToastId !== toastId) return;

  addedDirectionsToastId = null;
  addedDirectionsCount = 0;
}

export function toastAddedDirections(count) {
  if (!Number.isFinite(count) || count <= 0) return;

  if (addedDirectionsToastId !== null && toast.isActive(addedDirectionsToastId)) {
    addedDirectionsCount += count;
    toast.update(addedDirectionsToastId, {
      render: addedDirectionsMessage(addedDirectionsCount),
      type: 'success',
      autoClose: ADDED_DIRECTIONS_AUTO_CLOSE_MS,
    });
    return;
  }

  addedDirectionsCount = count;
  const toastId = toast.success(addedDirectionsMessage(addedDirectionsCount), {
    autoClose: ADDED_DIRECTIONS_AUTO_CLOSE_MS,
    onClose: () => resetAddedDirectionsToast(toastId),
  });
  addedDirectionsToastId = toastId;
}
