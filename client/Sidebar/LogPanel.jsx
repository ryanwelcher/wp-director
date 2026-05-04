import { useCallback } from 'react';
import { useRunState } from '../context/RunContext.jsx';

export function LogPanel() {
  const { logBadge, logOpen, logText, setLogOpen } = useRunState();
  const scrollOutputRef = useCallback((node) => {
    if (node) node.scrollTop = node.scrollHeight;
  }, [logText]);

  return (
    <details id="log-panel" open={logOpen} onToggle={(event) => setLogOpen(event.currentTarget.open)}>
      <summary id="log-summary">
        <span>Output</span>
        <span className={logBadge.className}>{logBadge.text}</span>
      </summary>
      <pre id="log-output" ref={scrollOutputRef}>{logText}</pre>
    </details>
  );
}
