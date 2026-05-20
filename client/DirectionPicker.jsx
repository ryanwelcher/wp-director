import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useExpandIntentMutation } from './utils/apiHooks.js';
import { errorMessage } from './utils/actions.js';

/**
 * Quick-insert picker for the intent catalog.
 *
 * Zero-slot intents insert with one click. Slot-bearing intents expand
 * into an inline form that renders one control per slot (enum → select,
 * boolean → checkbox, number → number input, string → text). Submitting
 * the form calls the server expand endpoint and forwards the resulting
 * direction(s) up to onSelect, identical to the natural-language path.
 *
 * Props:
 *   - anchorIndex: number | null — directions[] index to insert relative to
 *   - entries: intent[] — full catalog
 *   - onSelect(directions: Direction[], insertIndex: number | null)
 *   - onClose()
 *   - position: { top, left }
 */
export function DirectionPicker({ anchorIndex, entries, onClose, onSelect, position }) {
  const [insertAbove, setInsertAbove] = useState(false);
  const [openIntentId, setOpenIntentId] = useState(null);
  const [filter, setFilter] = useState('');
  const expandIntent = useExpandIntentMutation();

  if (!position) return null;

  const hasPositionToggle = anchorIndex !== null;
  const insertIndex = anchorIndex === null
    ? null
    : (insertAbove ? anchorIndex : anchorIndex + 1);

  const filteredEntries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((intent) => (
      intent.id.toLowerCase().includes(needle)
      || (intent.description ?? '').toLowerCase().includes(needle)
    ));
  }, [entries, filter]);

  async function insertWithSlots(intent, slots) {
    try {
      const directions = await expandIntent.mutateAsync({ id: intent.id, slots });
      onSelect(directions, insertIndex);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not insert direction'));
    }
  }

  return (
    <div className="direction-picker" style={{ top: position.top, left: position.left }} onClick={(event) => event.stopPropagation()}>
      {hasPositionToggle && (
        <>
          <div className="direction-picker-position">
            <button
              className={clsx('direction-picker-pos-btn', !insertAbove && 'active')}
              type="button"
              onClick={() => setInsertAbove(false)}
            >
              &#8595; Below
            </button>
            <button
              className={clsx('direction-picker-pos-btn', insertAbove && 'active')}
              type="button"
              onClick={() => setInsertAbove(true)}
            >
              &#8593; Above
            </button>
          </div>
          <div className="direction-picker-divider" />
        </>
      )}

      <input
        className="direction-picker-filter"
        type="text"
        placeholder="Filter directions…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        autoFocus
      />

      <div className="direction-picker-list">
        {filteredEntries.length === 0 && (
          <p className="direction-picker-empty">No directions match "{filter}".</p>
        )}

        {filteredEntries.map((intent) => {
          const isOpen = openIntentId === intent.id;
          const hasSlots = (intent.slots ?? []).length > 0;

          if (!hasSlots) {
            return (
              <button
                key={intent.id}
                className={clsx('direction-picker-item', intent.userSaved && 'direction-picker-item--user')}
                type="button"
                title={intent.description}
                onClick={() => insertWithSlots(intent, {})}
                disabled={expandIntent.isPending}
              >
                {intent.id}
              </button>
            );
          }

          return (
            <div key={intent.id} className="direction-picker-intent">
              <button
                className={clsx(
                  'direction-picker-item',
                  intent.userSaved && 'direction-picker-item--user',
                  isOpen && 'direction-picker-item--open',
                )}
                type="button"
                title={intent.description}
                onClick={() => setOpenIntentId(isOpen ? null : intent.id)}
              >
                {intent.id} <span className="direction-picker-slot-count">({intent.slots.length} slot{intent.slots.length === 1 ? '' : 's'})</span>
              </button>
              {isOpen && (
                <SlotForm
                  intent={intent}
                  isPending={expandIntent.isPending}
                  onCancel={() => setOpenIntentId(null)}
                  onSubmit={(slots) => insertWithSlots(intent, slots)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function defaultSlotValue(slot) {
  if (slot.default !== undefined) return slot.default;
  if (slot.type === 'boolean') return false;
  if (slot.type === 'number') return '';
  if (slot.type === 'enum') return slot.values?.[0] ?? '';
  return '';
}

function SlotForm({ intent, isPending, onCancel, onSubmit }) {
  const [values, setValues] = useState(() => {
    const seed = {};
    for (const slot of intent.slots) seed[slot.name] = defaultSlotValue(slot);
    return seed;
  });

  function update(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  const missingRequired = intent.slots.some((slot) => {
    if (slot.optional || slot.default !== undefined || slot.placeholderFor) return false;
    const value = values[slot.name];
    return value === '' || value === null || value === undefined;
  });

  function submit() {
    if (missingRequired) return;
    // Coerce numbers and drop empty optionals before sending.
    const slots = {};
    for (const slot of intent.slots) {
      const raw = values[slot.name];
      if (raw === '' || raw === null || raw === undefined) continue;
      if (slot.type === 'number') {
        const num = Number(raw);
        if (Number.isFinite(num)) slots[slot.name] = num;
        continue;
      }
      slots[slot.name] = raw;
    }
    onSubmit(slots);
  }

  return (
    <div className="direction-picker-slot-form">
      {intent.slots.map((slot) => (
        <label key={slot.name} className="direction-picker-slot-row">
          <span className="direction-picker-slot-label">
            {slot.name}
            {!slot.optional && slot.default === undefined && !slot.placeholderFor && (
              <span className="direction-picker-slot-required" aria-label="required">*</span>
            )}
          </span>
          {renderSlotControl(slot, values[slot.name], (value) => update(slot.name, value))}
        </label>
      ))}
      <div className="direction-picker-slot-actions">
        <button
          className="direction-picker-slot-btn"
          type="button"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          className="direction-picker-slot-btn direction-picker-slot-btn--primary"
          type="button"
          onClick={submit}
          disabled={isPending || missingRequired}
        >
          {isPending ? 'Inserting…' : 'Insert'}
        </button>
      </div>
    </div>
  );
}

function renderSlotControl(slot, value, onChange) {
  if (slot.type === 'enum') {
    return (
      <select
        className="direction-picker-slot-input"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {(slot.values ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (slot.type === 'boolean') {
    return (
      <input
        className="direction-picker-slot-input direction-picker-slot-input--checkbox"
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }
  if (slot.type === 'number') {
    return (
      <input
        className="direction-picker-slot-input"
        type="number"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      className="direction-picker-slot-input"
      type="text"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
