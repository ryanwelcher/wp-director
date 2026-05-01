import { useEffect, useRef } from 'react';
import { useRunState } from '../context/RunContext.jsx';

export function LogPanel() {
  const { logBadge, logOpen, logText, setLogOpen } = useRunState();
  const outputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [logText]);

  return (
    <details id="log-panel" open={logOpen} onToggle={(event) => setLogOpen(event.currentTarget.open)}>
      <summary id="log-summary">
        <span>Output</span>
        <span className={logBadge.className}>{logBadge.text}</span>
      </summary>
      <pre id="log-output" ref={outputRef}>{logText}</pre>
    </details>
  );
}
