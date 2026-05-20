import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog } from './Dialog.jsx';
import { errorMessage } from './utils/actions.js';
import {
  useCheckIntentConflictsMutation,
  useProposeIntentMutation,
  useSaveIntentMutation,
} from './utils/apiHooks.js';

/**
 * Save-as-intent flow.
 *
 * Lifecycle:
 *   1. Mounts with `prompt` + `directions`. Auto-fires the proposer call.
 *   2. Shows the proposal in an editable form (id, description, examples,
 *      slots, action preview).
 *   3. "Check for conflicts" runs the proposed examples through classify()
 *      and surfaces any phrase that maps to a different existing intent.
 *   4. "Save" writes the intent file via POST /api/intents. If conflicts
 *      are unresolved, the server returns 409 and the dialog re-renders
 *      them inline. The user can "Save anyway" to override.
 *
 * The save handler in the parent component is responsible for closing the
 * dialog and re-running the original prompt through the deterministic
 * pipeline once the save succeeds.
 */

const SAFE_ID_RE = /^[a-z0-9-]+$/;

function emptyProposal() {
  return { id: '', description: '', examples: [''], slots: [], label: '', actions: [] };
}

function normalizeProposal(raw, fallbackPrompt) {
  const base = emptyProposal();
  if (!raw || typeof raw !== 'object') return base;
  const proposal = { ...base, ...raw };
  proposal.examples = Array.isArray(proposal.examples) ? proposal.examples : [];
  if (fallbackPrompt && !proposal.examples.includes(fallbackPrompt)) {
    proposal.examples = [fallbackPrompt, ...proposal.examples];
  }
  if (proposal.examples.length === 0) proposal.examples = [''];
  proposal.slots = Array.isArray(proposal.slots) ? proposal.slots : [];
  proposal.actions = Array.isArray(proposal.actions) ? proposal.actions : [];
  return proposal;
}

