import { useState } from 'react';
import { historyLabel } from '../calculator/format';
import type { HistoryEntry } from '../history/storage';

export const HISTORY_PANEL_ID = 'history-panel';

interface HistoryPanelProps {
  /** Newest first. */
  entries: readonly HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
}

/**
 * Below 768 px the list sits behind a disclosure button. From 768 px up the stylesheet hides the
 * button and always shows the list beside the calculator.
 *
 * `data-native-enter` tells useKeyboard to leave Enter alone in here, so the toggle and the
 * entries stay usable from the keyboard.
 */
export function HistoryPanel({ entries, onSelect, onClear }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="history" data-native-enter="">
      <button
        type="button"
        className="history__toggle"
        aria-expanded={open}
        aria-controls={HISTORY_PANEL_ID}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        History
        <span className="history__chevron" aria-hidden="true" />
      </button>
      <section
        id={HISTORY_PANEL_ID}
        className="history__panel"
        aria-label="History"
        data-open={open}
      >
        <div className="history__header">
          <h2 className="history__title">History</h2>
          <button
            type="button"
            className="history__clear"
            aria-label="Clear history"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="history__empty">No calculations yet.</p>
        ) : (
          <ol className="history__list">
            {entries.map((entry, index) => (
              <li key={`${entry.timestamp}-${index}`}>
                <button
                  type="button"
                  className="history__entry"
                  onClick={() => {
                    onSelect(entry);
                  }}
                >
                  {historyLabel(entry)}
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
