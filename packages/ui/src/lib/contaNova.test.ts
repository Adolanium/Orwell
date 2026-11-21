import { describe, expect, it } from "vitest"
import { definirLingua, strings, translateError } from "../strings.js"
import { chaveDoServidor, codigoDoErro } from "./codigosDeErro.js"
import { fraseDoStatus, routeStatus } from "./statusPolicy.js"

/**
 * The abuse brake, part 2 (1.3.26), in the interface: the error codes, the
 * sentences in both languages, and the notices that must reach the person
 * even in the first seconds after connecting.
 */
describe("os erros do travão de abuso", () => {
  it("têm códigos próprios, nunca reutilizados", () => {
    expect(codigoDoErro("the account check did not pass")).toBe(233)
    expect(codigoDoErro("this network created many accounts today")).toBe(234)
    expect(codigoDoErro("this new account opened all the new channels it can today")).toBe(367)
    expect(codigoDoErro("this new account cannot send images, files or gifs in the common room yet")).toBe(524)
    expect(codigoDoErro("this new account added all the people it can today")).toBe(615)
    expect(codigoDoErro("this new account must send a friend request first")).toBe(616)
  })

  it("os códigos do servidor levam às mesmas frases", () => {
    expect(chaveDoServidor("registration-proof-required")).toBe("the account check did not pass")
    expect(chaveDoServidor("registration-proof-invalid")).toBe("the account check did not pass")
    expect(chaveDoServidor("registration-network-limit")).toBe("this network created many accounts today")
  })

  it("em inglês e em português", () => {
    definirLingua("en")
    expect(translateError("this network created many accounts today")).toContain(
      "This network created many accounts today. Type an invite code, or paste an invite link.",
    )
    expect(translateError("this network created many accounts today")).toContain("Error 234")
    definirLingua("pt")
    expect(translateError("this network created many accounts today")).toContain("Esta rede criou muitas contas hoje.")
    expect(translateError("this new account must send a friend request first")).toContain("A tua conta é nova.")
  })
})

describe("the channel cap and the room cap (1.3.26)", () => {
  const CHANNELS = "this account created all the channels it can"
  const ROOMS = "this account created all the rooms it can"

  it("have their own codes, 368 and 369", () => {
    expect(codigoDoErro(CHANNELS)).toBe(368)
    expect(codigoDoErro(ROOMS)).toBe(369)
  })

  it("speak of channels, in English and in Portuguese", () => {
    definirLingua("en")
    expect(translateError(CHANNELS, { maximo: 5, contaNova: false })).toContain("Error 368\nYou created 5 channels. One account can create no more.")
    expect(translateError(CHANNELS, { maximo: 1, contaNova: true })).toContain("Your account is new. You can create 1 channel in the first 3 days.")
    expect(translateError(CHANNELS, { channel: "!x", convite: true })).toContain("You cannot make a link for this channel.")
    expect(translateError(CHANNELS)).toContain("You created the maximum number of channels for one account.")
    definirLingua("pt")
    expect(translateError(CHANNELS, { maximo: 5, contaNova: false })).toContain("Criaste 5 canais. Uma conta não pode criar mais.")
    expect(translateError(CHANNELS, { maximo: 1, contaNova: true })).toContain("A tua conta é nova. Nos primeiros 3 dias podes criar 1 canal.")
    expect(translateError(CHANNELS, { convite: true })).toContain("Não podes criar um link para este canal.")
  })

  it("the room cap says the number and how to free a place", () => {
    definirLingua("en")
    expect(translateError(ROOMS, { max: 30 })).toContain("Error 369\nYou created 30 rooms. One account can create no more. Delete a room to create a new one.")
    definirLingua("pt")
    expect(translateError(ROOMS, { max: 30 })).toContain("Criaste 30 salas. Uma conta não pode criar mais. Apaga uma sala para criar outra.")
    expect(translateError(ROOMS)).toContain("Criaste o número máximo de salas de uma conta.")
    expect(translateError(ROOMS, { max: 12, newAccount: true })).toContain("Error 369\nA tua conta é nova. Nos primeiros 3 dias podes criar 12 salas.".replace("Error", "Erro"))
    definirLingua("en")
    expect(translateError(ROOMS, { max: 12, newAccount: true })).toContain("Your account is new. You can create 12 rooms in the first 3 days.")
    definirLingua("pt")
  })

  it("the sentences of the tip of a + at a cap", () => {
    definirLingua("pt")
    expect(strings.sidebar.channelLimit({ maximo: 5, contaNova: false })).toBe(
      "Criaste 5 canais. Uma conta não pode criar mais. Podes entrar noutros canais com um link.",
    )
    definirLingua("en")
    expect(strings.sidebar.channelLimit({ maximo: 1, contaNova: true })).toBe(
      "Your account is new. You can create 1 channel in the first 3 days. You can still join channels with a link.",
    )
    definirLingua("pt")
  })
})

describe("os avisos da conta nova e da fila", () => {
  const contexto = { now: 10_000, connectedAt: 9_000, lastToastAt: new Map<string, number>() }

  it("chegam à pessoa mesmo nos primeiros segundos depois de ligar", () => {
    for (const code of ["new-account", "new-account-slow", "common-room-queued"]) {
      const decisao = routeStatus({ detail: "30", level: "info", code, route: "toast" }, contexto)
      expect(decisao.target, code).toBe("toast")
    }
  })

  it("dizem o que acontece, com o número do servidor", () => {
    definirLingua("en")
    expect(fraseDoStatus({ detail: "", level: "info", code: "new-account" }, (c) => c)).toBe("Your account is new. Some features open in 24 h.")
    expect(fraseDoStatus({ detail: "30", level: "info", code: "new-account-slow" }, (c) => c)).toBe(strings.contaNova.ritmo(30))
    expect(fraseDoStatus({ detail: "2", level: "info", code: "common-room-queued" }, (c) => c)).toBe(strings.contaNova.naFila)
    expect(strings.contaNova.naFila).toMatch(/^Joining the common room…/)
    definirLingua("pt")
    expect(fraseDoStatus({ detail: "", level: "info", code: "new-account" }, (c) => c)).toBe(
      "A tua conta é nova. Algumas funções abrem daqui a 24 h.",
    )
    expect(strings.contaNova.naFila).toMatch(/^A entrar na sala comum…/)
    expect(fraseDoStatus({ detail: ERRO, level: "error", code: "new-account-refused" }, (c) => c)).toBe(translateError(ERRO))
  })
})

const ERRO = "this new account cannot send images, files or gifs in the common room yet"
