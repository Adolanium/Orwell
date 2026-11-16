import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * An event handler with a stable identity that always runs the latest `fn`.
 *
 * For handlers that a memoized child calls on a click or a drag, never while it
 * renders: the child's props stay equal between renders, so `memo` can skip it,
 * and the handler still sees the current state. Not for functions a child calls
 * while rendering (`voicePresence`, `labelFor`): those must change when what
 * they read changes, so they use `useCallback` with their real dependencies.
 */
export function useEstavel<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const actual = useRef(fn)
  useLayoutEffect(() => {
    actual.current = fn
  })
  return useCallback((...args: A) => actual.current(...args), [])
}
