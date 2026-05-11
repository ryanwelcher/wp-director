import clsx from 'clsx';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)];
}

export function Dialog({
  children,
  className,
  closeDisabled = false,
  description,
  initialFocusRef,
  onClose,
  title,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement;
    const focusFrame = requestAnimationFrame(() => {
      const focusTarget = initialFocusRef?.current ?? focusableElements(dialogRef.current)[0];
      focusTarget?.focus();
    });

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        if (!closeDisabled) {
          event.preventDefault();
          onClose();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElement instanceof HTMLElement) {
        previousActiveElement.focus();
      }
    };
  }, [closeDisabled, initialFocusRef, onClose]);

  function handleBackdropClick(event) {
    if (!closeDisabled && event.target === event.currentTarget) {
      onClose();
    }
  }

  return createPortal(
    <div className="app-dialog-backdrop" onMouseDown={handleBackdropClick}>
      <div
        ref={dialogRef}
        className={clsx('app-dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="app-dialog-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        {description && (
          <p id={descriptionId} className="app-dialog-description">
            {description}
          </p>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
