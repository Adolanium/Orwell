import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { useSpaceMeta } from "./useSpaceMeta.js"

afterEach(cleanup)

const CANAL = "!sala-de-voz-1:orwell.pt"

function bridge(meta: ((channel: string) => { name: string; icon?: string } | null) | undefined): EnclaveBridge {
  return { channels: { meta } } as unknown as EnclaveBridge
}

function mensagem(payload: Record<string, unknown>): ChatMessage {
  return { channel: CANAL, seq: 1, sender: "@alguem:orwell.pt", at: 1, payload } as unknown as ChatMessage
}

/**
 * A channel name is no longer its identifier.
 *
 * Writing "Sala de Voz #1" when creating would produce `sala-de-voz-1`, and
 * that is what everyone saw forever: the identifier is the MLS group key and
 * changing it would mean changing groups, leaving members in the old one. The
 * display name became something else in the address.
 */
describe("useSpaceMeta", () => {
  it("dá o nome publicado, com maiúsculas e acentos", () => {
    const { result } = renderHook(() =>
      useSpaceMeta(bridge(() => null), [CANAL], [mensagem({ t: "space.meta", name: "Ação & Café ☕", updatedAt: 10 })]),
    )
    expect(result.current.spaceMeta.get(CANAL)?.name).toBe("Ação & Café ☕")
  })

  it("o cofre responde antes de a rede dizer alguma coisa", () => {
    // This is what prevents the sidebar from flashing the raw identifier on every
    // startup while the connection is not open.
    const { result } = renderHook(() => useSpaceMeta(bridge(() => ({ name: "Do cofre" })), [CANAL], []))
    expect(result.current.spaceMeta.get(CANAL)?.name).toBe("Do cofre")
  })

  it("entre duas escritas, ganha a mais recente", () => {
    const { result } = renderHook(() =>
      useSpaceMeta(
        bridge(() => null),
        [CANAL],
        [
          mensagem({ t: "space.meta", name: "Antiga", updatedAt: 100 }),
          mensagem({ t: "space.meta", name: "Nova", updatedAt: 200 }),
        ],
      ),
    )
    expect(result.current.spaceMeta.get(CANAL)?.name).toBe("Nova")
  })

  it("uma escrita antiga não derruba a que já lá está", () => {
    // Arrival order is not clock order: a catch-up delivers history after the
    // present has already been seen.
    const { result } = renderHook(() =>
      useSpaceMeta(
        bridge(() => null),
        [CANAL],
        [
          mensagem({ t: "space.meta", name: "Nova", updatedAt: 200 }),
          mensagem({ t: "space.meta", name: "Antiga", updatedAt: 100 }),
        ],
      ),
    )
    expect(result.current.spaceMeta.get(CANAL)?.name).toBe("Nova")
  })

  it("ignora um payload sem nome em vez de mostrar lixo", () => {
    const { result } = renderHook(() =>
      useSpaceMeta(bridge(() => null), [CANAL], [mensagem({ t: "space.meta", updatedAt: 10 })]),
    )
    expect(result.current.spaceMeta.get(CANAL)).toBeUndefined()
  })

  it("sobrevive a um anfitrião que ainda não conhece isto", () => {
    // The Electron bridge can be older than the interface.
    const { result } = renderHook(() => useSpaceMeta(bridge(undefined), [CANAL], []))
    expect(result.current.spaceMeta.size).toBe(0)
  })

  it("o ícone chega como data URL", () => {
    const { result } = renderHook(() =>
      useSpaceMeta(
        bridge(() => null),
        [CANAL],
        [mensagem({ t: "space.meta", name: "Com ícone", icon: { inline: "data:image/png;base64,AA" }, updatedAt: 1 })],
      ),
    )
    expect(result.current.spaceMeta.get(CANAL)?.icon).toBe("data:image/png;base64,AA")
  })
})

describe("useSpaceMeta e o armazém de media (Task 10)", () => {
  it("o ícone por referência mostra-se pela miniatura do armazém, e o iconRef fica para guardar sem o perder", async () => {
    const sufixo = Math.random().toString(36).slice(2)
    const bytes = vi.fn(async (sha: string) => (sha === `mini-${sufixo}` ? new Uint8Array([1]) : null))
    const ponte = {
      channels: { meta: () => ({ name: "Lagar", iconRef: `ref-${sufixo}`, iconMini: `mini-${sufixo}`, updatedAt: 1 }) },
      media: { bytes, fixar: vi.fn(), soltar: vi.fn() },
      on: {},
    } as unknown as EnclaveBridge
    const { result } = renderHook(() => useSpaceMeta(ponte, [CANAL], []))
    expect(result.current.spaceMeta.get(CANAL)?.iconRef).toBe(`ref-${sufixo}`)
    await waitFor(() => expect(result.current.spaceMeta.get(CANAL)?.icon).toBeTruthy())
    expect(bytes).toHaveBeenCalledWith(`mini-${sufixo}`)
  })
})

describe("useSpaceMeta: o ícone que ainda não está no armazém", () => {
  it("volta a pedir quando o núcleo diz que chegou", async () => {
    const sufixo = Math.random().toString(36).slice(2)
    let tem = false
    const bytes = vi.fn(async () => (tem ? new Uint8Array([1]) : null))
    const ouvintes = new Set<(evento: { sha: string; estado: string }) => void>()
    const ponte = {
      channels: { meta: () => ({ name: "Lagar", iconRef: `ref-${sufixo}`, updatedAt: 1 }) },
      media: { bytes, fixar: vi.fn(), soltar: vi.fn() },
      on: {
        media: (ouvinte: (evento: { sha: string; estado: string }) => void) => {
          ouvintes.add(ouvinte)
          return () => ouvintes.delete(ouvinte)
        },
      },
    } as unknown as EnclaveBridge
    const { result } = renderHook(() => useSpaceMeta(ponte, [CANAL], []))
    await waitFor(() => expect(bytes).toHaveBeenCalledTimes(1))
    expect(result.current.spaceMeta.get(CANAL)?.icon).toBeUndefined()
    tem = true
    act(() => ouvintes.forEach((ouvinte) => ouvinte({ sha: `ref-${sufixo}`, estado: "chegou" })))
    await waitFor(() => expect(result.current.spaceMeta.get(CANAL)?.icon).toBeTruthy())
  })
})

// `vi` stays imported for the day this file needs to spy on the
// bridge; unused, the lint would complain.
void vi
