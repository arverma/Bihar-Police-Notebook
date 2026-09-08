/**
 * Session-only undo/redo stack of opaque document snapshots.
 * Sheets own clone/apply; this module only manages push/pop/coalesce.
 */

/**
 * @typedef {{
 *   coalesceMs?: number,
 *   maxStack?: number,
 *   now?: () => number,
 * }} EditHistoryOptions
 */

/**
 * @param {EditHistoryOptions} [opts]
 */
export function createEditHistory(opts = {}) {
  const coalesceMs = opts.coalesceMs ?? 1000;
  const maxStack = opts.maxStack ?? 100;
  const now = opts.now ?? (() => Date.now());

  /** @type {unknown[]} */
  let undo = [];
  /** @type {unknown[]} */
  let redo = [];
  /** @type {unknown | null} */
  let lastSettled = null;
  let lastMarkAt = 0;
  let applying = false;

  function clear() {
    undo = [];
    redo = [];
    lastSettled = null;
    lastMarkAt = 0;
  }

  /**
   * Record the fitted document after reflow settles.
   * @param {unknown} snapshot
   */
  function settle(snapshot) {
    if (applying) return;
    lastSettled = snapshot;
  }

  /**
   * Call at the start of a user mutation (before reflow).
   * Pushes `lastSettled` onto the undo stack unless coalesced.
   * @param {{ force?: boolean }} [opts]
   * @returns {boolean} true if a new undo entry was pushed
   */
  function markUserEdit(opts = {}) {
    if (applying) return false;
    if (lastSettled == null) return false;
    const force = Boolean(opts.force);
    const t = now();
    if (!force && lastMarkAt > 0 && t - lastMarkAt < coalesceMs) {
      lastMarkAt = t;
      return false;
    }
    undo.push(lastSettled);
    if (undo.length > maxStack) undo.shift();
    redo = [];
    lastMarkAt = t;
    return true;
  }

  /**
   * @returns {unknown | null} snapshot to apply, or null if empty
   */
  function undoOnce() {
    if (undo.length === 0) return null;
    if (lastSettled != null) redo.push(lastSettled);
    const snapped = undo.pop();
    lastSettled = snapped;
    lastMarkAt = 0;
    return snapped;
  }

  /**
   * @returns {unknown | null}
   */
  function redoOnce() {
    if (redo.length === 0) return null;
    if (lastSettled != null) undo.push(lastSettled);
    const snapped = redo.pop();
    lastSettled = snapped;
    lastMarkAt = 0;
    return snapped;
  }

  return {
    clear,
    settle,
    markUserEdit,
    undoOnce,
    redoOnce,
    get applying() {
      return applying;
    },
    set applying(v) {
      applying = Boolean(v);
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    /** @returns {unknown | null} */
    get lastSettled() {
      return lastSettled;
    },
    /** test helper */
    get _undoLen() {
      return undo.length;
    },
    /** test helper */
    get _redoLen() {
      return redo.length;
    },
  };
}
