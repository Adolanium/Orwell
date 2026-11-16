import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { DesfechoDoTrazer, EnclaveBridge, EventoDeMedia } from "../bridge.js"
import { strings } from "../strings.js"
import type { MediaItem } from "../types.js"
import { AnexosDoItem } from "./AnexoAPedido.js"
import { MediaLazy } from "./MediaLazy.js"
import { PostImages } from "./PostImages.js"

/**
 * `MediaLazy` (Task 10, design §8): the box reserved with `w` and `h` before
 * there are bytes; the bytes are only asked for when the image enters the
 * screen; without the original, the sharp thumbnail and the "Fetch" button.
 */

/** A fake `IntersectionObserver`: `entrar()` puts everything on screen. */
const vigias: { cb: IntersectionObserverCallback; alvos: Element[] }[] = []
class VigiaFalso {
  alvos: Element[] = []
  constructor(private readonly cb: IntersectionObserverCallback) {
    vigias.push({ cb, alvos: this.alvos })
  }
  observe(alvo: Element): void {
    this.alvos.push(alvo)
  }
  unobserve(): void {}
  disconnect(): void {
    this.alvos.length = 0
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}
function entrar(dentro = true): void {
  for (const vigia of vigias) {
    vigia.cb(vigia.alvos.map((target) => ({ target, isIntersecting: dentro }) as IntersectionObserverEntry), {} as IntersectionObserver)
  }
}

let reduzido = false
beforeEach(() => {
  vigias.length = 0
  reduzido = false
  vi.stubGlobal("IntersectionObserver", VigiaFalso)
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: consulta.includes("reduce") ? reduzido : false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

let n = 0
const novoSha = (): string => `lazy-${++n}-${Math.random().toString(36).slice(2)}`

function ponte(bytes: (sha: string) => Uint8Array | null, trazer: () => Promise<DesfechoDoTrazer> = async () => ({ ok: true })) {
  const ouvintes = new Set<(evento: EventoDeMedia) => void>()
  const media = {
    bytes: vi.fn(async (sha: string) => bytes(sha)),
    fixar: vi.fn(async () => {}),
    soltar: vi.fn(async () => {}),
    estado: vi.fn(),
    definirTecto: vi.fn(),
    trazer: vi.fn(trazer),
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

describe("MediaLazy", () => {
  it("desenha a caixa com w e h sem pedir bytes fora do ecrã, e pede ao entrar", async () => {
    const sha = novoSha()
    const { bridge, media } = ponte(() => new Uint8Array([1]))
    const item: MediaItem = { ref: sha, name: "eira.png", mediaType: "image/png", w: 800, h: 600 }
    const { container } = render(
      <BridgeContext.Provider value={bridge}>
        <MediaLazy item={item} />
      </BridgeContext.Provider>,
    )
    const caixa = container.querySelector(".media-caixa") as HTMLElement
    expect(caixa.getAttribute("width")).toBe("800")
    expect(caixa.getAttribute("height")).toBe("600")
    expect(media.bytes).not.toHaveBeenCalled()
    act(() => entrar())
    await waitFor(() => expect(screen.getByAltText("eira.png").getAttribute("src")).toBeTruthy())
    expect(media.bytes).toHaveBeenCalledWith(sha)
    const img = screen.getByAltText("eira.png")
    expect(img.getAttribute("width")).toBe("800")
    expect(img.getAttribute("height")).toBe("600")
  })

  it("ao sair do ecrã solta o que fixou, e a imagem continua desenhada", async () => {
    const sha = novoSha()
    const { bridge, media } = ponte(() => new Uint8Array([1]))
    render(
      <BridgeContext.Provider value={bridge}>
        <MediaLazy item={{ ref: sha, name: "eira.png", w: 10, h: 10 }} />
      </BridgeContext.Provider>,
    )
    act(() => entrar())
    await waitFor(() => expect(screen.getByAltText("eira.png").getAttribute("src")).toBeTruthy())
    expect(media.fixar).toHaveBeenCalledWith(sha)
    expect(media.soltar).not.toHaveBeenCalled()
    act(() => entrar(false))
    expect(media.soltar).toHaveBeenCalledWith(sha)
    expect(screen.getByAltText("eira.png").getAttribute("src")).toBeTruthy()
  })

  it("sem o original mostra a miniatura nítida e o botão Trazer; trazido, mostra o original", async () => {
    const sha = novoSha()
    const mini = novoSha()
    let temOriginal = false
    const { bridge, media, emitir } = ponte(
      (s) => (s === mini ? new Uint8Array([1]) : temOriginal ? new Uint8Array([2, 2]) : null),
      async () => {
        temOriginal = true
        return { ok: true }
      },
    )
    const lista: MediaItem[] = [{ ref: sha, mini, name: "eira.png", mediaType: "image/png", w: 800, h: 600 }]
    const { container } = render(
      <BridgeContext.Provider value={bridge}>
        <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "m-1", lista }}>
          <PostImages media={lista} onOpen={() => {}} />
        </AnexosDoItem.Provider>
      </BridgeContext.Provider>,
    )
    act(() => entrar())
    const trazer = await screen.findByRole("button", { name: strings.media.trazer })
    const img = screen.getByAltText("eira.png")
    expect(img.className).toContain("media-mini")
    expect(container.querySelector(".media-lazy.a-carregar")).toBeNull()
    const antes = img.getAttribute("src")
    await act(async () => {
      fireEvent.click(trazer)
      await Promise.resolve()
    })
    expect(media.trazer).toHaveBeenCalledWith({ channel: "!lagar:s", alvo: "m-1", indice: 0 })
    await act(async () => emitir({ sha, estado: "chegou" }))
    await waitFor(() => expect(screen.getByAltText("eira.png").getAttribute("src")).not.toBe(antes))
    expect(screen.queryByRole("button", { name: strings.media.trazer })).toBeNull()
  })

  it("sem ninguém que a tenha, diz a frase, e deixa tentar outra vez", async () => {
    const sha = novoSha()
    const { bridge } = ponte(() => null, async () => ({ ok: false, motivo: "sem-irmao" }))
    render(
      <BridgeContext.Provider value={bridge}>
        <MediaLazy item={{ ref: sha, name: "a.png", w: 10, h: 10 }} />
      </BridgeContext.Provider>,
    )
    act(() => entrar())
    // No thumbnail: the old-device sentence, with the same button.
    expect(await screen.findByText(strings.media.noutroAparelho)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.media.trazer }))
      await Promise.resolve()
    })
    expect(await screen.findByText(strings.media.ninguemTem)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.media.trazer })).toBeTruthy()
  })

  it("a carregar, a miniatura esbate com transição; com movimento reduzido não há classe de transição", async () => {
    const sha = novoSha()
    const mini = novoSha()
    // The original never answers: it stays loading.
    const ponteLenta = ponte((s) => (s === mini ? new Uint8Array([1]) : null))
    ponteLenta.media.bytes.mockImplementation(async (s: string) => (s === mini ? new Uint8Array([1]) : new Promise<Uint8Array | null>(() => {})))
    const item: MediaItem = { ref: sha, mini, name: "a.png", w: 10, h: 10 }
    const { container, unmount } = render(
      <BridgeContext.Provider value={ponteLenta.bridge}>
        <MediaLazy item={item} />
      </BridgeContext.Provider>,
    )
    act(() => entrar())
    await waitFor(() => expect(container.querySelector(".media-lazy.a-carregar.media-transicao")).not.toBeNull())
    unmount()

    reduzido = true
    const outro: MediaItem = { ref: novoSha(), mini: novoSha(), name: "b.png", w: 10, h: 10 }
    ponteLenta.media.bytes.mockImplementation(async (s: string) => (s === outro.mini ? new Uint8Array([1]) : new Promise<Uint8Array | null>(() => {})))
    const segundo = render(
      <BridgeContext.Provider value={ponteLenta.bridge}>
        <MediaLazy item={outro} />
      </BridgeContext.Provider>,
    )
    act(() => entrar())
    await waitFor(() => expect(screen.getByAltText("b.png").getAttribute("src")).toBeTruthy())
    expect(segundo.container.querySelector(".media-transicao")).toBeNull()
  })
})
