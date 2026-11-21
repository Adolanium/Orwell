import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import type { CargoDoMembro } from "../../lib/agruparMembros.js"
import { en } from "../../linguas/en.js"
import { strings } from "../../strings.js"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ALTURA_DA_LINHA, janelaDaLista, MemberPanel } from "./MemberPanel.js"

afterEach(cleanup)

const noop = (): void => {}

function panel(overrides: Partial<React.ComponentProps<typeof MemberPanel>>): React.JSX.Element {
  return (
    <MemberPanel
      channel="!geral:localhost:8448"
      members={[]}
      state="ready"
      onRetry={noop}
      me={null}
      directory={new Map<string, Profile>()}
      nameFor={(sender) => sender}
      onInvite={noop}
      onUserMenu={noop}
      onOpenProfile={noop}
      {...overrides}
    />
  )
}

/**
 * Invite, and the gate we don't promise to those it will turn away.
 *
 * The buttons appeared for everyone. Non-founders who tapped them would see the
 * sheet open, "Create link" would respond "you don't have the power to invite to
 * this channel", and that was it. It was the most repeated fault in one swarm
 * run: thirteen failures in twenty-three, always in non-founder bots.
 *
 * No test covered these buttons, which is why they survived. These cover them,
 * and they bite both ways: without the power they don't appear, with it they do.
 */
describe("MemberPanel — convidar", () => {
  it("sem a responsabilidade de convidar, os botões não aparecem", () => {
    render(panel({ podeConvidar: false }))

    expect(screen.queryByText(strings.members.inviteSomeone)).toBeNull()
  })

  it("com a responsabilidade, o botão é o primário e não leva nota por baixo", () => {
    render(panel({ podeConvidar: true }))
    const botao = screen.getByRole("button", { name: new RegExp(strings.members.inviteSomeone) })
    expect(botao.classList.contains("primary")).toBe(true)
    expect(document.querySelector(".members-footer .field-note")).toBeNull()
  })

  it("com a responsabilidade, aparece UM botão, que abre a folha única", async () => {
    // There were two ("Invite someone" and "Create invite link") for two sheets.
    // The invite sheet has all three modes, and the footer has one gate only.
    const user = userEvent.setup()
    const onInvite = vi.fn()
    render(panel({ podeConvidar: true, onInvite }))

    const botoes = screen.getAllByRole("button", { name: new RegExp(strings.members.inviteSomeone) })
    expect(botoes).toHaveLength(1)
    await user.click(botoes[0]!)
    expect(onInvite).toHaveBeenCalledOnce()
  })

  it("sem resposta à pergunta, trata-se como não pode", () => {
    // An old host doesn't know how to answer `mayInvite`. The safe read is to hide:
    // showing it promises something the core will reject.
    render(panel({}))
    expect(screen.queryByText(strings.members.inviteSomeone)).toBeNull()
  })
})

describe('MemberPanel — o "⋯" de cada linha', () => {
  it("abre o menu da pessoa, o mesmo do botão direito", async () => {
    const user = userEvent.setup()
    const onUserMenu = vi.fn()
    render(panel({ members: ["@ana:s"], onUserMenu, nameFor: () => "Ana" }))
    await user.click(screen.getByRole("button", { name: strings.people.rowMore("Ana") }))
    expect(onUserMenu).toHaveBeenCalledOnce()
    expect(onUserMenu.mock.calls[0]?.[0]).toBe("@ana:s")
  })
})

