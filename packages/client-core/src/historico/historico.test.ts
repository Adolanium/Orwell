import { abrirSinal } from "@enclave/crypto"
import { fromBase64, generateDeviceKey, generateIdentity, parseServerName, signWithDevice, toBase64, VIDEO_BYTES_POR_PARTE, type Identity } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AntiEntropia, type PortaDaAntiEntropia } from "../sincronia/pedido.js"
import { chaveDoEvento, dobrarConversa } from "../dobras.js"
import { ArmazemDeMedia } from "../armazem/armazem.js"
import { ArmazemEmMemoria } from "../armazem/emMemoria.js"
import { absorverPayload, absorverVideo, bytesDoMedia, inflarPayload, recolher, shasDoPayload, soInlineOuEvicted } from "../armazem/referencias.js"
import {
  bytesParaBase64,
  entradasDoCanal,
  fundirEntradasDoIrmao,
  guardarVideo,
  HISTORY_MAX_PER_CHANNEL,
  juntarMediaDoIrmao,
  newVaultContents,
  semBytes,
  type StoredChatMessage,
  type StoredPayload,
  type VaultContents,
} from "../vault.js"
import {
  conversaDe,
  faltaAqui,
  faltamDaConversa,
  inventarioDe,
  mediaDe,
  mediaInteiraDe,
  paginaDe,
  resumoDoHistorico,
  retratoDe,
  semMediaPesada,
  TECTOS_DO_HISTORICO,
  type InflarParaOIrmao,
} from "./conteudo.js"
import {
  HistoricoEntreAparelhos,
  TECTOS_DO_FIO_DO_HISTORICO,
  type EventoDoHistorico,
  type PortaDoArmazemDoHistorico,
  type PortaDoHistorico,
} from "./historico.js"

/**
 * The history between devices of the same account, without a server: the vault
 * rules, the pages, and the wire between two devices connected by an in-memory
 * relay that can lose signals. The proof with the server and real sessions is
 * in `session.historico-entre-aparelhos.rede.test.ts`.
 */

const CASA = parseServerName("localhost")

function mensagem(seq: number, sender: string, corpo: string, extra: Record<string, unknown> = {}): StoredChatMessage {
  return {
    seq,
    sender,
    at: 1_000 + seq,
    payload: { t: "message", id: `m${seq}`, sentAt: 1_000 + seq, body: corpo, attachments: [], mentions: [], ...extra },
  }
}

function imagem(nome: string, caracteres: number): Record<string, unknown> {
  return { name: nome, mediaType: "image/png", byteLength: caracteres, inline: `data:image/png;base64,${"B".repeat(caracteres)}` }
}

/** An open store, in memory. */
async function armazemAberto(): Promise<ArmazemDeMedia> {
  const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
  await armazem.abrir()
  return armazem
}

/** The output to the sibling, as the session provides it: through the store. */
function inflarDe(contents: VaultContents, armazem: ArmazemDeMedia): InflarParaOIrmao {
  return {
    payload: (payload, opcoes) => inflarPayload(contents, payload, armazem, opcoes ?? {}),
    bytes: (sha) => bytesDoMedia(contents, sha, armazem),
  }
}

/** A new device's door: absorbs on the way in and inflates on the way out. */
function portaNova(contents: VaultContents, armazem: ArmazemDeMedia): PortaDoArmazemDoHistorico {
  return {
    presente: (sha) => armazem.tem(sha),
    inflar: inflarDe(contents, armazem),
    absorver: (c, payload) => absorverPayload(c, payload, armazem),
    guardarVideo: (c, _sha, bytes) => {
      absorverVideo(c, bytes, "video/mp4", armazem)
    },
  }
}

/** A door of a device from before the store (1.3): the bytes stay in the vault, and go out as they are. */
const portaAntiga: PortaDoArmazemDoHistorico = {
  presente: () => false,
  inflar: { payload: async (payload) => payload, bytes: async () => null },
  absorver: (_c, payload) => payload,
  guardarVideo: (c, sha, bytes, at) => {
    guardarVideo(c, sha, bytesParaBase64(bytes), at)
  },
}

/** A page as it leaves the wire: JSON, and back. */
const peloFio = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T

/** All the attachments and cards a value carries, wherever they are. */
function anexosEm(valor: unknown): Record<string, unknown>[] {
  const achados: Record<string, unknown>[] = []
  const visitar = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visitar)
    if (typeof v !== "object" || v === null) return
    const r = v as Record<string, unknown>
    for (const chave of ["attachments", "media"]) if (Array.isArray(r[chave])) achados.push(...(r[chave] as Record<string, unknown>[]))
    Object.values(r).forEach(visitar)
  }
  visitar(valor)
  return achados
}

describe("fundirEntradasDoIrmao", () => {
  it("põe cada entrada no sítio pela ordem do servidor, sem duplicar por seq nem por chave", () => {
    const c = newVaultContents()
    c.history["!c"] = [mensagem(10, "@b:x", "dez"), mensagem(12, "@b:x", "doze")]
    const entraram = fundirEntradasDoIrmao(c, "!c", [mensagem(11, "@a:x", "onze"), mensagem(10, "@b:x", "dez"), mensagem(9, "@a:x", "nove")])
    expect(entraram).toBe(2)
    expect(c.history["!c"]!.map((e) => e.seq)).toEqual([9, 10, 11, 12])
    // The same page again changes nothing.
    expect(fundirEntradasDoIrmao(c, "!c", [mensagem(11, "@a:x", "onze"), mensagem(9, "@a:x", "nove")])).toBe(0)
    expect(c.history["!c"]).toHaveLength(4)
  })

  it("um envio da conta sem eco aqui ganha o seq que o irmão viu", () => {
    const c = newVaultContents()
    const semEco = { ...mensagem(-1, "@a:x", "minha"), apos: 4 }
    c.history["!c"] = [mensagem(4, "@b:x", "quatro"), semEco]
    fundirEntradasDoIrmao(c, "!c", [{ ...mensagem(5, "@a:x", "minha"), payload: { ...semEco.payload } }])
    expect(c.history["!c"]!.map((e) => e.seq)).toEqual([4, 5])
  })

  it("a lápide fica, e o original que o irmão manda continua escondido", () => {
    const c = newVaultContents()
    c.estadoDoCanal["!c"] = [{ seq: 8, sender: "@a:x", at: 8, payload: { t: "redact", id: "r1", target: "m5", redactedAt: 8 } }]
    fundirEntradasDoIrmao(c, "!c", [mensagem(5, "@a:x", "apagada"), mensagem(6, "@a:x", "fica")])
    const vistas = dobrarConversa(entradasDoCanal(c, "!c")).filter((e) => e.payload.t === "message")
    expect(vistas.map((e) => e.payload["body"])).toEqual(["fica"])
  })

  it("o tecto do cofre manda: nunca mais do que 400 mensagens de conversa", () => {
    const c = newVaultContents()
    c.history["!c"] = Array.from({ length: 300 }, (_, i) => mensagem(1_000 + i, "@b:x", `nova ${i}`))
    fundirEntradasDoIrmao(c, "!c", Array.from({ length: 300 }, (_, i) => mensagem(i, "@a:x", `velha ${i}`)))
    expect(c.history["!c"]).toHaveLength(HISTORY_MAX_PER_CHANNEL)
    // The oldest ones are removed.
    expect(c.history["!c"]![0]!.seq).toBe(200)
  })

  it("um acto herdado do emparelhamento dá lugar ao evento inteiro", () => {
    const c = newVaultContents()
    c.estadoDoCanal["!dm"] = [{ seq: 3, sender: "@b:x", at: 0, herdado: true, payload: { t: "friend.request" } }]
    fundirEntradasDoIrmao(c, "!dm", [{ seq: 3, sender: "@b:x", at: 3, payload: { t: "friend.request", note: "olá", sentAt: 3 } }])
    expect(c.estadoDoCanal["!dm"]).toEqual([{ seq: 3, sender: "@b:x", at: 3, payload: { t: "friend.request", note: "olá", sentAt: 3 } }])
  })
})

