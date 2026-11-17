import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { DesfechoDoAnexo, DesfechoDoTrazer, EnclaveBridge } from "../bridge.js"
import { strings } from "../strings.js"
import type { MediaItem } from "../types.js"
import { AnexosDoItem } from "./AnexoAPedido.js"
import { PostImages } from "./PostImages.js"

/** An image that this device only has the name for: requested from other members when opened (S5, §5.4). */

afterEach(cleanup)

const IMAGEM = "data:image/png;base64,iVBORw0KGgo="

function montar(desfecho: DesfechoDoAnexo, comContexto = true): { pedir: ReturnType<typeof vi.fn>; lista: MediaItem[] } {
  const pedir = vi.fn(async () => desfecho)
  const lista: MediaItem[] = [{ name: "a.png", mediaType: "image/png", inline: IMAGEM }, { evicted: true, name: "b.png", mediaType: "image/png" }]
  const bridge = { anexo: { pedir } } as unknown as EnclaveBridge
  const grelha = <PostImages media={lista} />
  render(
    <BridgeContext.Provider value={bridge}>
      {comContexto ? <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "post-1", lista }}>{grelha}</AnexosDoItem.Provider> : grelha}
    </BridgeContext.Provider>,
  )
  return { pedir, lista }
}

async function carregar(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(strings.sincronia.anexoPedir) }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("ImagemAPedido", () => {
  it("só pede quando se carrega, com a posição certa, e mostra a imagem que chegou", async () => {
    const { pedir } = montar({ ok: true, anexo: { name: "b.png", mediaType: "image/png", inline: IMAGEM } })
    expect(pedir).not.toHaveBeenCalled()
    await carregar()
    expect(pedir).toHaveBeenCalledWith({ channel: "!lagar:s", alvo: "post-1", indice: 1 })
    expect(screen.getAllByRole("img").filter((img) => img.getAttribute("src") === IMAGEM)).toHaveLength(2)
  })

  it("se ninguém a tem, diz a frase do limite", async () => {
    montar({ ok: false, motivo: "ninguem" })
    await carregar()
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoNinguem)
  })

  it("uma avaria não se diz como «ninguém a tem»: diz-se com o código dela (1.3.7)", async () => {
    montar({ ok: false, motivo: "falhou" })
    await carregar()
    const texto = screen.getByRole("status").textContent ?? ""
    expect(texto).not.toBe(strings.sincronia.anexoNinguem)
    expect(texto).toContain("515")
  })

  it("e a ponte que atira também é uma avaria, e não «ninguém»", async () => {
    const lista: MediaItem[] = [{ evicted: true, name: "b.png", mediaType: "image/png" }]
    const bridge = { anexo: { pedir: vi.fn(async () => Promise.reject(new Error("ipc caiu"))) } } as unknown as EnclaveBridge
    render(
      <BridgeContext.Provider value={bridge}>
        <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "post-1", lista }}>
          <PostImages media={lista} />
        </AnexosDoItem.Provider>
      </BridgeContext.Provider>,
    )
    await carregar()
    expect(screen.getByRole("status").textContent ?? "").toContain("515")
  })

  it("se o que chegou não confere, não se mostra", async () => {
    montar({ ok: false, motivo: "recusado" })
    await carregar()
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoRecusado)
  })

  it('a frase de "ninguém" diz que nenhum utilizador com a imagem está online, e há "Tentar outra vez"', async () => {
    const { pedir } = montar({ ok: false, motivo: "ninguem" })
    await carregar()
    expect(strings.sincronia.anexoNinguem).toMatch(/online/)
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoNinguem)
    pedir.mockResolvedValueOnce({ ok: true, anexo: { name: "b.png", mediaType: "image/png", inline: IMAGEM } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.sincronia.anexoTentarOutraVez }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(pedir).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole("img").filter((img) => img.getAttribute("src") === IMAGEM)).toHaveLength(2)
  })

  it("o autor desligado diz-se assim; o autor ligado sem a imagem diz-se de outra maneira (12/11/2026)", async () => {
    montar({ ok: false, motivo: "ninguem", autorLigado: false, autor: "@ana:s" })
    await carregar()
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoAutorDesligado)
    cleanup()
    montar({ ok: false, motivo: "ninguem", autorLigado: true, autor: "@ana:s" })
    await carregar()
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoNinguem)
    expect(strings.sincronia.anexoAutorDesligado).not.toBe(strings.sincronia.anexoNinguem)
  })

  describe("volta a pedir sozinha quando alguém se liga", () => {
    afterEach(() => vi.useRealTimers())

    function comPresenca(desfecho: DesfechoDoAnexo): { pedir: ReturnType<typeof vi.fn>; ligar: (address: string) => void } {
      const ouvintes = new Set<(evento: { address: string; online: boolean }) => void>()
      const pedir = vi.fn(async () => desfecho)
      const lista: MediaItem[] = [{ evicted: true, name: "b.png", mediaType: "image/png" }]
      const bridge = {
        anexo: { pedir },
        on: {
          presence: (ouvinte: (evento: { address: string; online: boolean }) => void) => {
            ouvintes.add(ouvinte)
            return () => ouvintes.delete(ouvinte)
          },
        },
      } as unknown as EnclaveBridge
      render(
        <BridgeContext.Provider value={bridge}>
          <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "post-1", lista }}>
            <PostImages media={lista} />
          </AnexosDoItem.Provider>
        </BridgeContext.Provider>,
      )
      return { pedir, ligar: (address) => act(() => ouvintes.forEach((ouvinte) => ouvinte({ address, online: true }))) }
    }

    it("o autor liga-se: pede outra vez, e a imagem aparece", async () => {
      vi.useFakeTimers()
      const { pedir, ligar } = comPresenca({ ok: false, motivo: "ninguem", autorLigado: false, autor: "@ana:s" })
      await carregar()
      expect(pedir).toHaveBeenCalledTimes(1)
      pedir.mockResolvedValueOnce({ ok: true, anexo: { name: "b.png", mediaType: "image/png", inline: IMAGEM } })
      ligar("@ana:s")
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(pedir).toHaveBeenCalledTimes(2)
      expect(screen.getAllByRole("img").filter((img) => img.getAttribute("src") === IMAGEM)).toHaveLength(1)
    })

    it("outra pessoa liga-se: pede outra vez, mas no máximo uma vez a cada dois minutos", async () => {
      vi.useFakeTimers()
      const { pedir, ligar } = comPresenca({ ok: false, motivo: "ninguem", autorLigado: true, autor: "@ana:s" })
      await carregar()
      ligar("@bruno:s")
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(pedir).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000)
      })
      expect(pedir).toHaveBeenCalledTimes(2)
      // Still nobody: the phrase stays, without going back to "Asking…" in between.
      expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoNinguem)
      ligar("@carla:s")
      ligar("@duarte:s")
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(pedir).toHaveBeenCalledTimes(2)
    })
  })

  it("a pedir, deixa cancelar; cancelado, volta o botão de pedir", async () => {
    let acabar: (desfecho: DesfechoDoAnexo) => void = () => {}
    const pedir = vi.fn(() => new Promise<DesfechoDoAnexo>((resolver) => (acabar = resolver)))
    const cancelar = vi.fn(async () => {
      acabar({ ok: false, motivo: "cancelado" })
      return true
    })
    const lista: MediaItem[] = [{ evicted: true, name: "b.png", mediaType: "image/png" }]
    render(
      <BridgeContext.Provider value={{ anexo: { pedir, cancelar } } as unknown as EnclaveBridge}>
        <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "post-1", lista }}>
          <PostImages media={lista} />
        </AnexosDoItem.Provider>
      </BridgeContext.Provider>,
    )
    await carregar()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.sincronia.anexoCancelar }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(cancelar).toHaveBeenCalledWith({ channel: "!lagar:s", alvo: "post-1", indice: 0 })
    expect(screen.getByRole("button", { name: new RegExp(strings.sincronia.anexoPedir) })).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it('com a fila cheia ("por pedir"), volta o botão de pedir, sem frase de falha', async () => {
    montar({ ok: false, motivo: "por-pedir" })
    await carregar()
    expect(screen.getByRole("button", { name: new RegExp(strings.sincronia.anexoPedir) })).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("sem saber de que mensagem é, fica o marcador de sempre, sem botão", () => {
    montar({ ok: true, anexo: {} }, false)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByRole("img", { name: strings.media.noutroAparelho })).toBeTruthy()
  })
})

