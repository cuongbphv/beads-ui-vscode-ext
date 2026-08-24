/**
 * Create pane: the full create-issue form, rendered in the same pane slot
 * `BeadDetail` occupies (see `App.tsx`'s `creating` state).
 *
 * Non-optimistic by design: nothing is added to the list locally. The form
 * stays populated and busy-gated until `createBead` actually resolves, so a
 * rejected write never has to be silently rolled back out of the issue list.
 */
import { X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import type { CreateBeadParams } from '../../shared/protocol';
import { PRIORITY_LABELS, type Bead, type DashboardSnapshot } from '../../shared/types';
import { asRpcError, call } from '../bridge/rpc';
import { Button } from './primitives';
import { useToast } from './toast';

const INPUT_CLASS =
  'bg-input-bg border-input-border text-fg min-w-0 rounded-md border px-2 py-1 text-sm';
const TEXTAREA_CLASS = `${INPUT_CLASS} resize-y`;

const PRIORITY_OPTIONS = [0, 1, 2, 3, 4] as const;

export function BeadCreate({
  snapshot,
  beads,
  onCancel,
  onSelect,
}: {
  snapshot: DashboardSnapshot;
  /** Every loaded bead — searched for epics (the parent picker) and labels (the datalist). */
  beads: Bead[];
  onCancel: () => void;
  /** Called with the new id once `createBead` resolves. */
  onSelect: (id: string) => void;
}): ReactNode {
  const { notify } = useToast();
  const types = snapshot.vocabulary.types;
  // Epics are the only valid parent for a new issue — beads models the
  // Epic → Task hierarchy as a parent-child edge onto an issue of that type,
  // never onto a task or another non-epic.
  const epics = useMemo(() => beads.filter((bead) => bead.issue_type === 'epic'), [beads]);
  const labelOptions = useMemo(
    () => Array.from(new Set(beads.flatMap((bead) => bead.labels ?? []))).sort(),
    [beads],
  );

  const [title, setTitle] = useState('');
  const [type, setType] = useState(types[0]?.name ?? '');
  const [priority, setPriority] = useState(2);
  const [parent, setParent] = useState('');
  const [labels, setLabels] = useState('');
  const [due, setDue] = useState('');
  const [estimate, setEstimate] = useState('');
  const [description, setDescription] = useState('');
  const [design, setDesign] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [busy, setBusy] = useState(false);

  const trimmedTitle = title.trim();

  async function submit(): Promise<void> {
    if (trimmedTitle === '' || busy) return;

    const params: CreateBeadParams = { title: trimmedTitle };
    if (type) params.type = type;
    // Mirrors `setPriority`: bd's `-p` flag takes the same numeric string.
    params.priority = String(priority);
    if (parent) params.parent = parent;

    const parsedLabels = labels
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label !== '');
    if (parsedLabels.length > 0) params.labels = parsedLabels;

    if (due) params.due = due;

    const trimmedEstimate = estimate.trim();
    if (trimmedEstimate !== '') {
      const minutes = Number(trimmedEstimate);
      if (Number.isFinite(minutes) && minutes > 0) params.estimate = minutes;
    }

    if (description.trim()) params.description = description.trim();
    if (design.trim()) params.design = design.trim();
    if (acceptance.trim()) params.acceptance = acceptance.trim();

    setBusy(true);
    try {
      const { id } = await call('createBead', params);
      notify(`${id} created`);
      onSelect(id);
    } catch (error) {
      // Non-optimistic: the form is left exactly as the user typed it, so a
      // retry does not mean re-entering everything.
      notify(asRpcError(error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      aria-label="Create a new issue"
      className="bg-surface border-border flex h-full min-h-0 w-full flex-col border-l"
    >
      <header className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-fg-strong text-lg leading-snug font-medium">New issue</h2>
        <button
          type="button"
          aria-label="Cancel new issue"
          onClick={onCancel}
          className="text-fg-muted hover:text-fg shrink-0"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Title</span>
            <input
              autoFocus
              disabled={busy}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Issue title"
              className={INPUT_CLASS}
            />
          </label>

          <div className="@container grid grid-cols-1 gap-3 @xs:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-fg-muted text-xs">Type</span>
              <select
                disabled={busy}
                value={type}
                onChange={(event) => setType(event.target.value)}
                className={INPUT_CLASS}
              >
                {types.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-fg-muted text-xs">Priority</span>
              <select
                disabled={busy}
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
                className={INPUT_CLASS}
              >
                {PRIORITY_OPTIONS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {PRIORITY_LABELS[candidate]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Parent epic</span>
            <select
              disabled={busy}
              value={parent}
              onChange={(event) => setParent(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">(none)</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.id} · {epic.title}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Labels</span>
            <input
              disabled={busy}
              list="bead-create-labels"
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
              placeholder="comma-separated"
              className={INPUT_CLASS}
            />
            <datalist id="bead-create-labels">
              {labelOptions.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </label>

          <div className="@container grid grid-cols-1 gap-3 @xs:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-fg-muted text-xs">Due date</span>
              <input
                type="date"
                disabled={busy}
                value={due}
                onChange={(event) => setDue(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-fg-muted text-xs">Estimate (minutes)</span>
              <input
                type="number"
                min={1}
                step={1}
                disabled={busy}
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
                placeholder="e.g. 60"
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Description</span>
            <textarea
              rows={3}
              disabled={busy}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={TEXTAREA_CLASS}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Design</span>
            <textarea
              rows={3}
              disabled={busy}
              value={design}
              onChange={(event) => setDesign(event.target.value)}
              className={TEXTAREA_CLASS}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-fg-muted text-xs">Acceptance criteria</span>
            <textarea
              rows={3}
              disabled={busy}
              value={acceptance}
              onChange={(event) => setAcceptance(event.target.value)}
              className={TEXTAREA_CLASS}
            />
          </label>

          <div className="mt-1 flex flex-col gap-1.5 @xs:flex-row @xs:items-center @xs:justify-end">
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || trimmedTitle === ''}
              className="justify-center @xs:self-end"
              onClick={() => void submit()}
            >
              Create issue
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