describe("faltamDaConversa (20/11/2026)", () => {
  const conversa = (seqs: number[]): VaultContents => {
    const c = newVaultContents()
    c.history["!c"] = seqs.map((seq) => mensagem(seq, "@b:x", `m${seq}`))
    return c
  }

  it("conta só a conversa do irmão que falta aqui: o registo de estado e as repetidas não", () => {
    const irmao = conversa([1, 2, 3, 4, 5, 6])
    irmao.estadoDoCanal["!c"] = [{ seq: 7, sender: "@b:x", at: 7, payload: { t: "post", id: "p", caption: "", media: [], links: [], tags: [] } }]
    const q = conversaDe(irmao, "!c")!
    expect(faltamDaConversa(conversa([2, 4]), "!c", q)).toBe(4)
    expect(faltamDaConversa(conversa([1, 2, 3, 4, 5, 6]), "!c", q)).toBe(0)
    // Through the wire, as JSON.
    expect(faltamDaConversa(newVaultContents(), "!c", JSON.parse(JSON.stringify(q)))).toBe(6)
  })

  it("o tecto do cofre: o que sairia logo a seguir não conta como em falta", () => {
    const q = conversaDe(conversa(Array.from({ length: 500 }, (_, i) => i + 1)), "!c")!
    expect(faltamDaConversa(newVaultContents(), "!c", q)).toBe(HISTORY_MAX_PER_CHANNEL)
    // 400 newer here: all of the sibling's are older, and the cap would drop them.
    expect(faltamDaConversa(conversa(Array.from({ length: 400 }, (_, i) => 1_000 + i)), "!c", q)).toBe(0)
  })

  it("um `q` que não se lê dá null, nunca um número", () => {
    expect(faltamDaConversa(newVaultContents(), "!c", { s: -1, b: "" })).toBeNull()
    expect(faltamDaConversa(newVaultContents(), "!c", { s: 0, b: 7 } as unknown as { s: number; b: string })).toBeNull()
  })
})

