export function SectionBadge({ children, hidden = false, className = '' }) {
  return (
    <span className={`badge${className ? ` ${className}` : ''}${hidden ? ' hidden' : ''}`}>
      {children}
    </span>
  );
}
