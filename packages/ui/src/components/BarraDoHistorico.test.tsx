import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { HistoricoDosIrmaos } from "../bridge.js"
import { strings } from "../strings.js"
import { BarraDoHistorico } from "./BarraDoHistorico.js"

/**
 * The history notice (12/11/2026): "402 of 420" stood still for hours. When the
 * transfer gives up, or ends with entries that could not come, the bar is one
 * line with the reason, and it closes.
 */

afterEach(cleanup)

const base: HistoricoDosIrmaos = { aTrazer: true, feitas: 402, total: 420, media: null, canais: [], inicial: true }

describe("BarraDoHistorico", () => {
  it("a correr, mostra o progresso", () => {
    render(<BarraDoHistorico estado={base} />)
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.historico(402, 420))
    expect(screen.getByRole("status").querySelector("progress")).not.toBeNull()
  })

  it("o aparelho principal calou-se: uma linha com o que falta e porquê, sem barra de progresso, e fecha", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, perdidas: 18, razao: "irmao-calado" }} />)
    const linha = screen.getByRole("status")
    expect(linha.textContent).toContain(strings.sincronia.historicoParado(18))
    expect(linha.querySelector("progress")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: strings.sincronia.historicoFechar }))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("entradas que o aparelho principal não conseguiu enviar: dá-as como perdidas", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, feitas: 0, total: 0, perdidas: 2, razao: "ilegiveis" }} />)
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.historicoPerdidas(2))
  })

  it("um aparelho novo sem ninguém a responder: diz porquê, nunca um ecrã sem nada", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, feitas: 0, total: 0, razao: "sem-irmao" }} />)
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.historicoSemIrmao)
  })

  it("acabou inteiro: nada", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, feitas: 0, total: 0, inicial: false }} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("por omissão é a barra própria, por cima da conversa", () => {
    const { container } = render(<BarraDoHistorico estado={base} />)
    expect(container.querySelector(".barra-sincronia.barra-historico")).not.toBeNull()
  })

  it("no topo é uma linha só, com o texto e o progresso", () => {
    const { container } = render(<BarraDoHistorico estado={{ ...base, feitas: 340, total: 1200 }} noTopo />)
    const barra = container.querySelector(".barra-historico-no-topo")
    expect(barra).not.toBeNull()
    expect(barra?.querySelector("progress")?.getAttribute("value")).toBe("340")
    expect(container.querySelector(".barra-sincronia")).toBeNull()
  })

  it("no topo, o aviso de que parou também fica no topo", () => {
    const { container } = render(<BarraDoHistorico estado={{ ...base, aTrazer: false, perdidas: 18, razao: "irmao-calado" }} noTopo />)
    expect(container.querySelector(".barra-historico-no-topo.barra-historico-aviso")).not.toBeNull()
    expect(container.querySelector(".barra-sincronia")).toBeNull()
  })
})
