import { useRef } from "react"

/** Structural equality for what the UI derives: primitives, arrays, plain objects, `Map`s and `Set`s, nested. */
export function iguaisEmProfundidade(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false
    for (const [chave, valor] of a) if (!b.has(chave) || !iguaisEmProfundidade(valor, b.get(chave))) return false
    return true
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
    for (const valor of a) if (!b.has(valor)) return false
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((valor, i) => iguaisEmProfundidade(valor, b[i]))
  }
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => iguaisEmProfundidade((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * The previous value while the new one is structurally equal (1.3.15).
 *
 * A derived map rebuilt on every message (the unread counts) is a new object
 * with the same contents, and a memoized child that receives it renders again
 * for nothing. This keeps the old identity until the contents change.
 */
export function useMesmoValor<T>(valor: T): T {
  const anterior = useRef(valor)
  if (!iguaisEmProfundidade(anterior.current, valor)) anterior.current = valor
  return anterior.current
}