describe("com o armazém (Trazer): a frase sabe do autor (16/11/2026)", () => {
  function comArmazem(desfecho: DesfechoDoTrazer): void {
    const lista: MediaItem[] = [{ evicted: true, name: "b.png", mediaType: "image/png" }]
    const bridge = {
      media: { trazer: vi.fn(async () => desfecho) },
      anexo: { pedir: vi.fn(async () => ({ ok: false, motivo: "ninguem" })) },
      channels: { history: vi.fn(async () => []) },
    } as unknown as EnclaveBridge
    render(
      <BridgeContext.Provider value={bridge}>
        <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "post-1", lista }}>
          <PostImages media={lista} />
        </AnexosDoItem.Provider>
      </BridgeContext.Provider>,
    )
  }

  async function trazer(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(strings.media.trazer) }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it("o autor desligado diz-se como tal, e não como \"ninguém a tem\"", async () => {
    comArmazem({ ok: false, motivo: "ninguem", autorLigado: false, autor: "@ze:s" })
    await trazer()
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoAutorDesligado)
  })

  it("sem saber do autor, a frase do armazém", async () => {
    comArmazem({ ok: false, motivo: "sem-irmao" })
    await trazer()
    expect(screen.getByRole("status").textContent).toBe(strings.media.ninguemTem)
  })
})
