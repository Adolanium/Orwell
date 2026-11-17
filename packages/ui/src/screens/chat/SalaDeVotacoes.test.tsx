import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import type { ChatMessage } from "../../types.js"
import type { VotacaoListada } from "../../lib/listarVotacoes.js"
import { RoomGlyph } from "../../components/SidebarIcons.js"
import { EscolherSalaDeVotacoes } from "./EscolherSalaDeVotacoes.js"
import { SalaDeVotacoes } from "./SalaDeVotacoes.js"

afterEach(cleanup)

function votacao(id: string, pergunta: string, fechada: boolean, sender = "@ana:s"): VotacaoListada {
  const message = { channel: "c", seq: 1, sender, payload: { t: "message", id, sentAt: Date.now() } } as ChatMessage
  return {
    id,
    message,
    votacao: { question: pergunta, options: ["Sim", "Não"] },
    apuramento: { porOpcao: [["@ana:s"], []], total: 1, minha: null, fechoEm: fechada ? Date.now() - 60_000 : null },
    room: "r",
    nomeDaSala: "Votações",
    fechoEm: fechada ? Date.now() - 60_000 : null,
  }
}

const LISTA = [votacao("a", "Jantar na sexta?", false), votacao("b", "Que cor tinha o muro?", true)]

function desenhar(extra: Partial<React.ComponentProps<typeof SalaDeVotacoes>> = {}): void {
  render(
    <SalaDeVotacoes
      nome="Votações"
      votacoes={LISTA}
      nameFor={(a) => a.slice(1, 4)}
      podeFechar={() => true}
      onFechar={() => {}}
      {...extra}
    />,
  )
}

describe("a sala de votações", () => {
  it("só tem votações: sem caixa de escrita nem conversa, abre nas Abertas", () => {
    desenhar({ onNova: () => {} })
    expect(screen.queryByPlaceholderText(strings.chat.composerPlaceholder)).toBeNull()
    expect(screen.getByRole("tab", { name: new RegExp(strings.salaDeVotacoes.abertas) }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("heading", { name: "Jantar na sexta?" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Que cor tinha o muro?" })).toBeNull()
  })

  it("ocupa a área toda, com o conteúdo numa coluna central de largura legível e os cartões empilhados", () => {
    const { container } = render(
      <SalaDeVotacoes nome="Votações" votacoes={[votacao("a", "Jantar na sexta?", false), votacao("c", "Outra?", false)]} nameFor={(a) => a} podeFechar={() => false} onFechar={() => {}} />,
    )
    const sala = container.querySelector("section.votacoes-pagina") as HTMLElement
    const miolo = sala.querySelector(":scope > .votacoes-pagina-miolo") as HTMLElement
    // The header, the tabs and every card live in the centred column; nothing sits beside it (no member column).
    expect(sala.children).toHaveLength(1)
    expect(miolo.querySelector(".votacoes-pagina-topo")).toBeTruthy()
    expect(miolo.querySelectorAll("li.votacoes-pagina-cartao")).toHaveLength(2)
    expect(miolo.querySelector("ul")?.children).toHaveLength(2)
  })

  it("«Nova votação» só aparece a quem pode escrever na sala, e quem não pode lê porquê", async () => {
    const nova = vi.fn()
    desenhar({ onNova: nova })
    await userEvent.click(screen.getByRole("button", { name: strings.salaDeVotacoes.nova }))
    expect(nova).toHaveBeenCalled()
    cleanup()
    desenhar()
    expect(screen.queryByRole("button", { name: strings.salaDeVotacoes.nova })).toBeNull()
    expect(screen.getByText(strings.salaDeVotacoes.soLeitura)).toBeTruthy()
  })

  it("as Fechadas têm as votações que fecharam, sem botões de votar", async () => {
    desenhar({ onVotar: () => {} })
    await userEvent.click(screen.getByRole("tab", { name: new RegExp(strings.salaDeVotacoes.fechadas) }))
    expect(screen.getByRole("heading", { name: "Que cor tinha o muro?" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.votacao.votarEm("Sim") })).toBeNull()
    expect(screen.getByText(/^Fechou a /)).toBeTruthy()
  })

  it("nas Abertas vota-se, e quem pode fecha antes do prazo", async () => {
    const votar = vi.fn()
    const fechar = vi.fn()
    desenhar({ onVotar: votar, onFechar: fechar, podeFechar: (v) => v.id === "a" })
    await userEvent.click(screen.getByRole("button", { name: strings.votacao.votarEm("Sim") }))
    expect(votar).toHaveBeenCalledWith(LISTA[0]?.message, 0)
    const cartao = screen.getByRole("heading", { name: "Jantar na sexta?" }).closest("li") as HTMLElement
    await userEvent.click(within(cartao).getByRole("button", { name: strings.votacao.fechar }))
    expect(fechar).toHaveBeenCalledWith(LISTA[0])
  })

  it("quem não pode fechar não vê «Fechar votação»", () => {
    desenhar({ podeFechar: () => false })
    expect(screen.queryByRole("button", { name: strings.votacao.fechar })).toBeNull()
  })
})

describe("o que o botão «Votações» da comunidade abre quando não há uma sala só", () => {
  const base = { onAbrir: () => {}, onCriar: () => {}, onVoltar: () => {} }

  it("com várias salas, uma lista para escolher", async () => {
    const abrir = vi.fn()
    render(<EscolherSalaDeVotacoes {...base} onAbrir={abrir} podeCriar={false} salas={[{ room: "a", name: "Obras" }, { room: "b", name: "Festa" }]} />)
    await userEvent.click(screen.getByRole("button", { name: "Festa" }))
    expect(abrir).toHaveBeenCalledWith("b")
  })

  it("sem nenhuma, quem pode criar salas vê «Criar sala de votações»", async () => {
    const criar = vi.fn()
    render(<EscolherSalaDeVotacoes {...base} onCriar={criar} podeCriar salas={[]} />)
    await userEvent.click(screen.getByRole("button", { name: strings.salaDeVotacoes.criarSala }))
    expect(criar).toHaveBeenCalled()
  })

  it("sem nenhuma, os outros só lêem que ainda não há votações", () => {
    render(<EscolherSalaDeVotacoes {...base} podeCriar={false} salas={[]} />)
    expect(screen.getByText(strings.salaDeVotacoes.semSalas)).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.salaDeVotacoes.criarSala })).toBeNull()
  })
})

describe("o ícone da sala de votações", () => {
  it("é próprio, e uma disposição desconhecida continua a desenhar-se como texto", () => {
    const desenho = (layout?: string): string =>
      render(<RoomGlyph kind="text" layout={layout} />).container.innerHTML
    const votacoes = desenho("polls")
    const texto = desenho(undefined)
    expect(votacoes).not.toBe(texto)
    expect(desenho("algo-novo")).toBe(texto)
  })
})
