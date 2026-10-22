/**
 * Unseen-publications signal. Change these two numbers to tune it.
 * The streak itself is computed in streak.ts (countUnseenStreak).
 */

/** This many unseen publications in a row make the account suspect. */
export const UNSEEN_STREAK_LIMIT = 3

/** An ad that stays this long as ACTIVE counts as seen and resets the streak. */
export const UNSEEN_WINDOW_MS = 60 * 60 * 1000
