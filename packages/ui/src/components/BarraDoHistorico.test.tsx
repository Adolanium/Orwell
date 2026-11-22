import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { HistoricoDosIrmaos } from "../bridge.js"
import { clearDiagnostics, diagnosticsSnapshot } from "../lib/diagnostics.js"
import { strings } from "../strings.js"
import { BarraDoHistorico, logPageFailure } from "./BarraDoHistorico.js"

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

  it("parou a meio: uma linha com o que falta NESTE aparelho e que vai retomar, sem barra de progresso, e fecha", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, faltam: 298, razao: "irmao-calado" }} />)
    const linha = screen.getByRole("status")
    expect(linha.textContent).toContain(strings.sincronia.historicoEmFalta(298))
    expect(linha.querySelector("progress")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: strings.sincronia.historicoFechar }))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("o texto aprovado, no singular e no plural", () => {
    expect(strings.sincronia.historicoEmFalta(1)).toMatch(/^(1 message is missing on this device|Falta 1 mensagem neste aparelho)\./)
    expect(strings.sincronia.historicoEmFalta(298)).toMatch(/^(298 messages are missing on this device|Faltam 298 mensagens neste aparelho)\./)
  })

  it("parou, mas nada falta neste aparelho (só o registo de estado, ou repetidas): nada", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, faltam: 0, razao: "irmao-calado" }} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("parou sem número exacto (irmão antigo): a linha sem número, nunca um número inventado", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, razao: "irmao-calado" }} />)
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.historicoEmFaltaSemNumero)
    expect(screen.getByRole("status").textContent).not.toMatch(/\d/)
  })

  it("sem número e sem fonte (o núcleo largou o plano): nada", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, feitas: 0, total: 0, inicial: false }} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("entre aparelhos já emparelhados, uma sincronia pequena que parou não mostra aviso", () => {
    render(<BarraDoHistorico estado={{ ...base, inicial: false, aTrazer: false, feitas: 3, total: 12, faltam: 9, razao: "sem-irmao" }} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("entradas que o aparelho principal não conseguiu enviar: dá-as como perdidas", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, feitas: 0, total: 0, perdidas: 2, razao: "ilegiveis" }} />)
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.historicoPerdidas(2))
  })

  it("files that did not come (1.3.27): the bar reaches the end and says how many", () => {
    render(<BarraDoHistorico estado={{ ...base, feitas: base.total, media: { feitas: 5, total: 5, perdidas: 2 } }} />)
    const texto = screen.getByRole("status").textContent ?? ""
    expect(texto).toContain(strings.sincronia.historicoMedia(5, 5))
    expect(texto).toContain(strings.sincronia.historicoFicheirosPerdidos(2))
    expect((screen.getByRole("progressbar", { hidden: true }) as HTMLProgressElement).value).toBe(5)
  })

  it("the transfer ended with files that did not come (1.3.27): one closable line", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, feitas: 0, total: 0, ficheirosPerdidos: 1, razao: "ilegiveis" }} />)
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.historicoFicheirosPerdidos(1))
  })

  it("a page that failed three times (22/11/2026): the bar reaches the end and says how many messages did not come", () => {
    render(<BarraDoHistorico estado={{ ...base, feitas: 1437, total: 1437, notReceived: 66, media: { feitas: 3, total: 9 } }} />)
    const texto = screen.getByRole("status").textContent ?? ""
    expect(texto).toContain(strings.sincronia.historicoMedia(3, 9))
    expect(texto).toContain(strings.sincronia.historyNotReceived(66))
    expect(texto).not.toContain(strings.sincronia.historico(1437, 1503))
  })

  it("the transfer ended with messages this device gave up on: one closable line", () => {
    render(<BarraDoHistorico estado={{ ...base, aTrazer: false, feitas: 0, total: 0, notReceived: 66, razao: "ilegiveis" }} />)
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.historyNotReceived(66))
    expect(strings.sincronia.historyNotReceived(1)).toMatch(/^(1 message did not come|1 mensagem não chegou)\./)
  })

  it("each real failure of a page writes the reason to the diagnostic log", () => {
    clearDiagnostics()
    logPageFailure({ reason: "silent", attempt: 2 })
    logPageFailure({ reason: "silent", attempt: 3, notReceived: 66 })
    const linhas = diagnosticsSnapshot().filter((d) => d.code === "history-page-failed")
    expect(linhas.map((d) => [d.detail, d.outcome])).toEqual([
      ["silent attempt=2", "retry"],
      ["silent attempt=3 skipped=66", "skipped"],
    ])
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
    const { container } = render(<BarraDoHistorico estado={{ ...base, aTrazer: false, faltam: 18, razao: "irmao-calado" }} noTopo />)
    expect(container.querySelector(".barra-historico-no-topo.barra-historico-aviso")).not.toBeNull()
    expect(container.querySelector(".barra-sincronia")).toBeNull()
  })
})
