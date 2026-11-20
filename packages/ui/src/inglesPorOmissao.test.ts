import { afterEach, describe, expect, it } from "vitest"
import { findEmoji, searchEmoji } from "./components/emoji.js"
import { corpoParaMostrar } from "./lib/corpoParaMostrar.js"
import { formatDiagnostics } from "./lib/diagnostics.js"
import { formatRelative, formatStamp, formatTime } from "./lib/format.js"
import { nomeDaSalaNoEcra } from "./lib/nomesDeOrigem.js"
import { fraseDoStatus } from "./lib/statusPolicy.js"
import { nomeDaSala } from "./hooks/useRooms.js"
import { definirLingua } from "./strings.js"

/**
 * The text that was fixed in Portuguese, now in the language of who reads
 * (20/11/2026). Each case runs in English, the default, and in Portuguese.
 */
afterEach(() => {
  definirLingua("pt")
})

const AGORA = new Date(2026, 10, 20, 15, 30).getTime()

describe("datas e horas na língua da interface", () => {
  it("em inglês: há quanto tempo, e hoje", () => {
    definirLingua("en")
    expect(formatRelative(AGORA - 10_000, AGORA)).toBe("just now")
    expect(formatRelative(AGORA - 5 * 60_000, AGORA)).toBe("5 min ago")
    expect(formatRelative(AGORA - 2 * 3_600_000, AGORA)).toBe("2 h ago")
    expect(formatRelative(AGORA - 26 * 3_600_000, AGORA)).toBe("yesterday")
    expect(formatStamp(Date.now())).toMatch(/^today, /)
    expect(formatTime(AGORA)).toBe(new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(AGORA))
  })

  it("em português, como antes", () => {
    expect(formatRelative(AGORA - 10_000, AGORA)).toBe("agora mesmo")
    expect(formatRelative(AGORA - 5 * 60_000, AGORA)).toBe("há 5 min")
    expect(formatRelative(AGORA - 26 * 3_600_000, AGORA)).toBe("ontem")
    expect(formatStamp(Date.now())).toMatch(/^hoje, /)
  })
})

describe("o cabeçalho do registo de diagnóstico", () => {
  it("em inglês", () => {
    definirLingua("en")
    const texto = formatDiagnostics([], { note: "nota", channels: 2 })
    expect(texto).toContain("Orwell: diagnostic log")
    expect(texto).toContain("channels: 2")
    expect(texto).toContain("events: 0")
  })
})

describe("os avisos do núcleo sem código passam a ter código", () => {
  it("salas recomeçadas e servidor reiniciado, nas duas línguas", () => {
    const rotulo = (canal: string): string => canal
    definirLingua("en")
    expect(fraseDoStatus({ detail: "x", level: "info", code: "channels-reset" }, rotulo)).toMatch(/^Rooms and feeds started again\./)
    expect(fraseDoStatus({ detail: "x", level: "info", code: "server-restarted" }, rotulo)).toMatch(/^The server restarted/)
    definirLingua("pt")
    expect(fraseDoStatus({ detail: "x", level: "info", code: "channels-reset" }, rotulo)).toMatch(/^Salas e feeds recomeçados\./)
  })
})

describe("os actos guardados mostram-se na língua de quem lê", () => {
  it("a resposta a um convite escrita pelo núcleo novo", () => {
    const payload = { body: 'I accepted the invitation to "Lagar".', inviteReply: { accepted: true } }
    expect(corpoParaMostrar(payload)).toBe('Aceitei o convite para "Lagar".')
    definirLingua("en")
    expect(corpoParaMostrar(payload)).toBe('I accepted the invitation to "Lagar".')
    expect(corpoParaMostrar({ body: "I will not join #x for now.", inviteReply: { accepted: false } })).toBe("I will not join #x for now.")
    definirLingua("pt")
    expect(corpoParaMostrar({ body: "I will not join #x for now.", inviteReply: { accepted: false } })).toBe("Por agora não vou entrar em #x.")
  })

  it("o acto de um ticket, com e sem assunto", () => {
    expect(corpoParaMostrar({ body: 'Closed the ticket "porta".', ticket: { id: "t", state: "closed" } })).toBe('Fechou o ticket "porta".')
    expect(corpoParaMostrar({ body: "Moved this ticket to in progress.", ticket: { id: "t", state: "working" } })).toBe("Pôs este ticket em curso.")
    definirLingua("en")
    expect(corpoParaMostrar({ body: 'Reopened the ticket "porta".', ticket: { id: "t", state: "open" } })).toBe('Reopened the ticket "porta".')
  })

  it("uma mensagem antiga, já gravada em português, mostra-se como veio", () => {
    definirLingua("en")
    expect(corpoParaMostrar({ body: "Aceitei o convite para #Lagar do Zé.", inviteReply: { accepted: true } })).toBe("Aceitei o convite para #Lagar do Zé.")
    expect(corpoParaMostrar({ body: 'Fechou o ticket "porta".', ticket: { id: "t", state: "closed" } })).toBe('Fechou o ticket "porta".')
    // And a body that only looks like the act, without the act, is text.
    expect(corpoParaMostrar({ body: "Closed this ticket." })).toBe("Closed this ticket.")
  })
})

describe("os nomes com que as salas nascem", () => {
  it("mostram-se na língua de quem lê, venham em português ou em inglês", () => {
    definirLingua("en")
    expect(nomeDaSalaNoEcra("", "geral")).toBe("general")
    expect(nomeDaSalaNoEcra("a1", "anúncios")).toBe("announcements")
    expect(nomeDaSalaNoEcra("a2", "avarias")).toBe("bugs")
    expect(nomeDaSala([], "")).toBe("general")
    definirLingua("pt")
    expect(nomeDaSalaNoEcra("a1", "announcements")).toBe("anúncios")
    expect(nomeDaSalaNoEcra("a3", "voice")).toBe("voz")
    expect(nomeDaSalaNoEcra("", "general")).toBe("geral")
  })

  it("um nome que alguém escreveu fica como está", () => {
    definirLingua("en")
    expect(nomeDaSalaNoEcra("a1", "Anúncios da Direcção")).toBe("Anúncios da Direcção")
    expect(nomeDaSalaNoEcra("a1", "geral")).toBe("geral")
  })
})

describe("os nomes dos emojis", () => {
  it("dizem-se na língua da interface, e a procura encontra nas duas", () => {
    definirLingua("en")
    expect(findEmoji("🙂")?.name).toBe("slightly smiling face")
    expect(findEmoji("🍺")?.name).toBe("beer mug")
    expect(searchEmoji("cerveja").map((emoji) => emoji.char)).toContain("🍺")
    definirLingua("pt")
    expect(findEmoji("🙂")?.name).toBe("sorriso leve")
    expect(searchEmoji("beer").map((emoji) => emoji.char)).toContain("🍺")
  })
})