describe("MemberPanel", () => {
  it("em erro mostra a mensagem e o retry chama onRetry", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(panel({ state: "error", onRetry }))

    expect(screen.getByText("Não foi possível carregar os membros.")).toBeTruthy()
    await user.click(screen.getByText("Tentar de novo"))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("vazio depois de carregar diz 'Ainda ninguém aqui.', não 'A carregar…'", () => {
    render(panel({ state: "ready", members: [] }))
    expect(screen.getByText("Ainda ninguém aqui.")).toBeTruthy()
    expect(screen.queryByText("A carregar…")).toBeNull()
  })

  it("a carregar mostra esqueleto e não finge uma sala vazia", () => {
    const { container } = render(panel({ state: "loading" }))
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0)
    expect(screen.queryByText("Ainda ninguém aqui.")).toBeNull()
    expect(screen.queryByText("Não foi possível carregar os membros.")).toBeNull()
  })

  it("pronto lista os membros com os nomes resolvidos", () => {
    render(panel({ state: "ready", members: ["@abc:server"], nameFor: () => "Alice" }))
    expect(screen.getByText("Alice")).toBeTruthy()
    expect(screen.getByText("1 pessoa")).toBeTruthy()
  })

  it("como painel deslizante, abre e fecha pela classe 'open'", () => {
    const { container, rerender } = render(panel({ open: false }))
    const aside = container.querySelector("aside.members")
    expect(aside?.classList.contains("open")).toBe(false)

    rerender(panel({ open: true }))
    expect(aside?.classList.contains("open")).toBe(true)

    rerender(panel({ open: false }))
    expect(aside?.classList.contains("open")).toBe(false)
  })
})

/**
 * In a people list, clicking a person shows that person.
 *
 * The tap used to open the safety number, which is not what anyone looks for
 * by tapping a name. The verification didn't disappear: it moved into the
 * profile, where it finally has a label instead of just a tooltip.
 */
describe("MemberPanel — clicar numa pessoa abre o perfil dela", () => {
  it("o clique pede o perfil, e o botão direito continua a abrir o menu", async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    const onUserMenu = vi.fn()
    render(panel({ members: ["@ana:s"], nameFor: () => "Ana", onOpenProfile, onUserMenu }))

    // The row, not its "⋯": both say the name.
    const linha = document.querySelector(".member-row") as HTMLElement
    expect(linha.getAttribute("title")).toBe("Ver o perfil de Ana")

    await user.click(linha)
    expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith("@ana:s")

    fireEvent.contextMenu(linha, { clientX: 10, clientY: 20 })
    expect(onUserMenu).toHaveBeenCalledWith("@ana:s", { x: 10, y: 20 })
  })

  it("a própria linha também abre, e diz que o perfil é o nosso", async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    render(panel({ members: ["@eu:s"], me: "@eu:s", nameFor: () => "Eu", onOpenProfile }))

    // It was inert, because the safety number against ourselves doesn't mean
    // anything. Seeing yourself as others see you does.
    const linha = document.querySelector(".member-row") as HTMLElement
    expect(linha.getAttribute("title")).toBe(strings.sidebar.myProfile)
    await user.click(linha)
    expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith("@eu:s")
  })
})

describe("avatares reais nas linhas de membros", () => {
  it("membro com avatar no directory rende a imagem; sem ele, a inicial", () => {
    const directory = new Map<string, Profile>([
      ["@ana:s", { displayName: "Ana", donations: [], avatarDataUrl: "data:image/png;base64,AAAA" }],
      ["@rui:s", { displayName: "Rui", donations: [] }],
    ])
    const { container } = render(
      panel({ members: ["@ana:s", "@rui:s"], directory, nameFor: (m) => (m === "@ana:s" ? "Ana" : "Rui") }),
    )

    const images = container.querySelectorAll(".message-avatar img")
    expect(images).toHaveLength(1)
    expect(images[0]?.getAttribute("src")).toBe("data:image/png;base64,AAAA")
    // Rui gets the initial, honest, until he publishes a picture.
    expect(container.textContent).toContain("R")
  })
})

/**
 * In the people list, the owner appears.
 *
 * The sub-row showed the address, which is what you give someone to invite them,
 * not what you look for when scanning a people list. Members with a role in the
 * channel show it there; those without one keep showing the address.
 */
