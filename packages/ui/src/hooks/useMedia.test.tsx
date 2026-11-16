import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge, EventoDeMedia } from "../bridge.js"
import type { MediaItem } from "../types.js"
import { cacheDeMedia } from "../lib/cacheDeMedia.js"
import { useMedia } from "./useMedia.js"

/**
 * `useMedia` (Task 10, design §8): the bytes of a media item by reference are
 * asked from the store only when they enter the screen, stay pinned while
 * there, and a missing original comes back when the core says it arrived.
 */

afterEach(cleanup)

let n = 0
/** A new `sha` per test: the cache belongs to the whole session. */
const novoSha = (): string => `sha-${++n}-${Math.random().toString(36).slice(2)}`

function ponte(bytes: (sha: string) => Uint8Array | null) {
  const ouvintes = new Set<(evento: EventoDeMedia) => void>()
  const media = {
    bytes: vi.fn(async (sha: string) => bytes(sha)),
    fixar: vi.fn(async () => {}),
    soltar: vi.fn(async () => {}),
    estado: vi.fn(),
    definirTecto: vi.fn(),
    trazer: vi.fn(async () => ({ ok: true as const })),
  }
  const bridge = {
    media,
    on: {
      media: (handler: (evento: EventoDeMedia) => void) => {
        ouvintes.add(handler)
        return () => ouvintes.delete(handler)
      },
    },
  } as unknown as EnclaveBridge
  return { bridge, media, emitir: (evento: EventoDeMedia) => ouvintes.forEach((ouvinte) => ouvinte(evento)) }
}

type Resultado = ReturnType<typeof useMedia>

function Sonda({ item, visivel, tamanho, saida }: { item: MediaItem; visivel: boolean; tamanho: "mini" | "original"; saida: { atual: Resultado | null } }) {
  saida.atual = useMedia(item, { visivel, tamanho })
  return null
}

function montar(bridge: EnclaveBridge | null, filho: ReactNode) {
  return render(<BridgeContext.Provider value={bridge}>{filho}</BridgeContext.Provider>)
}

describe("useMedia", () => {
  it("um item com inline está pronto logo, sem pedir nada", () => {
    const { bridge, media } = ponte(() => null)
    const saida = { atual: null as Resultado | null }
    montar(bridge, <Sonda item={{ inline: "data:image/png;base64,AAAA" }} visivel={false} tamanho="original" saida={saida} />)
    expect(saida.atual).toEqual({ src: "data:image/png;base64,AAAA", estado: "pronto" })
    expect(media.bytes).not.toHaveBeenCalled()
  })

  it("fora do ecrã não pede bytes; ao entrar fixa, pede e fica pronto; ao sair solta", async () => {
    const sha = novoSha()
    const { bridge, media } = ponte(() => new Uint8Array([1, 2, 3]))
    const saida = { atual: null as Resultado | null }
    const item: MediaItem = { ref: sha, mediaType: "image/png", w: 10, h: 10 }
    const { rerender, unmount } = montar(bridge, <Sonda item={item} visivel={false} tamanho="original" saida={saida} />)
    expect(saida.atual?.estado).toBe("a-carregar")
    expect(media.bytes).not.toHaveBeenCalled()
    rerender(
      <BridgeContext.Provider value={bridge}>
        <Sonda item={item} visivel tamanho="original" saida={saida} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(saida.atual?.estado).toBe("pronto"))
    expect(media.fixar).toHaveBeenCalledWith(sha)
    expect(media.bytes).toHaveBeenCalledWith(sha)
    expect(saida.atual?.src).toMatch(/^(blob:|data:image\/png;base64,)/)
    unmount()
    expect(media.soltar).toHaveBeenCalledWith(sha)
  })

  it("um endereço que a cache revogou (trancar, o tecto) já não se desenha, e fora do ecrã fica a carregar", async () => {
    const sha = novoSha()
    const { bridge } = ponte(() => new Uint8Array([4]))
    const saida = { atual: null as Resultado | null }
    const item: MediaItem = { ref: sha }
    const { rerender } = montar(bridge, <Sonda item={item} visivel tamanho="original" saida={saida} />)
    await waitFor(() => expect(saida.atual?.estado).toBe("pronto"))
    rerender(
      <BridgeContext.Provider value={bridge}>
        <Sonda item={item} visivel={false} tamanho="original" saida={saida} />
      </BridgeContext.Provider>,
    )
    expect(saida.atual?.estado).toBe("pronto")
    cacheDeMedia.esvaziar()
    rerender(
      <BridgeContext.Provider value={bridge}>
        <Sonda item={item} visivel={false} tamanho="original" saida={saida} />
      </BridgeContext.Provider>,
    )
    expect(saida.atual).toEqual({ src: null, estado: "a-carregar" })
  })

  it("a miniatura pede-se pelo sha dela", async () => {
    const sha = novoSha()
    const mini = novoSha()
    const { bridge, media } = ponte((s) => (s === mini ? new Uint8Array([9]) : null))
    const saida = { atual: null as Resultado | null }
    montar(bridge, <Sonda item={{ ref: sha, mini }} visivel tamanho="mini" saida={saida} />)
    await waitFor(() => expect(saida.atual?.estado).toBe("pronto"))
    expect(media.bytes).toHaveBeenCalledWith(mini)
    expect(media.bytes).not.toHaveBeenCalledWith(sha)
  })

  it("sem o original: em falta; quando o núcleo diz que chegou, volta a pedir e fica pronto", async () => {
    const sha = novoSha()
    let tem = false
    const { bridge, media, emitir } = ponte(() => (tem ? new Uint8Array([7]) : null))
    const saida = { atual: null as Resultado | null }
    montar(bridge, <Sonda item={{ ref: sha }} visivel tamanho="original" saida={saida} />)
    await waitFor(() => expect(saida.atual?.estado).toBe("em-falta"))
    expect(saida.atual?.src).toBeNull()
    tem = true
    await act(async () => emitir({ sha: "outro", estado: "chegou" }))
    expect(media.bytes).toHaveBeenCalledTimes(1)
    await act(async () => emitir({ sha, estado: "chegou" }))
    await waitFor(() => expect(saida.atual?.estado).toBe("pronto"))
  })

  it("um marcador evicted, ou uma ponte sem armazém, está em falta", () => {
    const saida = { atual: null as Resultado | null }
    montar(null, <Sonda item={{ evicted: true, name: "a.png" }} visivel tamanho="original" saida={saida} />)
    expect(saida.atual).toEqual({ src: null, estado: "em-falta" })
    cleanup()
    montar({} as EnclaveBridge, <Sonda item={{ ref: novoSha() }} visivel tamanho="original" saida={saida} />)
    expect(saida.atual?.estado).toBe("em-falta")
  })
})
