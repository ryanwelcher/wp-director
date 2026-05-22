import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import { useRunState } from '../context/RunContext.jsx';

export function LogPanel() {
  const { logBadge, logOpen, logText, setLogOpen } = useRunState();
  const [copied, setCopied] = useState(false);
  const scrollOutputRef = useCallback((node) => {
    if (node) node.scrollTop = node.scrollHeight;
  }, [logText]);

  // Click handler lives on the button. stopPropagation + preventDefault keep
  // the click from also toggling the <details> open/closed.
  const onCopy = useCallback(async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!logText) return;
    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }, [logText]);

  return (
    <details id="log-panel" open={logOpen} onToggle={(event) => setLogOpen(event.currentTarget.open)}>
      <summary id="log-summary">
        <span>Output</span>
        <span className={logBadge.className}>{logBadge.text}</span>
        <button
          type="button"
          id="log-copy-btn"
          onClick={onCopy}
          disabled={!logText}
          title="Copy log to clipboard"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </summary>
      <pre id="log-output" ref={scrollOutputRef}>{logText}</pre>
    </details>
  );
}
