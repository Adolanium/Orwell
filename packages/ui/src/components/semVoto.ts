import { createContext } from "react"

/**
 * Why this account cannot vote now, or `null` when it can (17/11/2026).
 *
 * An account younger than 5 days sees the poll options off and one sentence
 * that says why. A context, not a prop, because the same card draws in the
 * conversation, in the polls room and on the wall, and the reason is the same
 * in all of them: it is about the account, not the poll.
 */
export const SemVotoContext = createContext<string | null>(null)
