/**
 * The server tsconfig has no DOM lib. Playwright's
 * `evaluateHandle<Element | null>()` then `asElement()` needs these names,
 * and `Element` has to extend `Node` or the click branch is `never`.
 */
interface Node {}
interface Element extends Node {}