describe("MemberPanel — papéis", () => {
  it("mostra o papel de quem o tem, e o endereço de quem não tem", () => {
    render(
      panel({
        members: ["@fundador:s", "@simples:s"],
        state: "ready",
        roleFor: (address) => (address === "@fundador:s" ? { label: "Fundador" } : null),
      }),
    )
    expect(screen.getByText("Fundador")).toBeTruthy()
    // The other person's address is still there, shortened as it always was.
    expect(screen.queryByText("Fundador")).toBeTruthy()
    expect(screen.getAllByText(/@simples/).length).toBeGreaterThan(0)
  })

  /**
   * The role color in the sub-row.
   *
   * What these two store is not the hue: it's that color NEVER replaces the
   * text, and that its absence stays absent. A role without color must come out
   * of here exactly as it did before colors existed, with no variable written,
   * so the style sheet can fall back to the accent as always.
   */
  it("a cor entra por variável, e o nome do papel continua escrito", () => {
    const { container } = render(
      panel({
        members: ["@ana:s"],
        state: "ready",
        roleFor: () => ({ label: "Moderador", tint: "#6ee7a8" }),
      }),
    )
    const sub = container.querySelector(".member-sub .member-role")
    expect(sub?.getAttribute("style")).toContain("--role-tint: #6ee7a8")
    // The essential: whoever can't see the color reads the same word they always did.
    expect(sub?.textContent).toBe("Moderador")
  })

  it("um papel sem cor não escreve variável nenhuma: fica como sempre foi", () => {
    const { container } = render(
      panel({ members: ["@ana:s"], state: "ready", roleFor: () => ({ label: "Convidado" }) }),
    )
    const sub = container.querySelector(".member-sub .member-role")
    expect(sub?.getAttribute("style")).toBeNull()
    expect(sub?.className).toContain("member-role")
  })
})

/**
 * Who is in a call with the mic off, in the members list.
 *
 * The members list is for the CHANNEL, not the call: the vast majority of people
 * there are not on any voice. That's why the state comes in through a function,
 * and without it we say nothing about anyone, which is the normal case.
 */
/**
 * The list sorted by role, and by who is online.
 *
 * The requirement: "the users on the right should be
 * organized by role. Online/offline, like discord". The list used to come out
 * by address order, which is a random string that decided who appears first.
 *
 * The rules live in `agruparMembros` and have their own tests, which are the
 * ones that bite the arithmetic. These bite something else, the one that broke
 * before: **what the panel DRAWS from them**, headers with counts, the offline
 * block marked as such, and each person once only.
 */
describe("MemberPanel — a lista arrumada por cargos", () => {
  const MOD: CargoDoMembro = { label: "Moderador", grupo: { id: "mod", nome: "Moderador", ordem: 2 } }

  const cabecalhos = (): string[] =>
    [...document.querySelectorAll(".member-group-head")].map((cabecalho) => cabecalho.textContent ?? "")

  it("um cabeçalho por grupo, com o nome do cargo e a contagem", () => {
    render(
      panel({
        members: ["@ana:s", "@bruno:s"],
        nameFor: (quem) => quem,
        roleFor: (quem) => (quem === "@ana:s" ? MOD : null),
        presenceFor: () => "active",
      }),
    )

    expect(cabecalhos()).toEqual([
      strings.members.groupHeading("Moderador", 1),
      strings.members.groupHeading(strings.members.groupOnline, 1),
    ])
  })

  it("quem está fora vai para o último bloco, marcado como tal", () => {
    render(
      panel({
        members: ["@ana:s", "@bruno:s"],
        nameFor: (quem) => quem,
        presenceFor: (quem) => (quem === "@bruno:s" ? "idle" : "active"),
      }),
    )

    const offline = document.querySelector(".member-group.offline")
    expect(offline).toBeTruthy()
    expect(offline?.querySelector(".member-group-head")?.textContent).toBe(
      strings.members.groupHeading(strings.members.groupOffline, 1),
    )
    // Faded is a CSS choice; what the test pins down is that the block stands out,
    // so CSS has something to grab.
    expect(offline?.querySelectorAll(".member-row")).toHaveLength(1)
  })

  it("ocupado conta como presente: é gente que está lá", () => {
    render(panel({ members: ["@ana:s"], nameFor: (quem) => quem, presenceFor: () => "busy" }))

    expect(document.querySelector(".member-group.offline")).toBeNull()
  })

  it("sem ninguém a responder sobre presença, está toda a gente online", () => {
    // A host that can't answer can't make the whole list look empty. Absent is
    // "I don't know", and the safe read is "they're here".
    render(panel({ members: ["@ana:s", "@bruno:s"], nameFor: (quem) => quem }))

    expect(document.querySelector(".member-group.offline")).toBeNull()
    expect(document.querySelectorAll(".member-row")).toHaveLength(2)
  })

  it("cada pessoa aparece uma vez, tenha os cargos que tiver", () => {
    render(
      panel({
        members: ["@ana:s", "@bruno:s", "@carla:s"],
        nameFor: (quem) => quem,
        roleFor: (quem) => (quem === "@carla:s" ? null : MOD),
        presenceFor: (quem) => (quem === "@bruno:s" ? "idle" : "active"),
      }),
    )

    expect(document.querySelectorAll(".member-row")).toHaveLength(3)
  })
})

