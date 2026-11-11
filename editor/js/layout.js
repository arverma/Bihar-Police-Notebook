/**
 * The one desktop / mobile boundary.
 *
 * There are exactly two layouts: desktop (viewport >= 1024px) and mobile
 * (everything narrower, tablets in portrait included). No in-between "tablet"
 * layout. CSS media queries cannot read this constant, so the same number is
 * written in the stylesheets as `max-width: 1023px` (mobile) /
 * `min-width: 1024px` (desktop); layout.test.js fails if they drift apart.
 */
export const DESKTOP_MIN_PX = 1024;

/** Matches the mobile layout. */
export const MOBILE_QUERY = `(max-width: ${DESKTOP_MIN_PX - 1}px)`;
