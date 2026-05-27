import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useExpandIntentMutation } from './utils/apiHooks.js';
import { errorMessage } from './utils/actions.js';
import wpCoreBlocks from '../shared/wp-core-blocks.json';

const SUGGESTION_LISTS = {
  'wp-core-blocks': wpCoreBlocks,
};

function resolveSuggestions(slot) {
  if (!slot.suggestions) return null;
  if (Array.isArray(slot.suggestions)) return slot.suggestions;
  return SUGGESTION_LISTS[slot.suggestions] ?? null;
}

// Suggestions can be plain strings or { value, label } objects. The picker
// stores DISPLAY strings in form state (so the input shows "Paragraph"), and
// converts back to identifiers at submit time.
function visibleSuggestions(suggestions) {
  if (!suggestions) return null;
  return suggestions.filter((opt) => typeof opt === 'string' || (!opt.parent && !opt.ancestor));
}

function suggestionDisplay(suggestions, rawValue) {
  if (!suggestions || !rawValue) return rawValue ?? '';
  for (const opt of suggestions) {
    if (typeof opt === 'string') {
      if (opt === rawValue) return opt;
    } else if (opt.value === rawValue) {
      return opt.label ?? opt.value;
    }
  }
  return rawValue;
}

function suggestionIdentifier(suggestions, displayValue) {
  if (!suggestions || !displayValue) return displayValue ?? '';
  for (const opt of suggestions) {
    if (typeof opt === 'object' && opt.label === displayValue) return opt.value;
  }
  return displayValue;
}

// Evaluates `slot.showWhen` against the current form values. Currently the
// only supported predicate is `{ slot: <name>, isTextual: true }`, which is
// true when the referenced slot's value resolves to a suggestion entry with
// `textual: true`. Unknown / custom values default to TRUE (show the field)
// so we never silently drop user input.
function slotIsVisible(slot, formValues, allSlots) {
  const rule = slot.showWhen;
  if (!rule) return true;
  if (rule.isTextual === true) {
    const sourceSlot = allSlots.find((s) => s.name === rule.slot);
    if (!sourceSlot) return true;
    const displayValue = formValues[rule.slot];
    if (!displayValue) return true;
    const suggestions = resolveSuggestions(sourceSlot);
    if (!suggestions) return true;
    const identifier = suggestionIdentifier(suggestions, displayValue);
    const match = suggestions.find((opt) => typeof opt === 'object' && opt.value === identifier);
    if (!match) return true; // Unknown/custom block — fall back to visible.
    return match.textual === true;
  }
  return true;
}

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
      || friendlyLabelText(intent).toLowerCase().includes(needle)
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
                {renderFriendlyLabel(intent)}
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
                {renderFriendlyLabel(intent)}
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

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

function titleizeId(id) {
  return id.split(/[-_]/).filter(Boolean).map((word) => (
    word.charAt(0).toUpperCase() + word.slice(1)
  )).join(' ');
}

function friendlyLabelText(intent) {
  const label = intent.label || titleizeId(intent.id);
  return label.replace(PLACEHOLDER_RE, (_match, token) => token);
}

