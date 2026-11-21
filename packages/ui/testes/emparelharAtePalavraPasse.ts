import { act, screen, waitFor } from "@testing-library/react"
import { expect } from "vitest"
import type { EnclaveBridge, PairEvento } from "../src/bridge.js"
import { strings } from "../src/strings.js"

/**
 * Pairing asks for the password AFTER the six words (1.3.26). Tests that look at
 * the password step use this: it gives a mock bridge what pairing needs, and a
 * way to reach that step (paste the link, emit the certificate).
 */
export function comEmparelhamento(
  bridge: EnclaveBridge,
  chamadas: string[] = [],
): { bridge: EnclaveBridge; emitir: (evento: PairEvento) => void } {
  let ouvinte: ((evento: PairEvento) => void) | null = null
  const ponte = bridge as unknown as Record<string, Record<string, unknown>>
  ponte["vault"] = {
    ...ponte["vault"],
    createProvisionalToSeal: async () => {
      chamadas.push("provisorio")
      return { ok: true }
    },
  }
  ponte["pairing"] = {
    join: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    done: async () => {
      chamadas.push("done")
      return { ok: true }
    },
    ...ponte["pairing"],
    seal: async (frase: string) => {
      chamadas.push(`seal ${frase}`)
      return { ok: true }
    },
  }
  ponte["on"] = {
    ...ponte["on"],
    pair: (handler: (evento: PairEvento) => void) => {
      ouvinte = handler
      return () => {
        ouvinte = null
      }
    },
  }
  return { bridge, emitir: (evento) => ouvinte?.(evento) }
}

/** With `linkInicial`, the pairing starts by itself: wait for it, and the certificate arrives ("Estás dentro"). */
export async function ateAPalavraPasse(emitir: (evento: PairEvento) => void, palavraPasse: "conta" | "nova"): Promise<void> {
  await screen.findByText(strings.juntarAparelho.aLigar)
  act(() => emitir({ fase: "certificado", address: "@abc:orwell.pt", palavraPasse }))
  await waitFor(() =>
    expect(document.querySelector(palavraPasse === "conta" ? 'input[name="current-password"]' : 'input[name="new-password"]')).not.toBeNull(),
  )
}
