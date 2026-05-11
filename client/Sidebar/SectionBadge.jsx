import clsx from 'clsx';

export function SectionBadge({ children, hidden = false }) {
  return (
    <span className={clsx('badge', hidden && 'hidden')}>
      {children}
    </span>
  );
}