function renderFriendlyLabel(intent) {
  const label = intent.label || titleizeId(intent.id);
  const parts = [];
  let lastIndex = 0;
  let match;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(label)) !== null) {
    if (match.index > lastIndex) parts.push(label.slice(lastIndex, match.index));
    parts.push(
      <span key={`${match.index}-${match[1]}`} className="direction-picker-slot-hint">
        {match[1]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < label.length) parts.push(label.slice(lastIndex));
  return parts.length ? parts : label;
}

function defaultSlotValue(slot) {
  if (slot.default !== undefined) return slot.default;
  if (slot.type === 'boolean') return false;
  if (slot.type === 'number') return '';
  if (slot.type === 'enum') return slot.values?.[0] ?? '';
  return '';
}

function titleizeCamel(name) {
  const spaced = name.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function slotLabel(slot) {
  return slot.label || titleizeCamel(slot.name);
}

// A slot is "primary" if the user must engage with it. Required slots and
// placeholderFor slots (which are technically optional but conceptually tied
// to a required slot, like `content` on insert-block) live in the top group.
// Everything else lands under "More options".
function isPrimarySlot(slot) {
  if (slot.primary) return true;
  if (slot.placeholderFor) return true;
  if (slot.optional) return false;
  if (slot.default !== undefined) return false;
  return true;
}

function SlotForm({ intent, isPending, onCancel, onSubmit }) {
  const [values, setValues] = useState(() => {
    const seed = {};
    for (const slot of intent.slots) {
      const raw = defaultSlotValue(slot);
      seed[slot.name] = slot.suggestions
        ? suggestionDisplay(resolveSuggestions(slot), raw)
        : raw;
    }
    return seed;
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  function update(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  const { primary, advanced } = useMemo(() => {
    const p = [];
    const a = [];
    for (const slot of intent.slots) {
      if (!slotIsVisible(slot, values, intent.slots)) continue;
      (isPrimarySlot(slot) ? p : a).push(slot);
    }
    return { primary: p, advanced: a };
  }, [intent.slots, values]);

  const missingRequired = intent.slots.some((slot) => {
    if (slot.optional || slot.default !== undefined || slot.placeholderFor) return false;
    if (!slotIsVisible(slot, values, intent.slots)) return false;
    const value = values[slot.name];
    return value === '' || value === null || value === undefined;
  });

  function submit() {
    if (missingRequired) return;
    const slots = {};
    for (const slot of intent.slots) {
      if (!slotIsVisible(slot, values, intent.slots)) continue;
      let raw = values[slot.name];
      if (raw === '' || raw === null || raw === undefined) continue;
      if (slot.suggestions) {
        raw = suggestionIdentifier(resolveSuggestions(slot), raw);
      }
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
      {primary.map((slot) => (
        <SlotRow key={slot.name} intentId={intent.id} slot={slot} value={values[slot.name]} onChange={(v) => update(slot.name, v)} />
      ))}

      {advanced.length > 0 && (
        <div className="direction-picker-slot-group">
          <button
            type="button"
            className="direction-picker-slot-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            <span className="direction-picker-slot-toggle-caret">{showAdvanced ? '▾' : '▸'}</span>
            More options <span className="direction-picker-slot-toggle-count">({advanced.length})</span>
          </button>
          {showAdvanced && advanced.map((slot) => (
            <SlotRow key={slot.name} intentId={intent.id} slot={slot} value={values[slot.name]} onChange={(v) => update(slot.name, v)} />
          ))}
        </div>
      )}

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

function SlotRow({ intentId, slot, value, onChange }) {
  const isRequired = !slot.optional && slot.default === undefined && !slot.placeholderFor;
  const datalistId = slot.suggestions ? `slot-suggest-${intentId}-${slot.name}` : null;
  return (
    <div className="direction-picker-slot-row">
      <label className="direction-picker-slot-label">
        {slotLabel(slot)}
        {isRequired && (
          <span className="direction-picker-slot-required" aria-label="required">*</span>
        )}
      </label>
      <div className="direction-picker-slot-control">
        {renderSlotControl(slot, value, onChange, datalistId)}
        {slot.description && (
          <p className="direction-picker-slot-help">{slot.description}</p>
        )}
      </div>
    </div>
  );
}

function renderSlotControl(slot, value, onChange, datalistId) {
  if (slot.type === 'enum') {
    return (
      <select
        className="direction-picker-slot-input"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {(slot.values ?? []).map((option) => (
          <option key={option} value={option}>
            {slot.valueLabels?.[option] ?? option}
          </option>
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
        placeholder={slot.placeholder ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const suggestions = resolveSuggestions(slot);
  const visible = visibleSuggestions(suggestions);
  return (
    <>
      <input
        className="direction-picker-slot-input"
        type="text"
        value={value ?? ''}
        placeholder={slot.placeholder ?? ''}
        onChange={(event) => onChange(event.target.value)}
        list={suggestions ? datalistId : undefined}
      />
      {visible && (
        <datalist id={datalistId}>
          {visible.map((opt) => {
            const label = typeof opt === 'string' ? opt : (opt.label ?? opt.value);
            return <option key={typeof opt === 'string' ? opt : opt.value} value={label} />;
          })}
        </datalist>
      )}
    </>
  );
}