export function SaveAsIntentDialog({ prompt, directions, existingIds, onClose, onSaved }) {
  const proposeMutation = useProposeIntentMutation();
  const conflictsMutation = useCheckIntentConflictsMutation();
  const saveMutation = useSaveIntentMutation();
  const initialFocusRef = useRef(null);

  const [proposal, setProposal] = useState(() => emptyProposal());
  const [proposalLoaded, setProposalLoaded] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [conflictsChecked, setConflictsChecked] = useState(false);
  const [overrideConflicts, setOverrideConflicts] = useState(false);

  // Auto-propose when the dialog mounts. Only fires once per session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await proposeMutation.mutateAsync({ prompt, directions });
        if (cancelled) return;
        setProposal(normalizeProposal(raw, prompt));
      } catch (err) {
        if (cancelled) return;
        toast.error(errorMessage(err, 'Could not draft proposal'));
      } finally {
        if (!cancelled) setProposalLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingIdSet = useMemo(() => new Set(existingIds || []), [existingIds]);

  const idError = useMemo(() => {
    if (!proposal.id) return 'id required';
    if (!SAFE_ID_RE.test(proposal.id)) return 'id must be lowercase kebab-case ([a-z0-9-]+)';
    if (existingIdSet.has(proposal.id)) return `"${proposal.id}" already exists`;
    return null;
  }, [proposal.id, existingIdSet]);

  const trimmedExamples = useMemo(() => proposal.examples.map((ex) => ex.trim()).filter(Boolean), [proposal.examples]);

  const canSave = useMemo(() => {
    if (!proposalLoaded) return false;
    if (idError) return false;
    if (!proposal.description.trim()) return false;
    if (!proposal.label.trim()) return false;
    if (trimmedExamples.length === 0) return false;
    if (!proposal.actions.length) return false;
    if (conflicts.length && !overrideConflicts) return false;
    return true;
  }, [proposalLoaded, idError, proposal, trimmedExamples, conflicts, overrideConflicts]);

  function updateExample(index, value) {
    setProposal((current) => ({
      ...current,
      examples: current.examples.map((ex, i) => (i === index ? value : ex)),
    }));
    setConflictsChecked(false);
    setOverrideConflicts(false);
    setConflicts([]);
  }

  function addExample() {
    setProposal((current) => ({ ...current, examples: [...current.examples, ''] }));
  }

  function removeExample(index) {
    setProposal((current) => ({
      ...current,
      examples: current.examples.length > 1
        ? current.examples.filter((_, i) => i !== index)
        : current.examples,
    }));
    setConflictsChecked(false);
    setOverrideConflicts(false);
    setConflicts([]);
  }

  async function runConflictCheck() {
    if (idError || !trimmedExamples.length) return;
    try {
      const found = await conflictsMutation.mutateAsync({
        proposedId: proposal.id,
        examples: trimmedExamples,
      });
      setConflicts(found);
      setConflictsChecked(true);
      setOverrideConflicts(false);
      if (found.length === 0) {
        toast.success('No conflicts — these phrases are unique.');
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Conflict check failed'));
    }
  }

  async function handleSave() {
    if (!canSave) return;
    const payload = {
      id: proposal.id.trim(),
      description: proposal.description.trim(),
      examples: trimmedExamples,
      slots: proposal.slots,
      label: proposal.label.trim(),
      actions: proposal.actions,
    };
    try {
      await saveMutation.mutateAsync(payload, { skipConflictCheck: overrideConflicts });
      toast.success(`Saved "${payload.id}"`);
      onSaved({ ...payload, prompt });
    } catch (err) {
      // 409 from server with `conflicts` field — re-render them inline so
      // the user can fix or explicitly override.
      const data = err?.data;
      if (Array.isArray(data?.conflicts) && data.conflicts.length) {
        setConflicts(data.conflicts);
        setConflictsChecked(true);
        toast.error('Examples collide with existing directions — see below.');
        return;
      }
      toast.error(errorMessage(err, 'Save failed'));
    }
  }

  const saving = saveMutation.isPending;
  const checking = conflictsMutation.isPending;
  const proposing = proposeMutation.isPending;

  return (
    <Dialog
      title="Save direction for reuse"
      description="Save this direction so you can quickly reuse it later. Edit the AI draft below before saving."
      onClose={onClose}
      className="app-dialog--wide"
      closeDisabled={saving}
      initialFocusRef={initialFocusRef}
    >
      <div className="save-intent-body">
        {proposing && (
          <div className="save-intent-loading">
            <span className="direction-spinner" aria-hidden="true" />
            <span>Drafting from your prompt…</span>
          </div>
        )}

        {!proposing && (
          <>
            <label className="save-intent-field">
              <span className="save-intent-label">id</span>
              <input
                ref={initialFocusRef}
                className={clsx('save-intent-input', idError && 'has-error')}
                value={proposal.id}
                onChange={(e) => setProposal((current) => ({ ...current, id: e.target.value }))}
                placeholder="kebab-case-id"
                aria-invalid={!!idError}
                aria-describedby={idError ? 'save-intent-id-error' : undefined}
              />
              {idError && <span className="save-intent-error" id="save-intent-id-error">{idError}</span>}
            </label>

            <label className="save-intent-field">
              <span className="save-intent-label">Description</span>
              <input
                className="save-intent-input"
                value={proposal.description}
                onChange={(e) => setProposal((current) => ({ ...current, description: e.target.value }))}
                placeholder="One sentence — what does this direction do?"
              />
            </label>

            <label className="save-intent-field">
              <span className="save-intent-label">Label</span>
              <input
                className="save-intent-input"
                value={proposal.label}
                onChange={(e) => setProposal((current) => ({ ...current, label: e.target.value }))}
                placeholder="Editor label, may use {{slot}} placeholders"
              />
            </label>

            <fieldset className="save-intent-field">
              <legend className="save-intent-label">Examples</legend>
              {proposal.examples.map((example, index) => (
                <div className="save-intent-example-row" key={index}>
                  <input
                    className="save-intent-input"
                    value={example}
                    onChange={(e) => updateExample(index, e.target.value)}
                    placeholder={index === 0 ? prompt : 'Alternative phrasing'}
                  />
                  <button
                    className="save-intent-icon-btn"
                    type="button"
                    onClick={() => removeExample(index)}
                    disabled={proposal.examples.length === 1}
                    aria-label="Remove example"
                  >×</button>
                </div>
              ))}
              <button className="save-intent-secondary" type="button" onClick={addExample}>
                + Add example
              </button>
            </fieldset>

            {proposal.slots.length > 0 && (
              <fieldset className="save-intent-field">
                <legend className="save-intent-label">Slots</legend>
                <table className="save-intent-slot-table">
                  <thead>
                    <tr><th>Name</th><th>Type</th><th>Optional</th><th>Default</th></tr>
                  </thead>
                  <tbody>
                    {proposal.slots.map((slot, index) => (
                      <tr key={index}>
                        <td>{slot.name}</td>
                        <td>{slot.type}{slot.type === 'enum' && slot.values ? ` (${slot.values.join(' | ')})` : ''}</td>
                        <td>{slot.optional ? 'yes' : 'no'}</td>
                        <td>{slot.default !== undefined ? JSON.stringify(slot.default) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="save-intent-hint">Slot table is read-only in the AI draft. Adjust by editing the saved file later if needed.</p>
              </fieldset>
            )}

            <details className="save-intent-action-preview">
              <summary>Action template ({proposal.actions.length})</summary>
              <pre>{JSON.stringify(proposal.actions, null, 2)}</pre>
            </details>

            <div className="save-intent-conflicts">
              <div className="save-intent-conflicts-header">
                <button
                  className="save-intent-secondary"
                  type="button"
                  onClick={runConflictCheck}
                  disabled={checking || !!idError || trimmedExamples.length === 0}
                >
                  {checking ? 'Checking…' : 'Check for conflicts'}
                </button>
                {conflictsChecked && conflicts.length === 0 && (
                  <span className="save-intent-ok">No conflicts</span>
                )}
              </div>
              {conflicts.length > 0 && (
                <ul className="save-intent-conflict-list">
                  {conflicts.map((conflict, index) => (
                    <li className="save-intent-conflict" key={index}>
                      <em>“{conflict.example}”</em> already maps to <strong>{conflict.intentId}</strong>
                      {conflict.alsoMatched?.length ? ` (and ${conflict.alsoMatched.join(', ')})` : ''}.
                    </li>
                  ))}
                </ul>
              )}
              {conflicts.length > 0 && (
                <label className="save-intent-override">
                  <input
                    type="checkbox"
                    checked={overrideConflicts}
                    onChange={(e) => setOverrideConflicts(e.target.checked)}
                  />
                  Save anyway — I understand these examples will not match this direction
                </label>
              )}
            </div>
          </>
        )}
      </div>

      <div className="app-dialog-actions">
        <button
          className="app-dialog-btn app-dialog-btn--secondary"
          type="button"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="app-dialog-btn app-dialog-btn--primary"
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
