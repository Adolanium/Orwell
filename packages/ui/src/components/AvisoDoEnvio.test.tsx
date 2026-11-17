import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { HistoricoDosIrmaos } from "../bridge.js"
import { en } from "../linguas/en.js"
import { pt } from "../linguas/pt.js"
import { strings } from "../strings.js"
import { AvisoDoEnvio } from "./BarraDoHistorico.js"

/**
 * "Keep this device on": on the device that sends the history
 * to a freshly paired phone, with the approved text and the progress line.
 */

afterEach(cleanup)

const parado: HistoricoDosIrmaos = { aTrazer: false, feitas: 0, total: 0, media: null, canais: [], inicial: false }

describe("AvisoDoEnvio", () => {
  it("sem envio, nada", () => {
    render(<AvisoDoEnvio estado={parado} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("nas mensagens: o título, o corpo e a linha do progresso, sem as fotografias ainda", () => {
    render(<AvisoDoEnvio estado={{ ...parado, envio: { mensagens: { feitas: 120, total: 400 }, fotografias: null } }} />)
    const aviso = screen.getByRole("status")
    expect(aviso.textContent).toContain(strings.sincronia.envioTitulo)
    expect(aviso.textContent).toContain(strings.sincronia.envioCorpo)
    expect(aviso.textContent).toContain(strings.sincronia.envioProgresso(120, 400, 0, null))
    expect(aviso.querySelector("progress")?.getAttribute("value")).toBe("120")
  })

  it("nas fotografias: a linha inteira, e a barra conta as fotografias", () => {
    render(<AvisoDoEnvio estado={{ ...parado, envio: { mensagens: { feitas: 400, total: 400 }, fotografias: { feitas: 3, total: 10 } } }} />)
    const aviso = screen.getByRole("status")
    expect(aviso.textContent).toContain(strings.sincronia.envioProgresso(400, 400, 3, 10))
    expect(aviso.querySelector("progress")?.getAttribute("max")).toBe("10")
  })

  it("os textos aprovados, nas duas línguas", () => {
    expect(en.sincronia?.envioTitulo).toBe("Keep this device on")
    expect(en.sincronia?.envioCorpo).toBe("Your phone is getting your message history from this device. Do not close Orwell here until it is done.")
    expect(en.sincronia?.envioProgresso?.(5, 9, 1, 2)).toBe("Sent: 5 of 9 messages · 1 of 2 photos")
    expect(pt.sincronia.envioTitulo).toBe("Deixa este aparelho ligado")
    expect(pt.sincronia.envioCorpo).toBe("O telemóvel está a receber o histórico das mensagens a partir deste aparelho. Não feches o Orwell aqui até acabar.")
    expect(pt.sincronia.envioProgresso(5, 9, 1, 2)).toBe("Enviado: 5 de 9 mensagens · 1 de 2 fotografias")
  })
})