describe("os media pesados", () => {
  it("semMediaPesada tira só o que passa do limite, e juntarMediaDoIrmao devolve-o", () => {
    const entrada = mensagem(1, "@a:x", "duas", { attachments: [imagem("grande.png", 60_000), imagem("pequena.png", 100)] })
    const { payload, tirou } = semMediaPesada(entrada.payload, 48 * 1024)
    expect(tirou).toBe(true)
    const anexos = payload["attachments"] as Record<string, unknown>[]
    expect(anexos[0]).toEqual({ evicted: true, name: "grande.png", mediaType: "image/png" })
    expect(anexos[1]?.["inline"]).toBeTypeOf("string")
    // The original does not change.
    expect((entrada.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")

    const c = newVaultContents()
    c.history["!c"] = [{ ...entrada, payload }]
    expect(juntarMediaDoIrmao(c, "!c", "message|@a:x|m1", entrada.payload)).toBe(true)
    expect((c.history["!c"]![0]!.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBe(
      (entrada.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"],
    )
    // Again changes nothing.
    expect(juntarMediaDoIrmao(c, "!c", "message|@a:x|m1", entrada.payload)).toBe(false)
  })
})

describe("as páginas", () => {
  it("as páginas cobrem o canal inteiro, por ordem, mesmo com a lista fora de ordem", async () => {
    const tectos = { ...TECTOS_DO_HISTORICO }
    try {
      Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 3 })
      const c = newVaultContents()
      // A telemetry entry arrived at the end with an old sequence: the list is out of order.
      c.history["!c"] = [mensagem(1, "@a:x", "1"), mensagem(2, "@a:x", "2"), mensagem(5, "@a:x", "5"), mensagem(6, "@a:x", "6"), mensagem(3, "@a:x", "3")]
      c.estadoDoCanal["!c"] = [{ seq: 4, sender: "@a:x", at: 4, payload: { t: "post", id: "p4", caption: "", media: [], links: [], tags: [] } }]
      const vistas: number[] = []
      let desde: number | null = null
      for (let volta = 0; volta < 10; volta++) {
        const pagina = await paginaDe(c, "!c", desde, portaAntiga.inflar)
        vistas.push(...pagina.e.map((e) => e.seq))
        if (pagina.fim) break
        desde = pagina.ate
      }
      expect(vistas).toEqual([1, 2, 3, 4, 5, 6])
    } finally {
      Object.assign(TECTOS_DO_HISTORICO, tectos)
    }
  })

  it("o inventário deixa o canal da conta de fora, e o resumo não depende da ordem", () => {
    const c = newVaultContents()
    c.history["!conta"] = [mensagem(1, "@a:x", "x")]
    c.history["!c"] = [mensagem(1, "@a:x", "1"), mensagem(2, "@a:x", "2")]
    const outro = newVaultContents()
    outro.history["!c"] = [mensagem(2, "@a:x", "2"), mensagem(1, "@a:x", "1")]
    const inventario = inventarioDe(c, { canalDaConta: "!conta", temGrupo: () => true, lugar: () => undefined })
    expect(inventario.canais.map((canal) => canal.c)).toEqual(["!c"])
    expect(resumoDoHistorico(c, "!c")).toBe(resumoDoHistorico(outro, "!c"))
  })
})

// ------------------------------------------------- two devices, one relay

interface Aparelho {
  contents: VaultContents
  historico: HistoricoEntreAparelhos
  eventos: EventoDoHistorico[]
  ligado: boolean
  aparelho: string
  /** Called after each vault write, at once: lets a test act at an exact state. */
  depoisDeGravar?: () => void
  /** Called after each signal this device sends, once it is handed to the others. */
  depoisDeEnviar?: () => void
  /** The account's leaves as this device sees them. Default: both devices. */
  folhas?: () => string[]
}

const CANAL_DA_CONTA = "!conta:localhost"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(3) }

/**
 * Two devices of the same account, connected by an in-memory relay. `perder`
 * decides, per signal, whether the relay drops it (a bad connection). It also gets
 * the signal and the device that sends it, for a test that drops by kind of signal.
 */
function doisAparelhos(
  perder: (n: number, sinal: string, de: Aparelho) => boolean = () => false,
  armazens: { a?: ArmazemDeMedia; b?: ArmazemDeMedia } = {},
  /** A server whose signal cap is below the client's: above this many characters it refuses `sinal-too-large`, a moment later. */
  recusarAcima = Number.POSITIVE_INFINITY,
): { a: Aparelho; b: Aparelho; endereco: string } {
  const conta: Identity = generateIdentity(CASA)
  const chaveDoB = generateDeviceKey()
  const contaB = { ...conta, deviceSigningPrivateKey: chaveDoB.privateKey, deviceSigningPublicKey: chaveDoB.publicKey } as Identity
  const aparelhos: Aparelho[] = []
  let n = 0
  const criar = (identidade: Identity, armazem: ArmazemDeMedia | undefined): Aparelho => {
    const contents = newVaultContents()
    const eu: Aparelho = { contents, historico: null as unknown as HistoricoEntreAparelhos, eventos: [], ligado: true, aparelho: toBase64(identidade.deviceSigningPublicKey) }
    const porta: PortaDoHistorico = {
      eu: () => ({ address: conta.address, aparelho: identidade.deviceSigningPublicKey, assinar: (m) => signWithDevice(identidade, m) }),
      conteudo: () => contents,
      canalDaConta: () => CANAL_DA_CONTA,
      contaPronta: async () => true,
      folhasDaConta: () => eu.folhas?.() ?? aparelhos.map((x) => x.aparelho),
      derivarChave: async () => CHAVE,
      podeSinalizar: () => eu.ligado,
      enviarSinal: (sinal, ref) => {
        if (sinal.length > recusarAcima) {
          setTimeout(() => eu.historico.aoRecusa({ channel: CANAL_DA_CONTA, code: "sinal-too-large", ref }), 5)
          return
        }
        n += 1
        if (perder(n, sinal, eu)) return
        for (const outro of aparelhos) {
          if (outro !== eu && outro.ligado) void outro.historico.aoSinal({ channel: CANAL_DA_CONTA, from: conta.address, sinal })
        }
        eu.depoisDeEnviar?.()
      },
      gravar: (mudar) => {
        const r = mudar(contents)
        eu.depoisDeGravar?.()
        return r
      },
      temGrupo: (canal) => canal in contents.history || canal in contents.estadoDoCanal,
      bloqueado: () => false,
      lugar: () => undefined,
      emitir: (evento) => eu.eventos.push(evento),
      agora: () => Date.now(),
      // No store: a device from before it (1.3).
      armazem: armazem ? portaNova(contents, armazem) : portaAntiga,
    }
    eu.historico = new HistoricoEntreAparelhos(porta)
    aparelhos.push(eu)
    return eu
  }
  return { a: criar(conta, armazens.a), b: criar(contaB, armazens.b), endereco: conta.address }
}

/** The header of a signal of this module, read with the test key: kind, part and response. */
function cabecalhoDoSinal(sinal: string): { k: string; id?: string; i?: number; n?: number } | null {
  const aberto = abrirSinal(CHAVE, CANAL_DA_CONTA, fromBase64(sinal))
  // The wrapper: a magic byte, the header length (uint16), the header in JSON, the body.
  if (!aberto || aberto.length < 3 || aberto[0] !== 0x48) return null
  const comprimento = new DataView(aberto.buffer, aberto.byteOffset, aberto.byteLength).getUint16(1, false)
  return JSON.parse(new TextDecoder().decode(aberto.subarray(3, 3 + comprimento))) as { k: string; id?: string; i?: number; n?: number }
}

/** An image whose content does not compress: a response that really goes in many parts. */
function imagemIncompressivel(nome: string, bytes: number): Record<string, unknown> {
  const aleatorios = new Uint8Array(bytes)
  crypto.getRandomValues(aleatorios)
  const base64 = toBase64(aleatorios)
  return { name: nome, mediaType: "image/png", byteLength: base64.length, inline: `data:image/png;base64,${base64}` }
}

async function ate(predicado: () => boolean, rotulo: string, prazoMs = 10_000): Promise<void> {
  const inicio = Date.now()
  while (Date.now() - inicio < prazoMs) {
    if (predicado()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`esgotou-se o prazo à espera de: ${rotulo}`)
}

describe("o fio entre dois aparelhos", () => {
  const fio = { ...TECTOS_DO_FIO_DO_HISTORICO }
  const conteudo = { ...TECTOS_DO_HISTORICO }
  beforeEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, {
      sinaisPorMinuto: 100_000,
      passoMs: 20,
      esperaDaRespostaMs: 300,
      esperaEntreJanelasMs: 300,
      esperaDoInventarioMs: 300,
      primeiraReposicaoMs: 50,
      intervaloDaReposicaoMs: 50,
      bytesPorParte: 1_024,
    })
    Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 5, mediaComOTexto: 1_000 })
  })
  afterEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, fio)
    Object.assign(TECTOS_DO_HISTORICO, conteudo)
  })

  function encher(contents: VaultContents): void {
    contents.history["!dm"] = Array.from({ length: 23 }, (_, i) => mensagem(i + 1, i % 2 ? "@b:x" : "@a:x", `mensagem ${i + 1}`))
    contents.history["!dm"]!.push(mensagem(30, "@a:x", "com imagem", { attachments: [imagem("foto.png", 20_000)] }))
    contents.estadoDoCanal["!mural"] = [{ seq: 1, sender: "@a:x", at: 1, payload: { t: "post", id: "p1", caption: "Olá", media: [], links: [], tags: [] } }]
  }

  it("o aparelho novo traz tudo, com o progresso, e a imagem no fim", async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o histórico chega")
      expect(entradasDoCanal(b.contents, "!dm").map((e) => e.seq)).toEqual(entradasDoCanal(a.contents, "!dm").map((e) => e.seq))
      expect(entradasDoCanal(b.contents, "!mural")).toHaveLength(1)
      const foto = entradasDoCanal(b.contents, "!dm").find((e) => e.payload["body"] === "com imagem")
      expect((foto?.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")
      // Progress reached the total and finished.
      const comTotal = b.eventos.filter((e) => e.aTrazer && e.total > 0)
      expect(comTotal.at(-1)?.feitas).toBe(comTotal.at(-1)?.total)
      expect(comTotal.some((e) => e.media !== null)).toBe(true)
      expect(b.eventos.at(-1)?.aTrazer).toBe(false)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it('quem envia ao aparelho novo diz "Deixa este aparelho ligado", com o progresso, e o aviso fecha no fim', async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o histórico chega")
      await ate(() => a.eventos.length > 0 && a.eventos.at(-1)?.envio === undefined, "o aviso do computador fecha")
      const comEnvio = a.eventos.filter((e) => e.envio !== undefined).map((e) => e.envio!)
      // 24 conversation entries and 1 post: the inventory total, from the first event on.
      expect(comEnvio[0]?.mensagens).toEqual({ feitas: 0, total: 25 })
      expect(comEnvio[0]?.fotografias).toBeNull()
      // It moves up, never down, and reaches the total of messages before the photos are known.
      const feitas = comEnvio.map((e) => e.mensagens.feitas)
      expect(feitas).toEqual([...feitas].sort((x, y) => x - y))
      const comFotos = comEnvio.filter((e) => e.fotografias !== null)
      expect(comFotos[0]?.mensagens.feitas).toBe(25)
      expect(comFotos[0]?.fotografias?.total).toBeGreaterThanOrEqual(1)
      expect(comFotos.at(-1)?.fotografias?.feitas).toBeLessThanOrEqual(comFotos.at(-1)?.fotografias?.total ?? 0)
      // The new device itself never shows it: it is receiving, not sending.
      expect(b.eventos.some((e) => e.envio !== undefined)).toBe(false)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("entre aparelhos já emparelhados (sem `ini`) não há aviso de envio", async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.history["!dm"] = [mensagem(1, "@a:x", "mensagem 1")]
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => entradasDoCanal(b.contents, "!dm").length > 1, "a reposição traz o que faltava")
      expect(a.eventos.some((e) => e.envio !== undefined)).toBe(false)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("um relé que perde um sinal em cada sete: as partes que faltam pedem-se outra vez", async () => {
    const { a, b } = doisAparelhos((n) => n % 7 === 0)
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o histórico chega", 20_000)
      expect(entradasDoCanal(b.contents, "!dm")).toHaveLength(entradasDoCanal(a.contents, "!dm").length)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("late copies of parts already held do not reset the tries: a part that never comes is asked for again", async () => {
    // Review note 10 (21/11/2026). The first response in many parts: B gets its first two,
    // the rest is lost for good, and the relay keeps replaying those two to B.
    let alvo: string | undefined
    const guardados: string[] = []
    const { a, b, endereco } = doisAparelhos((_n, sinal, de) => {
      if (de !== a) return false
      const cab = cabecalhoDoSinal(sinal)
      if (cab?.k !== "hr" || typeof cab.n !== "number" || cab.n < 3) return false
      alvo ??= cab.id
      if (cab.id !== alvo) return false
      if (cab.i === 0 || cab.i === 1) {
        if (guardados.length < 2) guardados.push(sinal)
        return false
      }
      return true
    })
    encher(a.contents)
    a.contents.history["!dm"]!.push(mensagem(31, "@a:x", "com outra imagem", { attachments: [imagemIncompressivel("grande.png", 15_000)] }))
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    const replay = setInterval(() => {
      for (const sinal of guardados) void b.historico.aoSinal({ channel: CANAL_DA_CONTA, from: endereco, sinal })
    }, 50)
    try {
      await ate(() => guardados.length === 2, "B gets the first two parts of a long response")
      const pedidos = b.historico.estatisticas.pedidos
      await ate(() => b.historico.estatisticas.pedidos > pedidos, "B asks again", 5_000)
    } finally {
      clearInterval(replay)
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  }, 20_000)

  it("a ligação cai a meio: o plano fica no cofre, e a seguinte acaba-o", async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    /*
      The connection drops at the first write that leaves a channel half done, not
      when a 20 ms poll happens to see it. Polling missed the state when the copy ran
      fast (alone, it failed every time) and waited for it under load.
    */
    let plano: unknown
    b.depoisDeGravar = () => {
      if (plano !== undefined || !Object.values(b.contents.historico?.plano?.canais ?? {}).some((canal) => canal.cursor !== null && !canal.fim)) return
      plano = structuredClone(b.contents.historico?.plano)
      b.ligado = false
      queueMicrotask(() => b.historico.aoDesligar())
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => plano !== undefined, "a meio")
      b.depoisDeGravar = undefined
      expect(plano).toBeDefined()
      await new Promise((resolve) => setTimeout(resolve, 100))
      b.ligado = true
      b.historico.aoLigar()
      await ate(() => b.contents.historico?.plano === undefined, "o histórico acaba")
      const seqs = entradasDoCanal(b.contents, "!dm").map((e) => e.seq)
      expect(new Set(seqs).size).toBe(seqs.length)
      expect(seqs).toEqual(entradasDoCanal(a.contents, "!dm").map((e) => e.seq))
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
    // Above its own two deadlines of 10 s (`ate`): if it ever stalls, it fails naming
    // the step, not on vitest's 5 s default with no label.
  }, 30_000)

  it("layer C: the responder sends a response one window at a time, so a device that went away gets at most a window", async () => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, { partesPorJanela: 4 })
    const { a, b } = doisAparelhos()
    encher(a.contents)
    // An image that does not compress: random bytes, tens of parts of 1 KiB.
    const aleatoria = `data:image/png;base64,${Buffer.from(crypto.getRandomValues(new Uint8Array(30_000))).toString("base64")}`
    const comImagem = a.contents.history["!dm"]!.find((e) => e.payload["body"] === "com imagem")!
    ;(comImagem.payload["attachments"] as Record<string, unknown>[])[0]!["inline"] = aleatoria
    b.contents.historico = { inicial: { desde: Date.now() } }
    // B sends the media request and goes away for good, before the response leaves A.
    let enviadosAoSair = -1
    b.depoisDeEnviar = () => {
      if (enviadosAoSair >= 0 || b.contents.historico?.plano?.media === undefined) return
      b.ligado = false
      enviadosAoSair = a.historico.estatisticas.enviados
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => enviadosAoSair >= 0, "B asks for the image and goes away", 20_000)
      b.depoisDeEnviar = undefined
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      const depois = a.historico.estatisticas.enviados - enviadosAoSair
      expect(depois).toBeGreaterThan(0)
      // One window of the image, and A's own requests as a requester (its `hi` to B): never the 30 parts.
      expect(depois).toBeLessThanOrEqual(TECTOS_DO_FIO_DO_HISTORICO.partesPorJanela + 2)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  }, 60_000)

  it("layer C: with windows, the whole history still arrives", async () => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, { bytesPorParte: 256, partesPorJanela: 4 })
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "the history arrives", 20_000)
      const foto = entradasDoCanal(b.contents, "!dm").find((e) => e.payload["body"] === "com imagem")
      expect((foto?.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  }, 60_000)

  it("layer C: a connection that drops mid-response keeps the session, and the response resumes from the parts that came", async () => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, { bytesPorParte: 256, partesPorJanela: 4 })
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    let caiu = false
    b.depoisDeGravar = () => {
      if (caiu || b.contents.historico?.plano?.media === undefined) return
      caiu = true
      setTimeout(() => {
        b.ligado = false
        b.historico.aoDesligar()
      }, 300)
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => caiu && !b.ligado, "B drops mid-media", 20_000)
      b.depoisDeGravar = undefined
      const sessoes = b.historico.estatisticas.sessoes
      expect(sessoes).toBeTypeOf("number")
      await new Promise((resolve) => setTimeout(resolve, 200))
      b.ligado = true
      b.historico.aoLigar()
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "the history finishes", 20_000)
      // No new session: the same one went on, asking only for what was missing.
      expect(b.historico.estatisticas.sessoes).toBe(sessoes)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  }, 60_000)

  it("a new hi from the same device drops what the responder still had queued for the old session (an iPhone locked mid-media)", async () => {
    // A tight budget: the image response is still queued on A when B goes away.
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, { sinaisPorMinuto: 12, bytesPorParte: 256 })
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    let caiu = false
    b.depoisDeGravar = () => {
      if (caiu || b.contents.historico?.plano?.media === undefined) return
      caiu = true
      // A moment for the media request to reach A, whose answer then outgrows the budget.
      setTimeout(() => {
        b.ligado = false
        b.historico.aoDesligar()
      }, 500)
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => caiu, "the media phase starts", 20_000)
      b.depoisDeGravar = undefined
      await new Promise((resolve) => setTimeout(resolve, 700))
      // B is back (the page resumed): a new session, and room on the wire to finish quickly.
      Object.assign(TECTOS_DO_FIO_DO_HISTORICO, { sinaisPorMinuto: 100_000 })
      b.ligado = true
      b.historico.aoLigar()
      await ate(() => a.historico.estatisticas.descartados > 0, "A drops the old session's queue", 20_000)
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "the history finishes", 20_000)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  }, 60_000)

  it("entre irmãos já emparelhados, só os canais que mudaram, e nunca um que este aparelho não tem", async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    a.contents.history["!esquecido"] = [mensagem(1, "@a:x", "não volta")]
    b.contents.history["!dm"] = entradasDoCanal(a.contents, "!dm").slice(0, 10)
    b.contents.estadoDoCanal["!mural"] = structuredClone(a.contents.estadoDoCanal["!mural"]!)
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => (b.contents.history["!dm"]?.length ?? 0) === a.contents.history["!dm"]!.length, "o que faltava chega")
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(b.contents.history["!esquecido"]).toBeUndefined()
      expect(b.contents.historico?.trazidos?.["!dm"]).toBe(resumoDoHistorico(a.contents, "!dm"))
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })
})