describe("MemberPanel — o microfone desligado de quem está em voz", () => {
  it("sem ninguém a dizer quem está calado, não há marca nenhuma", () => {
    const { container } = render(panel({ members: ["@ana:s", "@rui:s"], state: "ready" }))
    expect(container.querySelectorAll(".member-mic-off")).toHaveLength(0)
  })

  it("marca só quem está calado, e deixa os outros em paz", () => {
    const { container } = render(
      panel({
        members: ["@ana:s", "@rui:s"],
        state: "ready",
        micCaladoDe: (address) => address === "@ana:s",
      }),
    )
    const marcas = container.querySelectorAll(".member-mic-off")
    expect(marcas).toHaveLength(1)
    // Inside Ana's row, not in a separate column that the whole list would have to
    // open for something that's hardly ever there.
    expect(marcas[0]?.closest(".member-row")?.textContent).toContain("@ana:s")
  })

  it("a marca diz de quem é, pelo nome resolvido e não pelo endereço", () => {
    const { container } = render(
      panel({ members: ["@ana:s"], state: "ready", nameFor: () => "Ana", micCaladoDe: () => true }),
    )
    expect(container.querySelector(".member-mic-off")?.getAttribute("aria-label")).toBe(
      strings.call.micOffOf("Ana"),
    )
  })

  it("é um desenho que herda a cor, como todos os ícones deste produto", () => {
    const { container } = render(panel({ members: ["@ana:s"], state: "ready", micCaladoDe: () => true }))
    const svg = container.querySelector(".member-mic-off svg")
    expect(svg).toBeTruthy()
    // The glyph went from stroke to solid, so the color is no longer in an `<svg>`
    // `stroke`: it's in each piece. Outside the mask (which is black and white by
    // definition) everything that paints has to paint with `currentColor`.
    const pintadas = [...(svg?.querySelectorAll("rect, path") ?? [])].filter((peca) => !peca.closest("mask"))
    expect(pintadas.length).toBeGreaterThan(0)
    for (const peca of pintadas) {
      const tintas = [peca.getAttribute("fill"), peca.getAttribute("stroke")].filter((t) => t !== null && t !== "none")
      expect(tintas.length).toBeGreaterThan(0)
      for (const tinta of tintas) expect(tinta).toBe("currentColor")
    }
  })
})

/**
 * The gate of the common channel, stated in the list of who is there.
 *
 * The fault: the common room is open to any account on the server, by decision
 * taken and written in `gateway.ts` (`channel.groupinfo.take`), and the only
 * place in the app where this showed up was a welcome card you dismiss once and
 * never see again. Someone who closed it three weeks ago is still writing in a
 * public channel looking at a list of four names.
 *
 * This list is where the question gets asked, "who can read this", and it's
 * where the answer was most incomplete: today's names, with a footer of invites
 * teaching that the only way in is to be invited.
 */
