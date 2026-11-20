import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { formatInviteLink, formatShortInviteLink } from "@enclave/client-core"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { ligacaoDaMensagem } from "./lib/ligacaoDaMensagem.js"
import { ligacaoCurtaDeAmigo } from "./lib/ligacaoDeAmigo.js"
import { strings } from "./strings.js"

/**
 * Invite, friend and message links clicked INSIDE the app (1.3.25).
 *
 * Before, a link in a message left by `target="_blank"`: a new tab on the web
 * (a second owner of the same vault) and the system browser on the desktop app
 * (the invite secret in that browser's history). Now a link to this app on the
 * account's server opens in this window, by the path the startup link already
 * takes, and nothing navigates: the address bar and the history never see the
 * fragment. What is locked here:
 *
 *  - the click is taken (`preventDefault`), so nothing opens elsewhere;
 *  - it enters the existing flow, which still asks before redeeming;
 *  - the address bar does not change;
 *  - any other link, including the same link on another server, is left alone.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

const ME = "@me:casa.pt"
const FEED = "!feed-me:casa.pt"
const CANAL = "!sala-nova:casa.pt"
const CODIGO = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
const CODIGO_NOVO = "0123456789abcdef"
const CURTA = formatShortInviteLink("casa.pt", "ab23cd45", CODIGO_NOVO)
const LONGA_DA_CURTA = formatInviteLink("casa.pt", CANAL, CODIGO_NOVO)

function bancada(): {
  bridge: EnclaveBridge
  redeem: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
  ligar: () => void
} {
  const redeem = vi.fn(async () => ({ ok: true }))
  const resolve = vi.fn(async () => LONGA_DA_CURTA)
  let aoLigar: ((payload: unknown) => void) | null = null
  const bridge = {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: async () => ({ ok: true }),
    },
    identity: {
      load: async () => ({ address: ME, accountId: "me" }),
      create: async () => ({ address: ME, accountId: "me" }),
    },
    session: {
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls", "presence"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      list: async () => [FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: async () => ({ ok: true }),
      declineChannelInvite: async () => ({ ok: true }),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [ME],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
    },
    invites: {
      create: async () => formatInviteLink("casa.pt", CANAL, CODIGO),
      redeem,
      resolve,
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: async () => ({ ok: true }),
      acceptFriend: async () => ({ ok: true }),
      declineFriend: async () => ({ ok: true }),
      unfriend: async () => ({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      deafChannels: async () => [],
      feedChannel: async () => FEED,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: () => () => {},
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: (payload: unknown) => void) => {
        aoLigar = handler
        return () => {}
      },
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
  return { bridge, redeem, resolve, ligar: () => act(() => aoLigar?.({ state: "online" })) }
}

async function dentroELigado(ligar: () => void): Promise<void> {
  await screen.findByRole("button", { name: strings.rail.social })
  ligar()
}

/**
 * Click a link the way a message draws one (`RichText`: `target="_blank"`),
 * and report whether the app took the click. A listener in the bubble phase
 * sees the event after the app's capture listener, and then stops jsdom from
 * trying to navigate, which it cannot do.
 */
function clicar(href: string, opcoes: MouseEventInit = {}): { tomado: boolean } {
  const ancora = document.createElement("a")
  ancora.href = href
  ancora.target = "_blank"
  ancora.rel = "noopener noreferrer"
  ancora.textContent = "a ligação"
  // Inside a span, like `RichText`: the click lands on the text, not the anchor.
  const dentro = document.createElement("span")
  ancora.appendChild(dentro)
  document.body.appendChild(ancora)
  let tomado = false
  const ver = (evento: Event): void => {
    tomado = evento.defaultPrevented
    evento.preventDefault()
  }
  document.addEventListener("click", ver)
  document.addEventListener("auxclick", ver)
  act(() => {
    dentro.dispatchEvent(new MouseEvent(opcoes.button === 1 ? "auxclick" : "click", { bubbles: true, cancelable: true, ...opcoes }))
  })
  document.removeEventListener("click", ver)
  document.removeEventListener("auxclick", ver)
  ancora.remove()
  return { tomado }
}