describe("o aviso nunca fica parado (12/11/2026)", () => {
  /*
    The reported case: "Getting the history: 402 of 420 messages" stood still
    for a long time. Two paths led there, both reproduced here: an entry the
    sibling cannot serialize sat in the middle of a channel and the page that
    carried it never went out (the request was asked again, forever); and the
    sibling stopped answering with the plan half done, and nothing ever gave
    up. Rules: the total counts only what can be got, what cannot is given as
    lost with the reason, and the notice has a deadline.
  */
  const fio = { ...TECTOS_DO_FIO_DO_HISTORICO }
  const conteudo = { ...TECTOS_DO_HISTORICO }
  beforeEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, {
      sinaisPorMinuto: 100_000,
      passoMs: 20,
      esperaDaRespostaMs: 150,
      esperaDoInventarioMs: 150,
      primeiraReposicaoMs: 50,
      intervaloDaReposicaoMs: 50,
      bytesPorParte: 1_024,
      desistirAposMs: 1_200,
      retomarParadoMs: 400,
    })
    Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 5, mediaComOTexto: 1_000 })
  })
  afterEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, fio)
    Object.assign(TECTOS_DO_HISTORICO, conteudo)
  })

  it("uma entrada que o irmão não consegue mandar, a meio de um canal: o resto chega, o contador chega ao total e ela conta como perdida", async () => {
    const { a, b } = doisAparelhos()
    a.contents.history["!c"] = Array.from({ length: 21 }, (_, i) => mensagem(i + 1, "@b:x", `mensagem ${i + 1}`))
    // Two entries that do not serialize (a BigInt: JSON.stringify throws), in the second page.
    a.contents.history["!c"]![7]!.payload["estranho"] = 1n
    a.contents.history["!c"]![8]!.payload["estranho"] = 2n
    a.contents.history["!outro"] = [mensagem(1, "@b:x", "outro canal")]
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o histórico acaba", 10_000)
      expect(entradasDoCanal(b.contents, "!c")).toHaveLength(19)
      expect(entradasDoCanal(b.contents, "!outro")).toHaveLength(1)
      const comTotal = b.eventos.filter((e) => e.aTrazer && e.total > 0)
      // The total drops what cannot come, and the counter reaches it.
      expect(comTotal.at(-1)?.feitas).toBe(comTotal.at(-1)?.total)
      const fim = b.eventos.at(-1)
      expect(fim?.aTrazer).toBe(false)
      expect(fim?.perdidas).toBe(2)
      expect(fim?.razao).toBe("ilegiveis")
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("o irmão cala-se a meio: o aviso desiste com a razão, e volta a tentar devagar até acabar", async () => {
    const { a, b } = doisAparelhos()
    a.contents.history["!c"] = Array.from({ length: 30 }, (_, i) => mensagem(i + 1, "@b:x", `mensagem ${i + 1}`))
    b.contents.historico = { inicial: { desde: Date.now() } }
    // The computer goes away mid-transfer, at the first write with a page done: a 20 ms
    // poll let the pages already on the wire bring everything first (the same cut as
    // "o número é o que falta").
    let cortou = false
    b.depoisDeGravar = () => {
      if (cortou || (b.contents.historico?.plano?.canais["!c"]?.feitas ?? 0) === 0) return
      cortou = true
      a.ligado = false
      queueMicrotask(() => a.historico.aoDesligar())
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => cortou, "a meio")
      b.depoisDeGravar = undefined
      // The reason is judged again at each try (20/11/2026): "irmao-calado" until a try finds nobody, then "sem-irmao".
      await ate(() => ["irmao-calado", "sem-irmao"].includes(b.eventos.at(-1)?.razao ?? ""), "o aviso desiste", 5_000)
      const parado = b.eventos.at(-1)
      expect(parado?.aTrazer).toBe(false)
      expect(parado?.faltam).toBeGreaterThan(0)
      // The plan stays in the vault, quiet: when the sibling comes back, it finishes.
      expect(b.contents.historico?.plano).toBeDefined()
      a.ligado = true
      a.historico.aoLigar()
      await ate(() => b.contents.historico?.plano === undefined, "acaba quando o irmão volta", 10_000)
      expect(entradasDoCanal(b.contents, "!c")).toHaveLength(30)
      expect(b.eventos.at(-1)?.perdidas ?? 0).toBe(0)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("nenhum irmão responde: o aviso desiste com essa razão, sem ficar a contar", async () => {
    const { a, b } = doisAparelhos()
    a.ligado = false
    b.contents.historico = { inicial: { desde: Date.now() } }
    b.historico.aoLigar()
    try {
      await ate(() => b.eventos.at(-1)?.razao === "sem-irmao", "o aviso desiste", 5_000)
      expect(b.historico.estado().aTrazer).toBe(false)
    } finally {
      b.historico.aoDesligar()
    }
  })

  /*
    20/11/2026: "298 messages are missing" stood on a device for good. The
    stopped plan kept "irmao-calado" in the vault forever, the reason was
    never judged again, a device with no sibling left still promised a resume,
    and the number was the sibling's count of all its entries (the state log
    too) less the entries that came, repeated ones included.
  */
  const planoParado = (razao: "irmao-calado" | "sem-irmao") => ({
    inicial: { desde: Date.now() },
    plano: {
      comecou: Date.now(),
      canais: { "!c": { total: 30, feitas: 5, cursor: 5, resumo: "x" } },
      parado: { em: Date.now(), razao },
    },
  })

  it("parado sem nenhum outro aparelho na conta: o plano e o inicial saem, e o aviso também", async () => {
    const { b } = doisAparelhos()
    b.folhas = () => [b.aparelho]
    b.contents.historico = planoParado("irmao-calado")
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o plano sai")
      expect(b.historico.estado().razao).toBeUndefined()
      expect(b.eventos.at(-1)?.razao).toBeUndefined()
    } finally {
      b.historico.aoDesligar()
    }
  })

  it("parado como irmao-calado: a razão volta a julgar-se, e uma tentativa sem resposta passa a sem-irmao", async () => {
    const { a, b } = doisAparelhos()
    a.ligado = false
    b.contents.historico = planoParado("irmao-calado")
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano?.parado?.razao === "sem-irmao", "a razão muda", 5_000)
      expect(b.historico.estado().razao).toBe("sem-irmao")
    } finally {
      b.historico.aoDesligar()
    }
  })

  it("o número é o que falta NESTE aparelho: sem o registo de estado, sem as repetidas, e retoma sozinho", async () => {
    const { a, b } = doisAparelhos()
    a.contents.history["!c"] = Array.from({ length: 30 }, (_, i) => mensagem(i + 1, "@b:x", `mensagem ${i + 1}`))
    // Twenty state entries interleaved (posts, the state log): never "messages missing".
    a.contents.estadoDoCanal["!c"] = Array.from({ length: 20 }, (_, i) => ({
      seq: 100 + i,
      sender: "@b:x",
      at: 2_000 + i,
      payload: { t: "post", id: `p${i}`, caption: "Olá", media: [], links: [], tags: [] },
    }))
    // This device already has twelve of them: they come again in the pages, and are not missing.
    b.contents.history["!c"] = a.contents.history["!c"]!.slice(0, 12).map((e) => structuredClone(e))
    b.contents.historico = { inicial: { desde: Date.now() } }
    /*
      A goes away at the first write that has ten done, not when a 20 ms poll sees it:
      in memory the copy runs faster than the poll, and the pages already on the wire
      brought everything before A left (nothing missing, the test failed every time).
      The same cut as "a ligação cai a meio".
    */
    let cortou = false
    b.depoisDeGravar = () => {
      if (cortou || (b.contents.historico?.plano?.canais["!c"]?.feitas ?? 0) < 10) return
      cortou = true
      a.ligado = false
      queueMicrotask(() => a.historico.aoDesligar())
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => cortou, "a meio")
      b.depoisDeGravar = undefined
      await ate(() => b.eventos.at(-1)?.razao !== undefined, "o aviso desiste", 5_000)
      const aqui = new Set(entradasDoCanal(b.contents, "!c").map((e) => e.seq))
      const faltamDeVerdade = a.contents.history["!c"]!.filter((e) => !aqui.has(e.seq)).length
      expect(faltamDeVerdade).toBeGreaterThan(0)
      expect(b.eventos.at(-1)?.faltam).toBe(faltamDeVerdade)
      // The old count: the sibling's 50 entries less the ones that came, repeated ones included.
      expect(b.eventos.at(-1)?.perdidas).toBeUndefined()
      a.ligado = true
      a.historico.aoLigar()
      await ate(() => b.contents.historico?.plano === undefined, "retoma e acaba", 10_000)
      expect(b.contents.history["!c"]).toHaveLength(30)
      expect(b.eventos.at(-1)?.razao).toBeUndefined()
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("um irmão antigo, sem `q` no inventário: parado sem número, nunca um inventado", async () => {
    const { b } = doisAparelhos()
    b.contents.history["!c"] = [mensagem(1, "@b:x", "um")]
    b.contents.historico = planoParado("sem-irmao")
    expect(b.historico.estado().faltam).toBeUndefined()
    b.contents.historico.plano!.canais["!c"]!.conversa = { s: 1, b: "Hw" } // seqs 1 to 5
    expect(b.historico.estado().faltam).toBe(4)
  })
})

describe("quem responde nunca se cala (20/11/2026)", () => {
  /*
    A live sibling could go silent with no word: a response over `partesMax`
    parts, a signal over the cap, a part the server refused as too large. The
    requester asked the same thing again, forever. Now the responder splits
    again smaller, or says what could not go.
  */
  const fio = { ...TECTOS_DO_FIO_DO_HISTORICO }
  const conteudo = { ...TECTOS_DO_HISTORICO }
  beforeEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, {
      sinaisPorMinuto: 100_000,
      passoMs: 20,
      esperaDaRespostaMs: 300,
      esperaDoInventarioMs: 300,
      primeiraReposicaoMs: 50,
      intervaloDaReposicaoMs: 50,
      bytesPorParte: 1_024,
    })
    Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 5, mediaComOTexto: 1_000 })
  })
  afterEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, fio)
    Object.assign(TECTOS_DO_HISTORICO, conteudo)
  })

  function aleatorio(caracteres: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil((caracteres * 3) / 4)))
    return toBase64(bytes).slice(0, caracteres)
  }

  function comFotoGrande(contents: VaultContents): void {
    contents.history["!dm"] = Array.from({ length: 8 }, (_, i) => mensagem(i + 1, "@a:x", `mensagem ${i + 1}`))
    contents.history["!dm"]!.push(
      mensagem(9, "@a:x", "com imagem", {
        attachments: [{ name: "foto.png", mediaType: "image/png", byteLength: 20_000, inline: `data:image/png;base64,${aleatorio(20_000)}` }],
      }),
    )
  }

  it("uma fotografia que não cabe em `partesMax` partes: responde sem ela, e o plano acaba", async () => {
    TECTOS_DO_FIO_DO_HISTORICO.partesMax = 4
    const { a, b } = doisAparelhos()
    comFotoGrande(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o plano acaba", 8_000)
      expect(entradasDoCanal(b.contents, "!dm")).toHaveLength(9)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("um sinal acima do tecto do cliente: a resposta parte-se mais pequena, e chega tudo", async () => {
    TECTOS_DO_FIO_DO_HISTORICO.sinalMaxCaracteres = 1_500
    const { a, b } = doisAparelhos()
    comFotoGrande(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o plano acaba", 8_000)
      const foto = entradasDoCanal(b.contents, "!dm").find((e) => e.payload["body"] === "com imagem")
      expect((foto?.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("o servidor recusa uma parte por grande: quem responde parte-a de novo, e quem pede recomeça com o `n` maior", async () => {
    const { a, b } = doisAparelhos(undefined, {}, 1_500)
    comFotoGrande(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o plano acaba", 8_000)
      const foto = entradasDoCanal(b.contents, "!dm").find((e) => e.payload["body"] === "com imagem")
      expect((foto?.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")
      expect(a.historico.estatisticas.recusados).toBeGreaterThan(0)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })
})

describe("convivência com um irmão de antes disto (1.0.4)", () => {
  it("a anti-entropia de um irmão antigo deita fora os sinais do canal da conta sem contar nada", async () => {
    // The gate for 1.0.4: `elegivel` says no to the account channel (`session.ts`, `#portaDaAntiEntropia`).
    const antiga = new AntiEntropia({ elegivel: (canal: string) => canal !== CANAL_DA_CONTA } as unknown as PortaDaAntiEntropia)
    const sinais: string[] = []
    const { a, b } = doisAparelhos()
    // The signals that the new device sends also go to the old sibling.
    b.contents.historico = { inicial: { desde: Date.now() } }
    const original = a.historico.aoSinal.bind(a.historico)
    a.historico.aoSinal = (frame) => {
      sinais.push(frame.sinal)
      return original(frame)
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => sinais.length > 0, "o aparelho novo pede")
      for (const sinal of sinais) await antiga.aoSinal({ channel: CANAL_DA_CONTA, from: "@a:localhost", sinal })
      expect(antiga.estatisticas.sinaisRecebidos).toBe(0)
      expect(antiga.estatisticas.sinaisIlegiveis).toBe(0)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })
})

describe("o retrato no armazém conta (Ruling R15)", () => {
  it("um avatar por referência pesa o inline que reconstitui, se o blob está; sem ele, falta", () => {
    const contents = newVaultContents()
    contents.media = { sha1: { v: 1, k: "k", n: "n", b: 300, t: "image/png", f: "bytes", p: "data:image/png;base64,", c: "mini", at: 1 } }
    const payload = { t: "profile", displayName: "Bruno", donations: [], updatedAt: 5, avatar: { ref: "sha1", name: "avatar", mediaType: "image/*" } }
    contents.directory["@bruno:x"] = { at: 5, payload }
    expect(retratoDe(payload, contents)).toBe("data:image/png;base64,".length + 400)
    expect(retratoDe(payload, contents, () => false)).toBe(0)
    expect(mediaDe(contents, "@ana:x", () => true)).toContainEqual({ a: "@bruno:x", at: 5, b: "data:image/png;base64,".length + 400 })
    expect(faltaAqui(contents, { a: "@bruno:x", at: 5, b: 1 }, () => true)).toBe(false)
    expect(mediaDe(contents, "@ana:x", () => false)).toEqual([])
    expect(faltaAqui(contents, { a: "@bruno:x", at: 5, b: 1 }, () => false)).toBe(true)
  })

  it("a forma do perfil próprio (`avatarRef`) conta pela mesma regra", () => {
    const contents = newVaultContents()
    contents.media = { sha2: { v: 1, k: "k", n: "n", b: 30, t: "image/png", f: "texto", c: "mini", at: 1 } }
    const payload = { t: "profile", displayName: "Ana", donations: [], updatedAt: 5, avatarRef: "sha2" }
    expect(retratoDe(payload, contents)).toBe(30)
    expect(retratoDe(payload, contents, () => false)).toBe(0)
  })
})

// ------------------------------------------- the media store (Task 8)

describe("o fio entre irmãos leva inline ou evicted, nunca ref (Review Focus 3)", () => {
  const conteudo = { ...TECTOS_DO_HISTORICO }
  afterEach(() => {
    Object.assign(TECTOS_DO_HISTORICO, conteudo)
  })

  const PREFIXO = "data:image/png;base64,"
  /** The cut: the prefix and 1000 characters of canonical base64. */
  const LIMITE = PREFIXO.length + 1_000
  const com = (nome: string, n: number) => ({ name: nome, mediaType: "image/png", byteLength: n, kind: "image", inline: `${PREFIXO}${"B".repeat(n)}` })

  /** The usual payloads (what 1.3.2 had in the vault), with items on both sides of the cut. */
  function originais(): StoredPayload[] {
    return [
      {
        t: "message",
        id: "m1",
        sentAt: 1,
        body: "quatro anexos e dois cartões",
        attachments: [
          com("no-limite.png", 1_000), // canonical, exactly at the cut: goes
          com("acima.png", 1_004), // canónico, acima: evicted
          com("texto-abaixo.png", 999), // non-canonical (f: "texto"), below: goes
          com("texto-acima.png", 1_001), // non-canonical, one above: evicted
        ],
        links: [
          { url: "https://a.pt", kind: "link", thumbnail: `${PREFIXO}${"C".repeat(1_000)}` },
          { url: "https://b.pt", kind: "link", thumbnail: `${PREFIXO}${"C".repeat(1_004)}` },
        ],
        mentions: [],
      },
      {
        t: "post",
        id: "p1",
        caption: "um vídeo com uma miniatura grande",
        // The poster was never cut in 1.3.2.
        media: [{ name: "v.mp4", mediaType: "video/mp4", byteLength: 9, kind: "video", poster: `data:image/jpeg;base64,${"D".repeat(4_000)}` }],
        links: [],
        tags: [],
      },
    ]
  }

  /** A new vault with these payloads absorbed into the store. */
  async function cofreNovo(payloads: StoredPayload[]) {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    contents.history["!c"] = payloads.map((payload, i) => ({ seq: i + 1, sender: "@a:x", at: i + 1, payload: absorverPayload(contents, payload, armazem) }))
    await armazem.drenar()
    return { contents, armazem }
  }

  it("paginaDe: inflada e cortada como a 1.3.2 cortava o mesmo item (Ruling R11)", async () => {
    Object.assign(TECTOS_DO_HISTORICO, { mediaComOTexto: LIMITE })
    const { contents, armazem } = await cofreNovo(originais())
    // The vault has only references.
    expect(semBytes(contents)).toEqual([])
    const pagina = peloFio(await paginaDe(contents, "!c", null, inflarDe(contents, armazem)))
    expect(JSON.stringify(pagina)).not.toMatch(/"ref"/)
    // The 1.3.2 decision, with the same items in the old vault.
    expect(pagina.e.map((e) => e.payload)).toEqual(originais().map((p) => semMediaPesada(p, LIMITE).payload))
    const anexos = pagina.e[0]!.payload["attachments"] as Record<string, unknown>[]
    expect(anexos.map((a) => (a["evicted"] === true ? "evicted" : typeof a["inline"]))).toEqual(["string", "evicted", "string", "evicted"])
  })

  it("mediaInteiraDe: tudo o que está no armazém, inflado e sem corte; o que saiu não se oferece", async () => {
    Object.assign(TECTOS_DO_HISTORICO, { mediaComOTexto: LIMITE })
    const { contents, armazem } = await cofreNovo(originais())
    const retrato = `${PREFIXO}${"E".repeat(800)}`
    const perfil = { t: "profile", displayName: "Bruno", donations: [], updatedAt: 5, avatar: { name: "avatar", mediaType: "image/png", byteLength: 600, inline: retrato } }
    contents.directory["@bruno:x"] = { at: 5, payload: absorverPayload(contents, perfil, armazem) }
    const video = Uint8Array.from({ length: 3_000 }, (_, i) => i % 251)
    const v = absorverVideo(contents, video, "video/mp4", armazem)
    contents.history["!c"]!.push({ seq: 3, sender: "@a:x", at: 3, payload: { t: "post", id: "p2", caption: "", media: [{ name: "v.mp4", mediaType: "video/mp4", byteLength: 3_000, kind: "video", partes: { sha256: v, n: 1, bytes: VIDEO_BYTES_POR_PARTE } }], links: [], tags: [] } })
    await armazem.drenar()
    const inflar = inflarDe(contents, armazem)
    const presente = (sha: string) => armazem.tem(sha)

    // The list offers the entry, the video from the store and the portrait.
    const lista = mediaDe(contents, "@a:x", presente)
    const e = chaveDoEvento(contents.history["!c"]![0]!)!
    expect(lista).toContainEqual(expect.objectContaining({ c: "!c", e }))
    expect(lista).toContainEqual({ v, b: Math.ceil((3_000 * 4) / 3) })
    expect(lista).toContainEqual(expect.objectContaining({ a: "@bruno:x" }))

    const { itens } = peloFio(await mediaInteiraDe(contents, "@a:x", [{ c: "!c", e }, { v }, { a: "@bruno:x" }], inflar))
    expect(JSON.stringify(itens)).not.toMatch(/"ref"/)
    // No cut: the four attachments with the exact inline.
    const doIrmao = itens.find((item) => "c" in item) as { p: StoredPayload }
    expect(doIrmao.p).toEqual(originais()[0])
    // The video, in base64url, with the right digest.
    const doVideo = itens.find((item) => "v" in item) as { b64: string }
    expect(doVideo.b64).toBe(bytesParaBase64(video))
    // The portrait with the usual inline.
    const doPerfil = itens.find((item) => "a" in item) as { perfil: { payload: StoredPayload } }
    expect((doPerfil.perfil.payload["avatar"] as Record<string, unknown>)["inline"]).toBe(retrato)

    // What left the store is no longer offered or served.
    await armazem.apagar([...shasDoPayload(contents.history["!c"]![0]!.payload), ...shasDoPayload(contents.directory["@bruno:x"]!.payload), v])
    expect(mediaDe(contents, "@a:x", presente).filter((item) => !("c" in item && item.e !== e))).toEqual([])
    expect((await mediaInteiraDe(contents, "@a:x", [{ c: "!c", e }, { v }, { a: "@bruno:x" }], inflar)).itens).toEqual([])
  })

  it("faltaAqui pede só o que não está presente, mesmo com a referência no cofre", async () => {
    const { contents, armazem } = await cofreNovo(originais())
    const e = chaveDoEvento(contents.history["!c"]![0]!)!
    const presente = (sha: string) => armazem.tem(sha)
    const b = mediaDe(contents, "@a:x", presente).find((item) => "c" in item && item.e === e)!.b
    expect(faltaAqui(contents, { c: "!c", e, b }, presente)).toBe(false)
    const v = absorverVideo(contents, new Uint8Array([1, 2, 3]), "video/mp4", armazem)
    expect(faltaAqui(contents, { v, b: 4 }, presente)).toBe(false)
    // The blobs leave (the ceiling): the references stay in the vault, and it is missing.
    await armazem.apagar([...shasDoPayload(contents.history["!c"]![0]!.payload), v])
    expect(contents.media?.[v]).toBeDefined()
    expect(faltaAqui(contents, { c: "!c", e, b }, presente)).toBe(true)
    expect(faltaAqui(contents, { v, b: 4 }, presente)).toBe(true)
  })

  it("juntarMediaDoIrmao: uma referência presente conta como os bytes; uma cujo blob saiu recebe o inline", async () => {
    const { contents, armazem } = await cofreNovo(originais())
    const e = chaveDoEvento(contents.history["!c"]![0]!)!
    const presente = (sha: string) => armazem.tem(sha)
    expect(juntarMediaDoIrmao(contents, "!c", e, originais()[0]!, presente)).toBe(false)
    const [primeiro] = shasDoPayload(contents.history["!c"]![0]!.payload)
    await armazem.apagar([primeiro!])
    expect(juntarMediaDoIrmao(contents, "!c", e, originais()[0]!, presente)).toBe(true)
    expect((contents.history["!c"]![0]!.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBe(com("x", 1_000).inline)
  })
})

describe("irmãos com e sem armazém (Task 8)", () => {
  const fio = { ...TECTOS_DO_FIO_DO_HISTORICO }
  const conteudo = { ...TECTOS_DO_HISTORICO }
  beforeEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, {
      sinaisPorMinuto: 100_000,
      passoMs: 20,
      esperaDaRespostaMs: 300,
      esperaDoInventarioMs: 300,
      primeiraReposicaoMs: 50,
      intervaloDaReposicaoMs: 50,
      bytesPorParte: 1_024,
    })
    Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 5, mediaComOTexto: 1_000 })
  })
  afterEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, fio)
    Object.assign(TECTOS_DO_HISTORICO, conteudo)
  })

  const retrato = `data:image/png;base64,${"E".repeat(2_000)}`

  function encher(contents: VaultContents): void {
    contents.history["!dm"] = Array.from({ length: 7 }, (_, i) => mensagem(i + 1, "@b:x", `mensagem ${i + 1}`))
    contents.history["!dm"]!.push(mensagem(30, "@a:x", "pequena", { attachments: [imagem("pequena.png", 400)] }))
    contents.history["!dm"]!.push(mensagem(31, "@a:x", "grande", { attachments: [imagem("grande.png", 20_000)] }))
    contents.directory["@b:x"] = {
      at: 5,
      payload: { t: "profile", displayName: "Bruno", donations: [], updatedAt: 5, avatar: { name: "avatar", mediaType: "image/png", byteLength: 1_500, inline: retrato } },
    }
  }

  /** A new device's vault: the same, with the bytes in the store. */
  function absorverTudo(contents: VaultContents, armazem: ArmazemDeMedia): void {
    for (const entrada of contents.history["!dm"]!) entrada.payload = absorverPayload(contents, entrada.payload, armazem)
    for (const perfil of Object.values(contents.directory)) perfil.payload = absorverPayload(contents, perfil.payload, armazem)
  }

  const anexoDe = (contents: VaultContents, corpo: string) =>
    (entradasDoCanal(contents, "!dm").find((e) => e.payload["body"] === corpo)!.payload["attachments"] as Record<string, unknown>[])[0]!

  const acabou = (b: Aparelho) => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined

  it("antigo para novo: o novo absorve tudo no armazém, e o cofre fica sem bytes", async () => {
    const armazem = await armazemAberto()
    const { a, b } = doisAparelhos(undefined, { b: armazem })
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => acabou(b) && b.contents.directory["@b:x"] !== undefined, "o histórico chega")
      expect(semBytes(b.contents)).toEqual([])
      for (const corpo of ["pequena", "grande"]) {
        const sha = anexoDe(b.contents, corpo)["ref"] as string
        expect(armazem.tem(sha)).toBe(true)
        const [inflado] = (await inflarPayload(b.contents, { t: "x", attachments: [anexoDe(b.contents, corpo)] }, armazem))["attachments"] as Record<string, unknown>[]
        expect(inflado?.["inline"]).toBe(anexoDe(a.contents, corpo)["inline"])
      }
      expect(retratoDe(b.contents.directory["@b:x"]!.payload, b.contents, (sha) => armazem.tem(sha))).toBe(retrato.length)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("novo para antigo: o antigo recebe inline (e o grande no fim), e nunca um ref", async () => {
    const armazem = await armazemAberto()
    const { a, b } = doisAparelhos(undefined, { a: armazem })
    encher(a.contents)
    const original = structuredClone(a.contents)
    absorverTudo(a.contents, armazem)
    await armazem.drenar()
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => acabou(b) && b.contents.directory["@b:x"] !== undefined, "o histórico chega")
      expect(JSON.stringify(b.contents)).not.toMatch(/"ref"/)
      for (const corpo of ["pequena", "grande"]) expect(anexoDe(b.contents, corpo)["inline"]).toBe(anexoDe(original, corpo)["inline"])
      expect((b.contents.directory["@b:x"]!.payload["avatar"] as Record<string, unknown>)["inline"]).toBe(retrato)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("trazerUm: chega de um irmão; o irmão sem ele diz nao-tem; sem irmão ligado, sem-irmao", async () => {
    const armazemA = await armazemAberto()
    const armazemB = await armazemAberto()
    const { a, b } = doisAparelhos(undefined, { a: armazemA, b: armazemB })
    encher(a.contents)
    absorverTudo(a.contents, armazemA)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => acabou(b) && b.contents.directory["@b:x"] !== undefined, "o histórico chega")
      const entrada = entradasDoCanal(b.contents, "!dm").find((e) => e.payload["body"] === "grande")!
      const e = chaveDoEvento(entrada)!
      const sha = anexoDe(b.contents, "grande")["ref"] as string
      const doRetrato = (b.contents.directory["@b:x"]!.payload["avatar"] as Record<string, unknown>)["ref"] as string
      // The ceiling removed them on B.
      await armazemB.apagar([sha, doRetrato])

      expect(await b.historico.trazerUm({ c: "!dm", e })).toBe("chegou")
      expect(armazemB.tem(sha)).toBe(true)
      expect(await b.historico.trazerUm({ a: "@b:x" })).toBe("chegou")
      expect(armazemB.tem(doRetrato)).toBe(true)
      expect(b.contents.historico?.plano).toBeUndefined()

      // A no longer has it either.
      await armazemA.apagar([sha])
      await armazemB.apagar([sha])
      expect(await b.historico.trazerUm({ c: "!dm", e })).toBe("nao-tem")

      // A disconnects: nobody answers the `hi`, and the one-item plan leaves.
      a.ligado = false
      a.historico.aoDesligar()
      expect(await b.historico.trazerUm({ c: "!dm", e })).toBe("sem-irmao")
      expect(b.contents.historico?.plano).toBeUndefined()
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  }, 20_000)
})

describe("um ref vindo de um irmão nunca se aceita (Ruling R14)", () => {
  const PREFIXO = "data:image/png;base64,"
  const inline = (n: number, letra = "B") => `${PREFIXO}${letra.repeat(n)}`

  it("soInlineOuEvicted: ref sem inline dá evicted; ref ao lado do inline sai; um vídeo fica; miniaturas, posters, retratos e ícones por referência saem", () => {
    const payload: StoredPayload = {
      t: "post",
      id: "p1",
      caption: "",
      media: [
        { name: "a.png", mediaType: "image/png", byteLength: 4, kind: "image", ref: "x".repeat(43) },
        { name: "b.png", mediaType: "image/png", byteLength: 4, kind: "image", inline: inline(8), ref: "y".repeat(43) },
        { name: "v.mp4", mediaType: "video/mp4", byteLength: 9, kind: "video", partes: { sha256: "z".repeat(43), n: 1, bytes: 1 }, ref: "z".repeat(43), poster: { ref: "w".repeat(43) } },
        { evicted: true, name: "c.png", mediaType: "image/png" },
      ],
      links: [{ url: "https://a.pt", thumbnail: { ref: "t".repeat(43) } }, { url: "https://b.pt", thumbnail: inline(8) }],
      tags: [],
    }
    const limpo = soInlineOuEvicted(payload)
    expect(JSON.stringify(limpo)).not.toMatch(/"ref"/)
    expect(limpo["media"]).toEqual([
      { evicted: true, name: "a.png", mediaType: "image/png" },
      { name: "b.png", mediaType: "image/png", byteLength: 4, kind: "image", inline: inline(8) },
      { name: "v.mp4", mediaType: "video/mp4", byteLength: 9, kind: "video", partes: { sha256: "z".repeat(43), n: 1, bytes: 1 } },
      { evicted: true, name: "c.png", mediaType: "image/png" },
    ])
    expect(limpo["links"]).toEqual([{ url: "https://a.pt" }, { url: "https://b.pt", thumbnail: inline(8) }])
    const perfil = soInlineOuEvicted({ t: "profile", displayName: "B", donations: [], updatedAt: 1, avatar: { name: "avatar", mediaType: "image/*", ref: "x".repeat(43) }, avatarRef: "x".repeat(43) })
    expect(perfil).toEqual({ t: "profile", displayName: "B", donations: [], updatedAt: 1, avatar: { evicted: true, name: "avatar", mediaType: "image/*" } })
    // With none of this, the same object.
    const limpoJa = { t: "message", id: "m", body: "", attachments: [{ name: "b.png", mediaType: "image/png", inline: inline(8) }] }
    expect(soInlineOuEvicted(limpoJa)).toBe(limpoJa)
  })

  it("o inflador da sessão com o cofre trancado (não infla): a página leva evicted, nunca ref", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    contents.history["!c"] = [mensagem(1, "@a:x", "foto", { attachments: [imagem("f.png", 400)] })].map((e) => ({ ...e, payload: absorverPayload(contents, e.payload, armazem) }))
    // As the session composes it: `soInlineOuEvicted(await #inflarParaOFio(...))`, and when locked `#inflarParaOFio` returns the payload as it is.
    const trancado: InflarParaOIrmao = { payload: async (payload) => soInlineOuEvicted(payload), bytes: async () => null }
    const pagina = await paginaDe(contents, "!c", null, trancado)
    expect(JSON.stringify(pagina)).not.toMatch(/"ref"/)
    expect((pagina.e[0]!.payload["attachments"] as unknown[])[0]).toEqual({ evicted: true, name: "f.png", mediaType: "image/png" })
  })

  it("uma página com um ref de outro media deste cofre: não infla os bytes alheios, e o cofre fica sem bytes", async () => {
    const fio = { ...TECTOS_DO_FIO_DO_HISTORICO }
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, { sinaisPorMinuto: 100_000, passoMs: 20, esperaDaRespostaMs: 300, esperaDoInventarioMs: 300, bytesPorParte: 1_024 })
    const armazemB = await armazemAberto()
    // A is a tampered sibling: it sends the vault as it has it, with whatever references it wants.
    const { a, b } = doisAparelhos(undefined, { b: armazemB })
    // B already has a media item (Bruno's portrait): A points to it.
    const retrato = inline(800, "E")
    b.contents.directory["@b:x"] = { at: 5, payload: absorverPayload(b.contents, { t: "profile", displayName: "Bruno", donations: [], updatedAt: 5, avatar: { name: "avatar", mediaType: "image/png", byteLength: 600, inline: retrato } }, armazemB) }
    const alheio = shasDoPayload(b.contents.directory["@b:x"]!.payload)[0]!
    a.contents.history["!dm"] = [
      mensagem(1, "@a:x", "forjada", { attachments: [{ name: "f.png", mediaType: "image/png", byteLength: 4, kind: "image", ref: alheio }] }),
      mensagem(2, "@a:x", "dupla", { attachments: [{ name: "d.png", mediaType: "image/png", byteLength: 4, kind: "image", inline: inline(40), ref: alheio }] }),
      mensagem(3, "@a:x", "marcador", { attachments: [{ evicted: true, name: "m.png", mediaType: "image/png", ref: alheio, poster: { ref: alheio } }] }),
    ]
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o histórico chega")
      const anexo = (corpo: string) => (entradasDoCanal(b.contents, "!dm").find((e) => e.payload["body"] === corpo)!.payload["attachments"] as Record<string, unknown>[])[0]!
      expect(anexo("forjada")).toEqual({ evicted: true, name: "f.png", mediaType: "image/png" })
      expect(anexo("dupla")["ref"]).not.toBe(alheio)
      expect(armazemB.tem(anexo("dupla")["ref"] as string)).toBe(true)
      // A marker with a foreign `ref` stays just a marker.
      expect(anexo("marcador")).toEqual({ evicted: true, name: "m.png", mediaType: "image/png" })
      expect(semBytes(b.contents)).toEqual([])
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
      Object.assign(TECTOS_DO_FIO_DO_HISTORICO, fio)
    }
  })
})

describe("um marcador evicted com um ref alheio (Ruling R14, ronda 2)", () => {
  it("não se infla para os bytes do outro media, não conta nas referências, e não segura a recolha", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    // A stored media item that nothing else references: only the forged marker points to it.
    const outro = absorverPayload(contents, { t: "message", id: "m0", body: "", attachments: [imagem("o.png", 400)] }, armazem)
    const alheio = shasDoPayload(outro)[0]!
    await armazem.drenar()
    const forjado: StoredPayload = { t: "message", id: "m1", body: "", attachments: [{ evicted: true, name: "m.png", mediaType: "image/png", ref: alheio, poster: { ref: alheio } }] }
    expect(soInlineOuEvicted(forjado)["attachments"]).toEqual([{ evicted: true, name: "m.png", mediaType: "image/png" }])
    // Defence in depth, even without cleaning on the way in:
    expect(shasDoPayload(forjado)).toEqual([])
    const inflado = await inflarPayload(contents, forjado, armazem)
    expect(inflado["attachments"]).toEqual([{ evicted: true, name: "m.png", mediaType: "image/png" }])
    contents.history["!c"] = [{ seq: 1, sender: "@a:x", at: 1, payload: forjado }]
    expect(await recolher(contents, armazem)).toContain(alheio)
    expect(armazem.tem(alheio)).toBe(false)
  })
})

describe("layer C: small confirmed media units (21/11/2026)", () => {
  it("a media response carries at most 384 KiB, except its first item: a reload loses one small unit, not 2 MiB", async () => {
    const contents = newVaultContents()
    contents.history["!c"] = Array.from({ length: 6 }, (_, i) =>
      mensagem(i + 1, "@b:x", `foto ${i + 1}`, { attachments: [imagem(`f${i}.png`, 150_000)] }),
    )
    const pedidos = contents.history["!c"]!.map((e) => ({ c: "!c", e: chaveDoEvento(e)! }))
    const { itens, resto } = await mediaInteiraDe(contents, "@a:x", pedidos, portaAntiga.inflar)
    expect(itens.length).toBeGreaterThanOrEqual(1)
    expect(itens.length).toBeLessThanOrEqual(2)
    expect(resto).toBe(pedidos.length - itens.length)
  })
})
