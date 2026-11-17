import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { CorpoDoBug } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { esquecerErrosMostrados, registarErroMostrado } from "../lib/errosMostrados.js"
import { browserDe, sistemaDe } from "../lib/detalhesDoBug.js"
import { strings } from "../strings.js"
import { ComunicarErro, useComunicarErro } from "./ComunicarErro.js"

afterEach(cleanup)
beforeEach(esquecerErrosMostrados)

/**
 * "Report a bug" (12/11/2026): what the form shows is what it sends, and nothing
 * else; the address only with "Let us contact you"; no button on an old server.
 */
function ponte(suportado = true): { bridge: EnclaveBridge; enviados: CorpoDoBug[] } {
  const enviados: CorpoDoBug[] = []
  const bridge = {
    bugs: {
      plataforma: "web",
      suportado: async () => suportado,
      enviar: async (corpo: CorpoDoBug) => {
        enviados.push(corpo)
        return { ok: true as const }
      },
    },
    sincronia: { estado: async () => [{ channel: "!segredo:x", estado: "em-dia" }] },
  } as unknown as EnclaveBridge
  return { bridge, enviados }
}

describe("comunicar um erro", () => {
  it("mostra a lista exacta, marcada por omissão, e envia exactamente isso, sem contacto", async () => {
    registarErroMostrado(349, 1_794_000_000_000)
    const { bridge, enviados } = ponte()
    render(<ComunicarErro bridge={bridge} connection="online" onClose={vi.fn()} />)
    const caixa = screen.getByRole("checkbox", { name: strings.comunicarErro.detalhes }) as HTMLInputElement
    expect(caixa.checked).toBe(true)
    await screen.findByText(strings.comunicarErro.ligacao("online"))
    expect(screen.getByText(strings.comunicarErro.sincronia("em-dia:1"))).toBeTruthy()
    const contacto = screen.getByRole("checkbox", { name: strings.comunicarErro.contacto }) as HTMLInputElement
    expect(contacto.checked).toBe(false)

    await userEvent.type(screen.getByRole("textbox"), "O canal não abre.")
    await userEvent.click(screen.getByRole("button", { name: strings.comunicarErro.enviar }))
    await screen.findByText(strings.comunicarErro.enviado)

    expect(enviados).toHaveLength(1)
    const [corpo] = enviados
    expect(corpo).toMatchObject({ v: 1, descricao: "O canal não abre.", contacto: false })
    expect(corpo!.detalhes?.erros).toEqual([{ codigo: 349, em: 1_794_000_000_000 }])
    expect(corpo!.detalhes?.ligacao).toBe("online")
    // The channel the sync state counted never travels: only the count.
    expect(JSON.stringify(corpo)).not.toContain("segredo")
  })

  it("sem a caixa, não vai nenhum detalhe; com 'Podem contactar-me', vai o pedido de contacto", async () => {
    const { bridge, enviados } = ponte()
    render(<ComunicarErro bridge={bridge} connection="online" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole("checkbox", { name: strings.comunicarErro.detalhes }))
    await userEvent.click(screen.getByRole("checkbox", { name: strings.comunicarErro.contacto }))
    await userEvent.type(screen.getByRole("textbox"), "Erro ao enviar.")
    await userEvent.click(screen.getByRole("button", { name: strings.comunicarErro.enviar }))
    await screen.findByText(strings.comunicarErro.enviado)
    expect(enviados[0]).toEqual({ v: 1, descricao: "Erro ao enviar.", contacto: true })
  })

  it("sem descrição, o botão não envia", () => {
    const { bridge } = ponte()
    render(<ComunicarErro bridge={bridge} connection="online" onClose={vi.fn()} />)
    expect((screen.getByRole("button", { name: strings.comunicarErro.enviar }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("sem a capacidade no servidor, ou sem `bugs` na ponte, não há botão", async () => {
    const semServidor = renderHook(() => useComunicarErro(ponte(false).bridge))
    const comServidor = renderHook(() => useComunicarErro(ponte(true).bridge))
    const ponteAntiga = renderHook(() => useComunicarErro({} as EnclaveBridge))
    await waitFor(() => expect(comServidor.result.current).toBe(true))
    expect(semServidor.result.current).toBe(false)
    expect(ponteAntiga.result.current).toBe(false)
  })
})

describe("os detalhes técnicos", () => {
  it("o sistema e o browser são nomes e versões, nunca o user agent inteiro", () => {
    const firefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0"
    expect(sistemaDe(firefox)).toBe("macOS")
    expect(browserDe(firefox)).toBe("Firefox 140")
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
    expect(sistemaDe(android)).toBe("Android 14")
    expect(browserDe(android)).toBe("Chrome 131")
  })

  it("o mesmo código repetido logo a seguir conta uma vez, e ficam só os últimos 20", () => {
    registarErroMostrado(104, 1000)
    registarErroMostrado(104, 1500)
    for (let i = 0; i < 25; i++) registarErroMostrado(200 + i, 10_000 + i * 5_000)
    return import("../lib/errosMostrados.js").then(({ errosMostrados }) => {
      const lista = errosMostrados()
      expect(lista).toHaveLength(20)
      expect(lista.at(-1)?.codigo).toBe(224)
    })
  })
})
