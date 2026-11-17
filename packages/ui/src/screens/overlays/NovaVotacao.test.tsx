import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { fechoPedido, NovaVotacao } from "./NovaVotacao.js"

afterEach(cleanup)

const abrir = (onSubmit = vi.fn().mockResolvedValue(undefined)): typeof onSubmit => {
  render(<NovaVotacao onSubmit={onSubmit} onCancel={() => {}} />)
  return onSubmit
}

const campo = (rotulo: string): HTMLElement => screen.getByLabelText(rotulo)
const botaoCriar = (): HTMLButtonElement =>
  screen.getByRole("button", { name: strings.votacao.confirmar }) as HTMLButtonElement

describe("criar uma votação", () => {
  it("abre com duas opções, porque uma pergunta com uma resposta não é uma pergunta", () => {
    abrir()
    expect(campo(strings.votacao.opcaoLabel(1))).toBeTruthy()
    expect(campo(strings.votacao.opcaoLabel(2))).toBeTruthy()
    expect(screen.queryByLabelText(strings.votacao.opcaoLabel(3))).toBeNull()
  })

  /**
   * The note says the two things the creator must know BEFORE creating, and
   * both are design decisions: votes are visible, and there is no deadline.
   *
   * It lives here and not just in a comment because it makes a backwards
   * promise: it does not promise secrecy, it says there is none. A product
   * that sells privacy cannot leave this unsaid where the person makes
   * the choice.
   */
  it("diz, antes de criar, que os votos são visíveis e que não há prazo", () => {
    abrir()
    expect(screen.getByText(strings.votacao.nota)).toBeTruthy()
  })

  it("o botão só acorda com pergunta e duas opções escritas", async () => {
    const user = userEvent.setup()
    abrir()
    expect(botaoCriar().disabled).toBe(true)

    await user.type(campo(strings.votacao.perguntaLabel), "Qual é o melhor dia?")
    expect(botaoCriar().disabled).toBe(true)

    await user.type(campo(strings.votacao.opcaoLabel(1)), "Segunda")
    // One option keeps not arriving: it is the same limit from the schema, applied
    // here because this is where there is a person to tell.
    expect(botaoCriar().disabled).toBe(true)

    await user.type(campo(strings.votacao.opcaoLabel(2)), "Terça")
    expect(botaoCriar().disabled).toBe(false)
  })

  it("entrega a pergunta e as opções, sem os campos que ficaram em branco", async () => {
    const user = userEvent.setup()
    const onSubmit = abrir()

    await user.type(campo(strings.votacao.perguntaLabel), "  Qual é o melhor dia?  ")
    await user.type(campo(strings.votacao.opcaoLabel(1)), "Segunda")
    await user.type(campo(strings.votacao.opcaoLabel(2)), "Terça")
    await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    await user.click(botaoCriar())

    // Sem mexer no prazo, vai o de um dia: quem cria decide, e o ponto de partida é este.
    const enviada = onSubmit.mock.calls[0]?.[0] as { question: string; options: string[]; closesAt?: number }
    expect(enviada).toMatchObject({ question: "Qual é o melhor dia?", options: ["Segunda", "Terça"] })
    expect(enviada.closesAt).toBeGreaterThan(Date.now() + 86_000_000)
    expect(enviada.closesAt).toBeLessThan(Date.now() + 86_500_000)
  })

  it("«Sem prazo» envia a votação sem fecho nenhum", async () => {
    const user = userEvent.setup()
    const onSubmit = abrir()
    await user.type(campo(strings.votacao.perguntaLabel), "Pergunta")
    await user.type(campo(strings.votacao.opcaoLabel(1)), "A")
    await user.type(campo(strings.votacao.opcaoLabel(2)), "B")
    await user.click(screen.getByRole("radio", { name: strings.votacao.prazoSem }))
    await user.click(botaoCriar())
    expect(onSubmit).toHaveBeenCalledWith({ question: "Pergunta", options: ["A", "B"] })
  })

  it("a data e hora passada não deixa criar, e diz porquê", async () => {
    const user = userEvent.setup()
    abrir()
    await user.type(campo(strings.votacao.perguntaLabel), "Pergunta")
    await user.type(campo(strings.votacao.opcaoLabel(1)), "A")
    await user.type(campo(strings.votacao.opcaoLabel(2)), "B")
    await user.click(screen.getByRole("radio", { name: strings.votacao.prazoData }))
    await user.type(campo(strings.votacao.dataLabel), "2020-01-01T10:00")
    expect(screen.getByText(strings.votacao.prazoPassado)).toBeTruthy()
    expect(botaoCriar().disabled).toBe(true)
  })

  it("acrescentar dá mais uma opção", async () => {
    const user = userEvent.setup()
    abrir()
    await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    expect(campo(strings.votacao.opcaoLabel(3))).toBeTruthy()
  })

  it("retirar só aparece acima das duas do princípio", async () => {
    const user = userEvent.setup()
    abrir()
    expect(screen.queryByRole("button", { name: strings.votacao.retirarOpcao(1) })).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    expect(screen.getByRole("button", { name: strings.votacao.retirarOpcao(3) })).toBeTruthy()
  })

  /**
   * At the cap, the button does not disappear: the phrase explaining why stays.
   * An option that vanishes and comes back on its own makes people doubt what
   * they saw.
   */
  it("no tecto das opções, diz-se o tecto em vez de o botão sumir", async () => {
    const user = userEvent.setup()
    abrir()
    for (let restantes = 8; restantes > 0; restantes -= 1) {
      await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    }
    expect(screen.queryByRole("button", { name: strings.votacao.acrescentar })).toBeNull()
    expect(screen.getByText(strings.votacao.opcoesCheias(10))).toBeTruthy()
  })
})

describe("fechoPedido", () => {
  const AGORA = Date.UTC(2026, 10, 16, 12, 0, 0)
  it("duração em horas e em dias", () => {
    expect(fechoPedido("duracao", "3", "h", "", AGORA)).toEqual({ ok: true, em: AGORA + 3 * 3_600_000 })
    expect(fechoPedido("duracao", "2", "d", "", AGORA)).toEqual({ ok: true, em: AGORA + 2 * 86_400_000 })
  })
  it("recusa zero, passado, vazio e mais de 30 dias", () => {
    expect(fechoPedido("duracao", "0", "h", "", AGORA)).toEqual({ ok: false, motivo: "passado" })
    expect(fechoPedido("duracao", "", "h", "", AGORA)).toEqual({ ok: false, motivo: "vazio" })
    expect(fechoPedido("duracao", "31", "d", "", AGORA)).toEqual({ ok: false, motivo: "longo" })
    expect(fechoPedido("data", "", "d", "", AGORA)).toEqual({ ok: false, motivo: "vazio" })
    expect(fechoPedido("data", "", "d", "2020-01-01T10:00", AGORA)).toEqual({ ok: false, motivo: "passado" })
  })
  it("data e hora no futuro, lida na zona deste aparelho", () => {
    const quando = fechoPedido("data", "", "d", "2026-11-20T18:30", AGORA)
    expect(quando).toEqual({ ok: true, em: new Date("2026-11-20T18:30").getTime() })
  })
  it("sem prazo não tem fecho", () => {
    expect(fechoPedido("sem", "", "d", "", AGORA)).toEqual({ ok: true, em: null })
  })
})
