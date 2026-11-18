import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../strings.js"
import { apurar, votosDe } from "../lib/votacoes.js"
import type { ChatMessage } from "../types.js"
import { SemVotoContext } from "./semVoto.js"
import { Votacao } from "./Votacao.js"

/** Only accounts created 5 days ago or more vote (17/11/2026). */
afterEach(cleanup)

const DIA = 86_400_000
const VOTACAO = { question: "Jantar na sexta?", options: ["Sim", "Não"] }

describe("uma conta com menos de 5 dias", () => {
  it("vê as opções desligadas e a frase que diz porquê", async () => {
    const onVote = vi.fn()
    render(
      <SemVotoContext.Provider value={strings.votacao.semVotoContaNova}>
        <Votacao votacao={VOTACAO} apuramento={apurar(new Map(), 2, "@nova:s")} nameFor={(a) => a} onVote={onVote} />
      </SemVotoContext.Provider>,
    )
    const sim = screen.getByRole("button", { name: strings.votacao.votarEm("Sim") }) as HTMLButtonElement
    expect(sim.disabled).toBe(true)
    await userEvent.click(sim)
    expect(onVote).not.toHaveBeenCalled()
    expect(screen.getByText("Só podes votar 5 dias depois de criares a conta.")).toBeTruthy()
  })

  it("sem motivo, as opções votam como sempre", () => {
    render(<Votacao votacao={VOTACAO} apuramento={apurar(new Map(), 2, "@a:s")} nameFor={(a) => a} onVote={vi.fn()} />)
    expect((screen.getByRole("button", { name: strings.votacao.votarEm("Sim") }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(strings.votacao.semVotoContaNova)).toBeNull()
  })
})

describe("a contagem só leva os votos de contas com 5 dias no instante do voto", () => {
  const criada: Record<string, number> = { "@velha:s": 0, "@quase:s": 10 * DIA, "@cinco:s": 10 * DIA }
  const voto = (sender: string, at: number, opcao: number): ChatMessage =>
    ({ channel: "!c:s", seq: at, sender, payload: { t: "post.reaction", target: "v1", vote: opcao, at } }) as unknown as ChatMessage
  const podeContar = (quem: string, at: number): boolean => criada[quem] !== undefined && at - criada[quem]! >= 5 * DIA

  it("4 dias e 23 horas não conta; 5 dias conta; e a de 4 dias não entra na lista de quem votou", () => {
    const votos = votosDe(
      [voto("@velha:s", 20 * DIA, 0), voto("@quase:s", 10 * DIA + 5 * DIA - 3_600_000, 1), voto("@cinco:s", 15 * DIA, 1)],
      undefined,
      podeContar,
    )
    const escolhas = votos.get("v1")
    expect([...(escolhas?.keys() ?? [])].sort()).toEqual(["@cinco:s", "@velha:s"])
    const apuramento = apurar(escolhas, 2, null)
    expect(apuramento.total).toBe(2)
    expect(apuramento.porOpcao[1]).toEqual(["@cinco:s"])
  })

  it("um voto novo recusado não apaga o voto anterior válido da mesma pessoa", () => {
    const votos = votosDe([voto("@cinco:s", 15 * DIA, 0), voto("@desconhecida:s", 16 * DIA, 1)], undefined, podeContar)
    expect([...(votos.get("v1")?.entries() ?? [])]).toEqual([["@cinco:s", 0]])
  })
})