describe("uma ligação de convite clicada dentro da app abre aqui", () => {
  it("o convite longo: pergunta, não redime sozinho, e a barra de endereço não muda", async () => {
    const { bridge, redeem, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)
    const antes = location.href
    const historia = history.length

    expect(clicar(formatInviteLink("casa.pt", CANAL, CODIGO)).tomado).toBe(true)

    expect(await screen.findByText(strings.invite.arrivedTitle)).toBeTruthy()
    expect(screen.getByText(strings.invite.arrivedBody("sala-nova", "casa.pt"))).toBeTruthy()
    expect(redeem).not.toHaveBeenCalled()
    // Nothing navigated: the secret is in no address bar and no history entry.
    expect(location.href).toBe(antes)
    expect(history.length).toBe(historia)
  })

  it("o convite curto resolve-se, pergunta, e Entrar redime a longa", async () => {
    const user = userEvent.setup()
    const { bridge, redeem, resolve, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)

    expect(clicar(CURTA).tomado).toBe(true)

    expect(await screen.findByText(strings.invite.arrivedTitle)).toBeTruthy()
    expect(resolve).toHaveBeenCalledExactlyOnceWith(CURTA)
    await user.click(screen.getByRole("button", { name: strings.invite.arrivedAccept }))
    expect(redeem).toHaveBeenCalledExactlyOnceWith(LONGA_DA_CURTA)
  })

  it("a mesma curta clicada outra vez, depois de recusada, pergunta outra vez", async () => {
    const user = userEvent.setup()
    const { bridge, resolve, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)

    clicar(CURTA)
    await screen.findByText(strings.invite.arrivedTitle)
    await user.click(screen.getByRole("button", { name: strings.invite.arrivedDecline }))
    await waitFor(() => expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull())

    clicar(CURTA)
    expect(await screen.findByText(strings.invite.arrivedTitle)).toBeTruthy()
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it("Ctrl+clique e o botão do meio também ficam cá: os dois abriam outro separador", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)

    expect(clicar(CURTA, { ctrlKey: true }).tomado).toBe(true)
    expect(clicar(CURTA, { metaKey: true }).tomado).toBe(true)
    expect(clicar(CURTA, { button: 1 }).tomado).toBe(true)
  })

  it("uma ligação do nosso servidor que não se lê dá a frase do arranque, e não sai", async () => {
    const { bridge, resolve, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)

    expect(clicar("https://casa.pt/c#estragado").tomado).toBe(true)

    expect(await screen.findByText(strings.invite.gateInvalid)).toBeTruthy()
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe("uma ligação de amigo clicada dentro da app abre a página da pessoa", () => {
  it("do mesmo servidor", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)

    expect(clicar(ligacaoCurtaDeAmigo("casa.pt", "@rui:casa.pt")).tomado).toBe(true)

    await vi.waitFor(() => {
      if (!document.querySelector("main.pagina-da-pessoa")) throw new Error("a página da pessoa ainda não abriu")
    })
  })

  it("de uma conta noutro servidor, partilhada do nosso: o aviso de sempre", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)

    expect(clicar(ligacaoCurtaDeAmigo("casa.pt", "@rui:outro.pt")).tomado).toBe(true)
    expect(await screen.findByText(strings.people.friendLinkOtherServer)).toBeTruthy()
  })
})

describe("uma ligação para uma mensagem fica cá", () => {
  it("é tomada, e a barra de endereço não muda", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)
    const antes = location.href

    // To a channel this account is not in: it does nothing and says nothing, as before (`useLigacaoDeMensagem`).
    expect(clicar(ligacaoDaMensagem("casa.pt", ME, { channel: CANAL, room: "", id: "m1" })).tomado).toBe(true)
    expect(location.href).toBe(antes)
  })
})

describe("uma ligação de emparelhamento numa conversa nunca abre", () => {
  it("é tomada, diz porquê, e não navega, de qualquer servidor", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)
    const antes = location.href

    expect(clicar("https://outro.pt/app/emparelhar#segredo").tomado).toBe(true)
    expect(await screen.findByText(strings.pairing.fromChat)).toBeTruthy()
    expect(clicar("https://casa.pt/app/emparelhar#segredo", { button: 1 }).tomado).toBe(true)
    expect(location.href).toBe(antes)
  })

  it("o aviso existe nas duas línguas, com o texto pedido", async () => {
    const { en } = await import("./linguas/en.js")
    const { pt } = await import("./linguas/pt.js")
    expect(en.pairing?.fromChat).toBe("This link adds one of your devices. Open it only on the new device, never from a chat.")
    expect(pt.pairing.fromChat).toBe(
      "Este link serve para juntar um aparelho teu. Abre-o só no aparelho novo, nunca a partir de uma conversa.",
    )
  })
})

describe("o resto fica como estava", () => {
  it("uma ligação externa, e as nossas ligações noutro servidor, não são tomadas", async () => {
    const { bridge, resolve, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentroELigado(ligar)

    expect(clicar("https://exemplo.pt/artigo").tomado).toBe(false)
    expect(clicar(formatShortInviteLink("outro.pt", "ab23cd45", CODIGO_NOVO)).tomado).toBe(false)
    expect(clicar(ligacaoCurtaDeAmigo("outro.pt", "@ana:outro.pt")).tomado).toBe(false)
    expect(clicar("https://casa.pt/privacidade").tomado).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("antes de a conta abrir, nada é tomado", async () => {
    const { bridge } = bancada()
    const fechada = { ...bridge, vault: { ...bridge.vault, unlock: async () => { throw new Error("wrong passphrase, or the vault is damaged") } } }
    render(<App bridge={fechada as EnclaveBridge} />)
    await screen.findByText(strings.gate.unlockTitle)

    expect(clicar(CURTA).tomado).toBe(false)
  })
})
