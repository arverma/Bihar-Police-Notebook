/**
 * Caret ownership for pagers that restore the caret on a later frame.
 *
 * Reflow moves text between pages and then puts the caret back on the character
 * it was on. That restore has to wait for layout, so it runs a frame or two
 * after the reflow — and in that window the user can click into a different
 * page. Without ownership the queued restore fires anyway and drags the caret
 * off the page the user just picked; under CPU load the window is wide enough
 * to hit in normal use.
 *
 * The rule: the newest caret intent wins. A user placement invalidates every
 * restore queued before it. Placements the pager makes itself do not count as
 * the user, so a restore never invalidates its own successors.
 */

/**
 * @returns {{
 *   noteUserCaret: () => void,
 *   asRestore: <T>(fn: () => T) => T,
 *   owned: (fn: () => void) => () => void,
 *   watchUserCaret: (el: HTMLElement) => void,
 * }}
 */
export function createCaretOwnership() {
  let seq = 0;
  let restoring = false;

  /** The user put the caret somewhere. Restores queued before now are stale. */
  function noteUserCaret() {
    if (restoring) return;
    seq += 1;
  }

  /**
   * Run `fn` with caret writes attributed to the pager rather than the user, so
   * the focus/click events our own `focus()` calls fire are not mistaken for a
   * user placement. Re-entrant: nested restores restore the outer state.
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  function asRestore(fn) {
    const was = restoring;
    restoring = true;
    try {
      return fn();
    } finally {
      restoring = was;
    }
  }

  /**
   * Wrap a deferred caret restore. The returned callback is a no-op once the
   * user has taken the caret since it was scheduled.
   * @param {() => void} fn
   * @returns {() => void}
   */
  function owned(fn) {
    const at = seq;
    return () => {
      if (at !== seq) return;
      asRestore(fn);
    };
  }

  /**
   * Treat a pointer press inside `el` as the user claiming the caret. Pointer
   * presses are the signal, not `focus`: `focus` also fires when the pager
   * restores, and typing must not invalidate the restore that keeps the caret
   * with its text across a spill.
   * @param {HTMLElement} el
   */
  function watchUserCaret(el) {
    el.addEventListener('mousedown', noteUserCaret);
    el.addEventListener('touchstart', noteUserCaret, { passive: true });
  }

  return {
    noteUserCaret, asRestore, owned, watchUserCaret,
  };
}