describe("MemberPanel — o canal comum diz que está aberto", () => {
  it("num canal comum, a lista diz que a porta está aberta", () => {
    render(panel({ oficial: true, members: ["@ana:s"], state: "ready" }))
    expect(screen.getByText(strings.members.openChannel)).toBeTruthy()
  })

  it("num canal normal não diz nada disso: a porta lá é mesmo fechada", () => {
    render(panel({ oficial: false, members: ["@ana:s"], state: "ready" }))
    expect(screen.queryByText(strings.members.openChannel)).toBeNull()
  })

  it("sem resposta sobre a oficialidade, cala-se: um canal que não se sabe aberto não se anuncia aberto", () => {
    render(panel({ members: ["@ana:s"], state: "ready" }))
    expect(screen.queryByText(strings.members.openChannel)).toBeNull()
  })

  it("não depende de poder convidar: saber onde se está não é responsabilidade nenhuma", () => {
    // The whole footer disappears for those who can't invite. If the sentence had
    // gone in there, the people who need it most are exactly the ones who wouldn't see it.
    render(panel({ oficial: true, podeConvidar: false, members: ["@ana:s"], state: "ready" }))
    expect(screen.getByText(strings.members.openChannel)).toBeTruthy()
  })

  it("fica por cima dos nomes, que é a contagem que ela corrige", () => {
    const { container } = render(panel({ oficial: true, members: ["@ana:s"], state: "ready" }))
    const aviso = container.querySelector(".members-open")
    const lista = container.querySelector(".member-list")
    expect(aviso).toBeTruthy()
    expect(lista).toBeTruthy()
    // `compareDocumentPosition` instead of counting children: what we store is the
    // reading order, not the exact position in the DOM.
    expect(aviso?.compareDocumentPosition(lista as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("e a frase nomeia a conta e o servidor, que é o que a torna verificável", () => {
    // Without "account" and without "server" this becomes a generic "public channel"
    // alert, which is what the welcome card already said and it wasn't enough.
    expect(strings.members.openChannel).toContain("conta")
    expect(strings.members.openChannel).toContain("servidor")
  })
})

/**
 * The people list, when it's a drawer.
 *
 * On a narrow screen this column stops being NEXT TO the conversation and starts
 * being ON TOP of it. Until now it opened with a 34px handle and the only way to
 * get it off was to hit the same handle again: no veil to tap, no Escape, and the
 * conversation hidden behind 280px of opaque panel.
 *
 * It gains the contract the channel bar already had, so we measure here the same
 * thing we measure there: veil that closes on tap, Escape that closes, and focus
 * returning to the handle that opened it. On a wide screen none of this exists,
 * and it's the absent `onClose` that says so.
 */
describe("MemberPanel — a gaveta fecha-se", () => {
  it("com a gaveta aberta há véu, e tocar-lhe fecha", () => {
    const fechar = vi.fn()
    render(panel({ open: true, onClose: fechar }))

    const veu = document.querySelector(".members-scrim")
    expect(veu).not.toBeNull()
    fireEvent.mouseDown(veu as Element)
    expect(fechar).toHaveBeenCalledTimes(1)
  })

  it("Escape fecha a gaveta", () => {
    const fechar = vi.fn()
    render(panel({ open: true, onClose: fechar }))

    fireEvent.keyDown(document, { key: "Escape" })
    expect(fechar).toHaveBeenCalledTimes(1)
  })

  it("aberta, anuncia-se como diálogo e tem nome", () => {
    render(panel({ open: true, onClose: noop }))

    const painel = screen.getByRole("dialog")
    expect(painel.getAttribute("aria-label")).toBe(strings.members.drawerLabel)
    expect(painel.classList.contains("open")).toBe(true)
  })

  it("fechada não é diálogo nenhum, e não há véu por cima da conversa", () => {
    render(panel({ open: false, onClose: noop }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.querySelector(".members-scrim")).toBeNull()
  })

  it("em ecrã largo (sem onClose) é uma coluna: sem véu, sem diálogo, e o Escape não faz nada", () => {
    render(panel({ open: true }))

    expect(document.querySelector(".members-scrim")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    // Without breaking: it's what a column does when you press Escape.
    fireEvent.keyDown(document, { key: "Escape" })
  })

  it("ao fechar, o foco volta para a pega que a abriu", () => {
    const pega = document.createElement("button")
    document.body.appendChild(pega)
    pega.focus()
    expect(document.activeElement).toBe(pega)

    const { rerender } = render(panel({ open: true, onClose: noop, podeConvidar: true }))
    // Focus entered the drawer: it's no longer on the handle.
    expect(document.activeElement).not.toBe(pega)

    rerender(panel({ open: false, onClose: noop, podeConvidar: true }))
    expect(document.activeElement).toBe(pega)
    pega.remove()
  })

  it("as duas línguas nomeiam a gaveta, e sem travessões", () => {
    expect(strings.members.drawerLabel).toBe("Pessoas")
    expect(en.members?.drawerLabel).toBe("People")
    expect(strings.members.drawerLabel).not.toMatch(/[—–]/)
  })
})

/** Each member's face ring: color by state, and pulsing only in a call. */
describe("MemberPanel — o anel de presença", () => {
  it("pinta o estado de cada um e pulsa só em quem está em chamada", () => {
    const estados = { "@ana:s": "active", "@bru:s": "busy", "@cid:s": "idle" } as const
    const { container } = render(
      panel({
        members: Object.keys(estados),
        presenceFor: (address) => estados[address as keyof typeof estados],
        emChamada: (address) => address === "@bru:s",
      }),
    )
    const aneis = [...container.querySelectorAll<HTMLElement>("[data-anel]")]
    const porEstado = Object.fromEntries(aneis.map((anel) => [anel.dataset["anel"], anel.hasAttribute("data-em-chamada")]))

    expect(porEstado).toEqual({ online: false, ocupado: true, offline: false })
  })
})

/** The requirement: "I don't want ids exposed". */
describe("MemberPanel — o id não se lê", () => {
  it('sem papel não há linha por baixo do nome, e o id não se copia por botão ao lado (vai pelo menu "⋯")', () => {
    // The requirement: "I don't want the copy id symbol next to the user, it's already in the … menu".
    const { container } = render(panel({ members: ["@garbicis-xapsensis:orwell.pt"], nameFor: () => "Ana" }))
    expect(container.textContent).not.toContain("garbicis")
    expect(container.querySelector(".member-sub")).toBeNull()
    expect(screen.queryByRole("button", { name: strings.copiarId.de("Ana") })).toBeNull()
    expect(screen.getByRole("button", { name: strings.people.rowMore("Ana") })).toBeTruthy()
  })

  it("com papel, a linha de baixo diz o papel e mais nada", () => {
    render(
      panel({
        members: ["@ana:s"],
        nameFor: () => "Ana",
        roleFor: () => ({ label: "Fundador", grupo: { id: "fundador", nome: "Fundador", ordem: 0 } }),
      }),
    )
    const papel = document.querySelector(".member-sub")
    expect(papel?.textContent).toBe("Fundador")
    expect(papel?.querySelector(".member-role")?.textContent).toBe("Fundador")
  })
})

/**
 * The state appears in a subline after the role (17/11/2026).
 *
 * Line 1 is the name, cut at 12 graphemes. Line 2 is the role, then the
 * state: the custom status text when there is one, otherwise busy or away.
 * Small, faded, cut with "…" when it does not fit, and whole in the tooltip.
 * It replaced the status that scrolled next to the name (the `Andante`).
 */
describe("MemberPanel — o estado na linha de baixo, depois do cargo", () => {
  const ESTADO = "a pintar o montado ao fim da tarde"
  const comPerfil = (perfil: Partial<Profile>): Map<string, Profile> =>
    new Map<string, Profile>([["@ana:s", { displayName: "Ana", donations: [], ...perfil }]])
  const MODERADOR = { label: "Moderador", tint: "#6ee7a8" } as CargoDoMembro

  it("cargo e estado: «Moderador · estado», o inteiro no title, e o nome sozinho na linha 1", () => {
    const { container } = render(
      panel({ members: ["@ana:s"], nameFor: () => "Ana", directory: comPerfil({ statusText: ESTADO }), roleFor: () => MODERADOR }),
    )
    const sub = container.querySelector(".member-sub")!
    expect(sub.textContent).toBe(`Moderador · ${ESTADO}`)
    expect(sub.getAttribute("title")).toBe(`Moderador · ${ESTADO}`)
    expect(container.querySelector(".member-name")?.textContent).toBe("Ana")
    // The role keeps its colour; the state does not take it.
    expect(sub.querySelector(".member-role")?.getAttribute("style")).toContain("--role-tint: #6ee7a8")
    expect(sub.querySelector(".member-estado")?.getAttribute("style")).toBeNull()
  })

  it("sem cargo, só o estado", () => {
    const { container } = render(panel({ members: ["@ana:s"], nameFor: () => "Ana", directory: comPerfil({ statusText: ESTADO }) }))
    expect(container.querySelector(".member-sub")?.textContent).toBe(ESTADO)
    expect(container.querySelector(".member-role")).toBeNull()
  })

  it("sem texto de estado, ocupado ou ausente", () => {
    const { container } = render(
      panel({
        members: ["@ana:s", "@rui:s"],
        nameFor: (a) => (a === "@ana:s" ? "Ana" : "Rui"),
        presenceFor: (a) => (a === "@ana:s" ? "busy" : "away"),
        roleFor: (a) => (a === "@rui:s" ? MODERADOR : null),
      }),
    )
    const subs = [...container.querySelectorAll(".member-sub")].map((e) => e.textContent).sort()
    expect(subs).toEqual([strings.activity.busy, `Moderador · ${strings.activity.away}`].sort())
  })

  it("o texto de estado ganha a ocupado", () => {
    const { container } = render(
      panel({ members: ["@ana:s"], nameFor: () => "Ana", directory: comPerfil({ statusText: ESTADO }), presenceFor: () => "busy" }),
    )
    expect(container.querySelector(".member-sub")?.textContent).toBe(ESTADO)
  })

  it("online sem estado nem cargo: não há linha de baixo", () => {
    const { container } = render(panel({ members: ["@ana:s"], nameFor: () => "Ana", presenceFor: () => "active" }))
    expect(container.querySelector(".member-sub")).toBeNull()
  })

  it("o estado já não anda ao lado do nome", () => {
    const { container } = render(panel({ members: ["@ana:s"], nameFor: () => "Ana", directory: comPerfil({ statusText: ESTADO }) }))
    expect(container.querySelector(".member-name .member-status, .member-name .andante")).toBeNull()
    expect(container.querySelector(".member-name")?.textContent).not.toContain(ESTADO)
  })

  it("um nome antigo de 30 aparece com 12 e «…» na linha 1", () => {
    const antigo = "Maria Eduarda Albuquerque Sous"
    const { container } = render(panel({ members: ["@ana:s"], nameFor: () => antigo }))
    expect(container.querySelector(".member-name")?.textContent).toBe("Maria Eduard…")
    expect(container.querySelector(`.member-name [title="${antigo}"]`)).not.toBeNull()
  })
})

/**
 * A big channel shows only who is online (12/11/2026). The common room
 * has 409 members: drawing all of them, and asking for their names, on every
 * login was work for people nobody was looking at.
 */
describe("MemberPanel — canal grande", () => {
  const membros = Array.from({ length: 120 }, (_, i) => `@m${String(i).padStart(3, "0")}:s`)
  const ligados = new Set(membros.slice(0, 5))
  const presenceFor = (address: string): "active" | "idle" => (ligados.has(address) ? "active" : "idle")

  it("mostra só quem está ligado, e uma linha com quantos faltam", () => {
    render(panel({ members: membros, presenceFor }))
    expect(document.querySelectorAll(".member-row")).toHaveLength(5)
    expect(screen.getByRole("button", { name: strings.members.maisPessoas(115) })).toBeTruthy()
  })

  it("a linha abre a lista inteira em janela, e pede os nomes só das linhas que se vêem", async () => {
    const user = userEvent.setup()
    const pedirPerfis = vi.fn()
    render(panel({ members: membros, presenceFor, pedirPerfis }))
    await user.click(screen.getByRole("button", { name: strings.members.maisPessoas(115) }))
    const linhas = document.querySelectorAll(".member-janela .member-row").length
    expect(linhas).toBeGreaterThan(0)
    expect(linhas).toBeLessThan(40)
    const pedidas = pedirPerfis.mock.calls.flatMap(([contas]) => contas as string[])
    expect(pedidas.length).toBe(linhas)
    expect(pedidas.every((conta) => !ligados.has(conta))).toBe(true)
    expect(screen.getByRole("button", { name: strings.members.esconderMaisPessoas })).toBeTruthy()
  })

  it("um canal pequeno continua a mostrar toda a gente, ligada ou não", () => {
    render(panel({ members: membros.slice(0, 20), presenceFor }))
    expect(document.querySelectorAll(".member-row")).toHaveLength(20)
    expect(screen.queryByRole("button", { name: strings.members.maisPessoas(15) })).toBeNull()
  })
})

/**
 * The "+X people on this server" list drew its rows stacked on top of each
 * other (1.3.16). The window is a flex column with a `max-height`, and the rows
 * had the default `flex-shrink: 1`: 400 rows of spacer and row did not fit, so
 * the browser shrank every row to about 1 px and the content of each one was
 * drawn over the next. jsdom has no layout, so the browser proof is
 * `scripts/medir-lista-pessoas-servidor.mjs`; here we hold the two things it
 * depends on: the heights add up, and the stylesheet forbids the shrink.
 */
describe("MemberPanel — lista em janela", () => {
  const folha = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "screens.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  )

  it("cada linha da janela tem a altura do código e não encolhe na coluna flex", () => {
    const regra = folha.match(/^\.member-janela > li \{([^}]*)\}/m)?.[1] ?? ""
    expect(regra).toMatch(new RegExp(`height:\\s*${ALTURA_DA_LINHA}px`))
    expect(regra).toMatch(/flex:\s*none|flex-shrink:\s*0/)
  })

  it("os espaços e as linhas desenhadas somam sempre a lista inteira, e cobrem o que se vê", () => {
    const total = 400
    const altura = 540
    for (let topo = 0; topo <= total * ALTURA_DA_LINHA; topo += 37) {
      const { inicio, fim, acima, abaixo } = janelaDaLista(total, topo, altura)
      expect(acima + (fim - inicio) * ALTURA_DA_LINHA + abaixo).toBe(total * ALTURA_DA_LINHA)
      expect(acima).toBeLessThanOrEqual(topo)
      expect(Math.min(topo + altura, total * ALTURA_DA_LINHA)).toBeLessThanOrEqual(total * ALTURA_DA_LINHA - abaixo)
    }
    expect(janelaDaLista(0, 0, altura)).toEqual({ inicio: 0, fim: 0, acima: 0, abaixo: 0 })
    // A scroll offset past the end (a list that just got shorter) draws nothing and adds up.
    const alem = janelaDaLista(10, 99_999, altura)
    expect(alem.acima + (alem.fim - alem.inicio) * ALTURA_DA_LINHA + alem.abaixo).toBe(10 * ALTURA_DA_LINHA)
  })

  it("no DOM, com 400 pessoas e depois de rolar, os espaços mais as linhas dão 400 linhas", async () => {
    const membros = Array.from({ length: 405 }, (_, i) => `@m${String(i).padStart(3, "0")}:s`)
    const presenceFor = (address: string): "active" | "idle" => (membros.indexOf(address) < 5 ? "active" : "idle")
    const user = userEvent.setup()
    render(panel({ members: membros, presenceFor }))
    await user.click(screen.getByRole("button", { name: strings.members.maisPessoas(400) }))
    const caixa = document.querySelector<HTMLUListElement>(".member-janela")!
    const soma = (): number =>
      [...caixa.children].reduce(
        (total, li) => total + (li.hasAttribute("aria-hidden") ? parseFloat((li as HTMLElement).style.height) : ALTURA_DA_LINHA),
        0,
      )
    expect(soma()).toBe(400 * ALTURA_DA_LINHA)
    caixa.scrollTop = 200 * ALTURA_DA_LINHA
    fireEvent.scroll(caixa)
    expect(caixa.firstElementChild?.hasAttribute("aria-hidden")).toBe(true)
    expect(soma()).toBe(400 * ALTURA_DA_LINHA)
  })
})

/**
 * P7 (1.3.26): accounts that still hold the keys but that the server says are gone.
 *
 * They leave the list and the count, so the count matches reality. They are not
 * hidden: one line says how many can still read, because this panel answers
 * "who can read this", and a server that lies about its roster must not be able
 * to take a reader out of that answer in silence.
 */
describe("MemberPanel — contas afastadas", () => {
  it("diz quantas contas ainda têm as chaves, fora da contagem", () => {
    render(panel({ members: ["@ana:localhost:8448", "@bruno:localhost:8448"], afastados: 3 }))
    expect(screen.getByText(strings.members.count(2))).toBeTruthy()
    expect(screen.getByText(strings.members.afastados(3))).toBeTruthy()
  })

  it("sem contas afastadas, não há linha", () => {
    render(panel({ members: ["@ana:localhost:8448"] }))
    expect(document.querySelector(".members-afastados")).toBeNull()
  })

  it("em inglês primeiro, no singular e no plural", () => {
    expect(en.members!.afastados!(1)).toBe("1 more account still has the keys of this channel. The server says it left.")
    expect(en.members!.afastados!(2)).toBe("2 more accounts still have the keys of this channel. The server says they left.")
  })
})
