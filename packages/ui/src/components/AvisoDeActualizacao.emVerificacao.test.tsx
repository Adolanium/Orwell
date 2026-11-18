import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { strings } from "../strings.js"
import { AvisoDeActualizacao } from "./AvisoDeActualizacao.js"

afterEach(cleanup)

/**
 * Windows, while the app waits before installing a version by itself (1.3.20,
 * review I1): the notice says when, and does not send anyone to download it
 * from the site, whose installer skips the signature, GitHub and the wait.
 */
describe("o aviso de versão nova, em verificação", () => {
  it("diz a data e não tem botão para descarregar", () => {
    const quando = Date.parse("2026-11-23T12:00:00Z")
    render(
      <AvisoDeActualizacao
        aviso={{ instalada: "1.3.20", disponivel: "1.3.21", emVerificacaoAte: quando }}
        onDescarregar={vi.fn()}
        onDispensar={vi.fn()}
      />,
    )
    const data = new Date(quando).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
    expect(screen.getByText(strings.actualizacao.emVerificacao(data))).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.actualizacao.descarregar })).toBeNull()
    expect(screen.getByRole("button", { name: strings.actualizacao.dispensar })).toBeTruthy()
  })

  it("sem espera, o aviso de sempre, com o botão", () => {
    render(<AvisoDeActualizacao aviso={{ instalada: "1.3.20", disponivel: "1.3.21" }} onDescarregar={vi.fn()} onDispensar={vi.fn()} />)
    expect(screen.getByRole("button", { name: strings.actualizacao.descarregar })).toBeTruthy()
  })
})
