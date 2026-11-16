import { Payload, type Payload as PayloadT } from "@enclave/protocol"
import { randomBytes } from "node:crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
// The server harness's server, for real, on an ephemeral port, with its accounts.
// The sessions are this package's, from `dist`: the core is what is measured.
import {
  ate,
  canalComTodos,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// From `dist`, like the harness sessions.
import { cofreV2 } from "../testes/cofre-v2.js"
import {
  ArmazemEmMemoria,
  entradasDoCanal,
  resumoDoAnexo,
  semBytes,
  Session,
  shasDoPayload,
  Vault,
  type StoredChatMessage,
  type VaultContents,
} from "@enclave/client-core"

/**
 * The session and the media store, with a real server and sessions (media-store design): media enter the store through
 * the input doors, and go out to the network inflated, without changing the
 * wire.
 */

/**
 * A tampered client (Ruling R14): the output to the network does not inflate,
 * and a `ref` the payload carries goes on the wire as is. Only for the account
 * in `quem`.
 */
const forjar: { quem: string | null } = { quem: null }
vi.mock("../dist/armazem/referencias.js", async (original) => {
  const real = await original<typeof import("./armazem/referencias.js")>()
  return {
    ...real,
    inflarPayload: async (...args: Parameters<typeof real.inflarPayload>) => {
      const [, payload] = args
      if (forjar.quem !== null && (payload as { forjado?: unknown }).forjado === forjar.quem) return payload
      return real.inflarPayload(...args)
    },
  }
})

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const recolhaAntes = Session.RECOLHA_ADIADA_MS
const trazerAntes = Session.TRAZER_RETRATO_MS

beforeAll(async () => {
  servidor = await levantarServidor()
  Session.TRAZER_RETRATO_MS = 1_500
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  forjar.quem = null
  Session.RECOLHA_ADIADA_MS = recolhaAntes
})

afterAll(async () => {
  Session.TRAZER_RETRATO_MS = trazerAntes
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

/** A PNG with a real header (the dimensions) and `tamanho` bytes in all. */
function png(largura: number, altura: number, tamanho: number): Uint8Array {
  const cabecalho = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0]
  const bytes = Uint8Array.from(randomBytes(tamanho))
  bytes.set(cabecalho, 0)
  return bytes
}

/** The data URL as `FileReader` writes it. */
const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`

function mensagem(corpo: string, inline?: string, extra: Record<string, unknown> = {}): PayloadT {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: inline
      ? [{ url: "", key: "", nonce: "", digest: "", kind: "image", name: "foto.png", mediaType: "image/png", byteLength: inline.length, inline, ...extra }]
      : [],
    links: [],
    mentions: [],
  } as unknown as PayloadT
}

/** The vault entry of the message with this body. */
function entradaDe(contents: VaultContents, canal: string, corpo: string): StoredChatMessage | undefined {
  return entradasDoCanal(contents, canal).find((e) => e.payload["body"] === corpo)
}

/** The `sha` of the first attachment of the message with this body, if it is a reference. */
function shaDe(conta: ContaDeTeste, canal: string, corpo: string): string | undefined {
  const entrada = entradaDe(conta.vault.contents, canal, corpo)
  return entrada ? shasDoPayload(entrada.payload)[0] : undefined
}

/** The bytes this account's store has for this `sha`, in base64 (to compare). */
async function noArmazem(conta: ContaDeTeste, sha: string): Promise<string | null> {
  const bytes = await conta.session.bytesDeMedia(sha)
  return bytes ? Buffer.from(bytes).toString("base64") : null
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64")

describe("a sessão e o armazém de media", () => {
  it("uma imagem enviada fica como referência nos dois cofres, com o blob nos dois armazéns, e o cofre sem bytes", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const bytes = png(800, 600, 60_000)
    await ana!.session.send(canal, mensagem("a eira", dataUrl(bytes)))
    await ate(() => shaDe(bruno!, canal, "a eira") !== undefined, "o Bruno guarda a referência")
    await ate(() => shaDe(ana!, canal, "a eira") !== undefined, "a Ana guarda a referência")
    const sha = shaDe(ana!, canal, "a eira")!
    expect(shaDe(bruno!, canal, "a eira")).toBe(sha)
    await ana!.session.flush()
    await bruno!.session.flush()
    expect(semBytes(ana!.vault.contents)).toEqual([])
    expect(semBytes(bruno!.vault.contents)).toEqual([])
    expect(await noArmazem(ana!, sha)).toBe(b64(bytes))
    expect(await noArmazem(bruno!, sha)).toBe(b64(bytes))
    // An 800 px image stays an original: it leaves through the ceiling, and the thumbnail (without a thumbnailer, there is none) is another.
    expect(bruno!.vault.contents.media?.[sha]).toMatchObject({ c: "original", w: 800, h: 600, f: "bytes" })
  }, 60_000)

  it("a interface lê o histórico, o diretório e o ícone com as medidas da referência, e o cofre não as guarda (Task 10)", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, mensagem("o forno", dataUrl(png(900, 700, 60_000))))
    await ate(() => shaDe(bruno!, canal, "o forno") !== undefined, "o Bruno guarda a referência")
    const sha = shaDe(bruno!, canal, "o forno")!
    const item = bruno!.session.history(canal).find((e) => e.payload["body"] === "o forno")!.payload["attachments"] as Record<string, unknown>[]
    expect(item[0]).toMatchObject({ ref: sha, w: 900, h: 700, b: 60_000 })
    expect(item[0]?.["falta"]).toBeUndefined()
    // The vault still has no measurements on the item.
    expect(entradaDe(bruno!.vault.contents, canal, "o forno")!.payload["attachments"]).toEqual([expect.not.objectContaining({ w: 900 })])

    const retrato = dataUrl(png(96, 96, 3_000))
    await ana!.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: retrato })
    const avatarRef = ana!.vault.contents.profile.avatarRef!
    await ate(() => (bruno!.vault.contents.directory[ana!.address]?.payload["avatar"] as { ref?: string } | undefined)?.ref === avatarRef, "o retrato chega")
    expect(bruno!.session.directorySnapshot()[ana!.address]!.payload["avatar"]).toMatchObject({ ref: avatarRef, w: 96, h: 96, mini: avatarRef })

    await ana!.session.updateSpaceMeta(canal, { name: "Lagar", icon: retrato })
    await ate(() => bruno!.session.spaceMeta(canal)?.name === "Lagar", "o letreiro chega")
    expect(bruno!.session.spaceMeta(canal)).toMatchObject({ name: "Lagar", iconRef: avatarRef })
  }, 60_000)

  it("guardar o letreiro sem os bytes do ícone recusa, e o ícone fica para toda a gente (Task 10, ronda 1)", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const icone = dataUrl(png(64, 64, 2_000))
    ana!.armazem.falharProxima()
    await ana!.session.updateSpaceMeta(canal, { name: "Lagar", icon: icone })
    await ate(() => typeof bruno!.session.spaceMeta(canal)?.iconRef === "string", "o Bruno guarda o ícone")
    const iconRef = ana!.session.spaceMeta(canal)?.iconRef
    expect(iconRef).toBeDefined()
    expect(await ana!.session.bytesDeMedia(iconRef!)).toBeNull()
    await expect(ana!.session.updateSpaceMeta(canal, { name: "Lagar novo", iconRef: iconRef! })).rejects.toThrow("media store failed")
    // Nothing went out: Bruno still has the name and icon from before.
    await new Promise((resolver) => setTimeout(resolver, 300))
    expect(bruno!.session.spaceMeta(canal)).toMatchObject({ name: "Lagar", iconRef })
  }, 60_000)

  it("o retrato do perfil publicado em dois canais é uma referência só, e o m da autoria é o do inline", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const um = await canalComTodos(servidor, ana!, [bruno!])
    const dois = await canalComTodos(servidor, ana!, [bruno!])
    const retrato = dataUrl(png(96, 96, 3_000))
    await ana!.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: retrato })
    const avatarRef = ana!.vault.contents.profile.avatarRef
    expect(avatarRef).toBeDefined()
    expect(ana!.vault.contents.profile.avatarDataUrl).toBeUndefined()
    const shaNoBruno = () => {
      const avatar = bruno!.vault.contents.directory[ana!.address]?.payload["avatar"] as { ref?: string } | undefined
      return avatar?.ref
    }
    await ate(() => shaNoBruno() === avatarRef, "o Bruno guarda o retrato da Ana como referência")
    await ate(() => bruno!.session.estadoDoArmazem().minis > 0, "o blob do retrato chega ao armazém do Bruno")
    expect(Object.keys(bruno!.vault.contents.media ?? {}).filter((sha) => sha === avatarRef)).toHaveLength(1)
    expect(await noArmazem(bruno!, avatarRef!)).toBe(retrato.slice("data:image/png;base64,".length))
    // A small portrait never leaves (design §3), and it is its own thumbnail.
    expect(bruno!.vault.contents.media?.[avatarRef!]).toMatchObject({ c: "mini", mini: avatarRef })
    await ana!.session.flush()
    await bruno!.session.flush()
    expect(semBytes(ana!.vault.contents)).toEqual([])
    expect(semBytes(bruno!.vault.contents)).toEqual([])

    // The m that reached Bruno in both channels is the digest of the attachment with the original `inline` (authorship intact).
    const avatarOriginal = Payload.parse({
      t: "profile",
      displayName: "Ana",
      donations: [],
      updatedAt: 1,
      avatar: { url: "", inline: retrato, key: "", nonce: "", digest: "", kind: "image", name: "avatar", mediaType: "image/*", byteLength: retrato.length },
    }) as { avatar: unknown }
    const esperado = resumoDoAnexo(avatarOriginal.avatar)
    for (const canal of [um, dois]) {
      await ate(() => bruno!.vault.contents.autoriasDosPerfis?.[canal]?.[ana!.address] !== undefined, "a autoria do perfil chega")
      const autoria = bruno!.vault.contents.autoriasDosPerfis![canal]![ana!.address]!.autoria as { m?: string[] }
      expect(autoria.m?.[0]).toBe(esperado)
    }
  }, 60_000)

  it("com o disco cheio a meio: a referência fica, o blob não, e um membro serve-o depois pelo armazém (S5)", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const bytes = png(640, 480, 30_000)
    const falhas: string[] = []
    bruno!.session.on("media", (evento) => {
      if (evento.estado === "falhou") falhas.push(evento.erro ?? "")
    })
    bruno!.armazem.falharProxima()
    await ana!.session.send(canal, mensagem("o lagar", dataUrl(bytes)))
    await ate(() => shaDe(bruno!, canal, "o lagar") !== undefined, "o Bruno guarda a referência")
    const sha = shaDe(bruno!, canal, "o lagar")!
    await ate(() => falhas.length > 0, "a escrita falha no Bruno")
    expect(falhas).toEqual(["media store is full"])
    // The image is missing, and nothing else broke: the reference stays, the conversation goes on.
    expect(bruno!.vault.contents.media?.[sha]).toBeDefined()
    expect(await noArmazem(bruno!, sha)).toBeNull()
    await ana!.session.send(canal, mensagem("depois"))
    await ate(() => entradaDe(bruno!.vault.contents, canal, "depois") !== undefined, "a mensagem seguinte chega")

    const id = entradaDe(bruno!.vault.contents, canal, "o lagar")!.payload["id"] as string
    const desfecho = await bruno!.session.trazerMedia({ channel: canal, alvo: id, indice: 0 })
    expect(desfecho).toEqual({ ok: true })
    await ate(() => bruno!.session.estadoDoArmazem().originais > 0, "o blob chega ao armazém do Bruno")
    expect(await noArmazem(bruno!, sha)).toBe(b64(bytes))
    await bruno!.session.flush()
    expect(semBytes(bruno!.vault.contents)).toEqual([])
  }, 90_000)

  it("esquecer um canal recolhe o blob; uma lápide tira as referências do alvo e o blob sai", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const bytes = png(500, 500, 20_000)
    await ana!.session.send(canal, mensagem("a apagar", dataUrl(bytes)))
    await ana!.session.send(canal, mensagem("a esquecer", dataUrl(png(500, 400, 20_000))))
    await ate(() => shaDe(bruno!, canal, "a esquecer") !== undefined, "as duas chegam ao Bruno")
    const apagada = shaDe(bruno!, canal, "a apagar")!
    const esquecida = shaDe(bruno!, canal, "a esquecer")!
    expect(await noArmazem(bruno!, apagada)).not.toBeNull()

    const id = entradaDe(ana!.vault.contents, canal, "a apagar")!.payload["id"] as string
    await ana!.session.deleteMessage(canal, id)
    for (const conta of [ana!, bruno!]) {
      await ate(() => shaDe(conta, canal, "a apagar") === undefined, `a lápide tira a referência em ${conta.nome}`)
      await ate(() => conta.vault.contents.media?.[apagada] === undefined, `a recolha tira a referência morta em ${conta.nome}`)
      expect(await noArmazem(conta, apagada)).toBeNull()
    }
    // A outra fica.
    expect(await noArmazem(bruno!, esquecida)).not.toBeNull()

    await bruno!.session.forgetChannel(canal)
    expect(bruno!.vault.contents.media?.[esquecida]).toBeUndefined()
    expect(await bruno!.armazem.ler(esquecida)).toBeNull()
    expect(bruno!.session.estadoDoArmazem().originais).toBe(0)
  }, 60_000)

  it("o retrato do Welcome leva o perfil próprio inflado, e verifica do outro lado", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const retrato = dataUrl(png(120, 120, 4_000))
    await ana!.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: retrato })
    const avatarRef = ana!.vault.contents.profile.avatarRef!
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ate(() => {
      const avatar = bruno!.vault.contents.directory[ana!.address]?.payload["avatar"] as { ref?: string } | undefined
      return avatar?.ref === avatarRef
    }, "o Bruno recebe o retrato da Ana")
    expect(bruno!.vault.contents.directory[ana!.address]?.parcial).toBeUndefined()
    await ate(() => bruno!.session.estadoDoArmazem().minis > 0, "o blob chega")
    expect(await noArmazem(bruno!, avatarRef)).toBe(retrato.slice("data:image/png;base64,".length))
    expect(bruno!.vault.contents.autoriasDosPerfis?.[canal]?.[ana!.address]).toBeDefined()
  }, 60_000)

  it("trancar o cofre deixa bytesDeMedia nulo", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, mensagem("fechado", dataUrl(png(400, 400, 10_000))))
    const sha = shaDe(ana!, canal, "fechado")!
    expect(await noArmazem(ana!, sha)).not.toBeNull()
    ana!.session.disconnect()
    ana!.session.reset()
    ana!.vault.lock()
    expect(await ana!.session.bytesDeMedia(sha)).toBeNull()
    expect(ana!.session.estadoDoArmazem().originais).toBe(0)
    // The disk stays: the blobs are there, unreadable without the vault.
    expect(await ana!.armazem.ler(sha)).not.toBeNull()
  }, 60_000)

  it("trazer um retrato: sem ligação diz-o; sem irmão nem membro que o dê, sem-irmao", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    await canalComTodos(servidor, ana!, [bruno!])
    bruno!.armazem.falharProxima()
    const retrato = dataUrl(png(90, 90, 2_000))
    await ana!.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: retrato })
    const avatarRef = ana!.vault.contents.profile.avatarRef!
    await ate(() => {
      const avatar = bruno!.vault.contents.directory[ana!.address]?.payload["avatar"] as { ref?: string } | undefined
      return avatar?.ref === avatarRef
    }, "o Bruno tem a referência")
    await ate(() => bruno!.session.estadoDoArmazem().emFalta > 0, "sem o blob")
    ana!.session.disconnect()
    // Bruno has no other device: "sem-irmao" (no sibling to ask, and no member gave it).
    expect(await bruno!.session.trazerMedia({ sha: avatarRef })).toEqual({ ok: false, motivo: "sem-irmao" })
    bruno!.session.disconnect()
    expect(await bruno!.session.trazerMedia({ a: ana!.address })).toEqual({ ok: false, motivo: "sem-ligacao" })
  }, 60_000)

  it("o mesmo sha que chega depois como retrato passa a classe mini (Ruling R13)", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const bytes = png(400, 400, 60_000)
    const url = dataUrl(bytes)
    await ana!.session.send(canal, mensagem("primeiro como foto", url))
    await ate(() => shaDe(bruno!, canal, "primeiro como foto") !== undefined, "a foto chega")
    const sha = shaDe(bruno!, canal, "primeiro como foto")!
    expect(bruno!.vault.contents.media?.[sha]?.c).toBe("original")
    await ana!.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: url })
    expect(ana!.vault.contents.profile.avatarRef).toBe(sha)
    for (const conta of [ana!, bruno!]) {
      await ate(() => conta.vault.contents.media?.[sha]?.c === "mini", `o retrato passa a mini em ${conta.nome}`)
      // Re-encrypted with the new class, and readable through the new reference.
      expect(await noArmazem(conta, sha)).toBe(b64(bytes))
    }
  }, 60_000)

  it("um ref que um par manda no fio nunca se aceita: o esquema tira-o, e absorve-se o inline (Ruling R14)", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    const doBruno = png(300, 500, 15_000)
    await bruno!.session.send(canal, mensagem("a do bruno", dataUrl(doBruno)))
    await ate(() => shaDe(carla!, canal, "a do bruno") !== undefined, "a Carla tem a foto do Bruno")
    const vitima = shaDe(carla!, canal, "a do bruno")!

    // Ana, tampered, sends other bytes with the `ref` of Bruno's photo.
    forjar.quem = ana!.address
    const outros = png(300, 500, 15_000)
    const forjada = { ...mensagem("forjada", dataUrl(outros), { ref: vitima }), forjado: ana!.address } as unknown as PayloadT
    await ana!.session.send(canal, forjada)
    await ate(() => shaDe(carla!, canal, "forjada") !== undefined, "a forjada chega à Carla")
    const sha = shaDe(carla!, canal, "forjada")!
    expect(sha).not.toBe(vitima)
    expect(await noArmazem(carla!, sha)).toBe(b64(outros))
    expect(await noArmazem(carla!, vitima)).toBe(b64(doBruno))
  }, 60_000)

  it("um separador que perdeu a posse não apaga nem escreve blobs, e lê o que lá está (Ruling R17)", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const bytes = png(700, 300, 25_000)
    await ana!.session.send(canal, mensagem("partilhada", dataUrl(bytes)))
    const sha = shaDe(ana!, canal, "partilhada")!
    await ana!.session.flush()

    // The new tab, over the same vault and the same store, takes ownership; the old one stops.
    const vault = new Vault(ana!.backend)
    await vault.unlock("frase-passe-de-teste")
    const novo = new Session(vault, { armazem: ana!.armazem })
    ana!.session.pararDeEscrever()
    // The seal reaches the store: the backend refuses writes and deletes from now on.
    await expect(ana!.armazem.escrever("x".repeat(43), new Uint8Array(8), { bytes: 8, classe: "original", ultimoUso: 1 })).rejects.toThrow("media store failed")
    await expect(ana!.armazem.apagar([sha])).rejects.toThrow("media store failed")
    expect(await noArmazem(ana!, sha)).toBe(b64(bytes))
    await ana!.session.forgetChannel(canal).catch(() => {})
    expect(await ana!.armazem.ler(sha)).not.toBeNull()
    // And the tab with ownership reads the blob the old one wrote.
    await vault.armazemPronto()
    expect(await novo.bytesDeMedia(sha)).toEqual(bytes)

  }, 60_000)

  it("abrir um cofre com bytes migra-os para o armazém em segundo plano; um separador sem posse não migra (Ruling R15, R17)", async () => {
    // A snapshot with bytes (the version 2 vault) is left to migrate right at `create`.
    const backend = new CofreEmMemoria()
    const armazem = new ArmazemEmMemoria()
    const vault = new Vault(backend)
    await vault.create("frase", cofreV2() as unknown as VaultContents)
    expect(vault.contents.armazem?.porMigrar).toBe(true)
    await vault.update(() => {})

    // The tab without ownership: opens the same vault, with its own store connection (on the web, each tab has its own), and stops before migrating.
    const velho = new Vault(backend)
    await velho.unlock("frase")
    const doVelho = new ArmazemEmMemoria()
    const parado = new Session(velho, { armazem: doVelho })
    parado.pararDeEscrever()
    await parado.restore()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect((await doVelho.listar()).length).toBe(0)
    expect(velho.contents.armazem?.porMigrar).toBe(true)

    const session = new Session(vault, { armazem })
    await session.restore()
    await ate(() => vault.contents.armazem === undefined, "a migração acaba")
    expect(semBytes(vault.contents)).toEqual([])
    expect(vault.contents.profile.avatarRef).toBeDefined()
    expect(await session.bytesDeMedia(vault.contents.profile.avatarRef!)).not.toBeNull()
    expect((await armazem.listar()).length).toBeGreaterThan(0)
  }, 60_000)

  it("o disco cheio no retrato próprio não trava o perfil: o nome novo e o retrato chegam na mesma", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    await canalComTodos(servidor, ana!, [bruno!])
    const retrato = dataUrl(png(100, 100, 3_000))
    ana!.armazem.falharProxima()
    await ana!.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: retrato })
    // The write fails: the portrait goes back to the vault, to migrate.
    await ate(() => ana!.vault.contents.profile.avatarDataUrl === retrato, "o retrato volta ao cofre")
    await ana!.session.updateProfile({ ...ana!.session.profile, displayName: "Ana Lima" })
    await ate(() => bruno!.vault.contents.directory[ana!.address]?.payload["displayName"] === "Ana Lima", "o nome novo chega ao Bruno")
    const sha = (bruno!.vault.contents.directory[ana!.address]!.payload["avatar"] as { ref?: string }).ref
    expect(sha).toBeDefined()
    await ate(() => bruno!.session.estadoDoArmazem().minis > 0, "o retrato chega ao armazém do Bruno")
    expect(await noArmazem(bruno!, sha!)).toBe(retrato.slice("data:image/png;base64,".length))
  }, 60_000)

  it("um vídeo em preparação não sai pela recolha antes de a publicação entrar no cofre, e guarda o tipo", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const outro = await canalComTodos(servidor, ana!, [bruno!])
    const bytes = Uint8Array.from(randomBytes(40_000))
    // The post waits here, with the video already in the store and no post referencing it yet.
    let soltar!: () => void
    const parado = new Promise<void>((resolve) => (soltar = resolve))
    const ensureFeed = ana!.session.ensureFeed.bind(ana!.session)
    let chegou!: () => void
    const naEspera = new Promise<void>((resolve) => (chegou = resolve))
    vi.spyOn(ana!.session, "ensureFeed").mockImplementation(async () => {
      chegou()
      await parado
      return ensureFeed()
    })
    const publicacao = ana!.session.publicarVideo("o rio", [], {}, { bytes, name: "rio.webm", mediaType: "video/webm", duration: 3 })
    await naEspera
    const sha = Object.keys(ana!.vault.contents.media ?? {}).find((s) => ana!.vault.contents.media![s]!.t.startsWith("video/"))
    expect(sha).toBeDefined()
    expect(ana!.vault.contents.media![sha!]!.t).toBe("video/webm")
    // A collection (forgetting a channel) in this window.
    await ana!.session.forgetChannel(outro)
    expect(ana!.vault.contents.media?.[sha!]).toBeDefined()
    expect(await ana!.armazem.ler(sha!)).not.toBeNull()
    soltar()
    await publicacao
    expect(Buffer.from((await ana!.session.bytesDeMedia(sha!))!).equals(Buffer.from(bytes))).toBe(true)
  }, 60_000)

  it("a lápide de quem modera não tira as referências do alvo; a do autor tira (Ruling R22)", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await bruno!.session.send(canal, mensagem("moderada", dataUrl(png(400, 300, 12_000))))
    await ate(() => shaDe(carla!, canal, "moderada") !== undefined && shaDe(ana!, canal, "moderada") !== undefined, "a foto chega")
    const sha = shaDe(carla!, canal, "moderada")!
    const id = entradaDe(ana!.vault.contents, canal, "moderada")!.payload["id"] as string
    await ana!.session.deleteMessage(canal, id)
    await ate(() => entradasDoCanal(carla!.vault.contents, canal).some((e) => e.payload.t === "redact"), "a lápide chega à Carla")
    await new Promise((resolve) => setTimeout(resolve, 300))
    for (const conta of [ana!, carla!]) {
      expect(shaDe(conta, canal, "moderada")).toBe(sha)
      expect(await noArmazem(conta, sha)).not.toBeNull()
    }

    // The author's half: Bruno's own tombstone removes the references, and the collection deletes the blob.
    await bruno!.session.send(canal, mensagem("do autor", dataUrl(png(300, 400, 12_000))))
    await ate(() => shaDe(carla!, canal, "do autor") !== undefined && shaDe(ana!, canal, "do autor") !== undefined, "a segunda foto chega")
    const doAutor = shaDe(carla!, canal, "do autor")!
    const idDoAutor = entradaDe(bruno!.vault.contents, canal, "do autor")!.payload["id"] as string
    await bruno!.session.deleteMessage(canal, idDoAutor)
    for (const conta of [ana!, bruno!, carla!]) {
      await ate(() => shaDe(conta, canal, "do autor") === undefined, `a lápide do autor tira a referência em ${conta.nome}`)
      await ate(() => conta.vault.contents.media?.[doAutor] === undefined, `a recolha apaga em ${conta.nome}`)
      expect(await noArmazem(conta, doAutor)).toBeNull()
    }
    // A moderada continua.
    expect(await noArmazem(carla!, sha)).not.toBeNull()
  }, 60_000)

  it("um vídeo publicado deixa de estar em voo: esquecer o canal dele recolhe-o; trancar limpa os em voo", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const outro = await canalComTodos(servidor, ana!, [bruno!])
    const video = { bytes: Uint8Array.from(randomBytes(30_000)), name: "a.webm", mediaType: "video/webm", duration: 2 }
    await ana!.session.publicarVideo("publicado", [], {}, video)
    const feed = ana!.session.feedChannel
    const sha = Object.keys(ana!.vault.contents.media ?? {}).find((s) => ana!.vault.contents.media![s]!.t.startsWith("video/"))!
    expect(await ana!.armazem.ler(sha)).not.toBeNull()
    await ana!.session.forgetChannel(feed)
    expect(ana!.vault.contents.media?.[sha]).toBeUndefined()
    expect(await ana!.armazem.ler(sha)).toBeNull()

    // One in flight (the post on hold) and the vault locked and opened: the in-flight one leaves, and the next collection deletes the orphan.
    let soltar!: () => void
    const parado = new Promise<void>((resolve) => (soltar = resolve))
    let chegou!: () => void
    const naEspera = new Promise<void>((resolve) => (chegou = resolve))
    vi.spyOn(ana!.session, "ensureFeed").mockImplementation(async () => {
      chegou()
      await parado
      throw new Error("parado de propósito")
    })
    const publicacao = ana!.session.publicarVideo("parada", [], {}, { ...video, bytes: Uint8Array.from(randomBytes(30_000)) })
    await naEspera
    const emVoo = Object.keys(ana!.vault.contents.media ?? {}).find((s) => ana!.vault.contents.media![s]!.t.startsWith("video/"))!
    await ana!.session.forgetChannel(outro).catch(() => {})
    expect(await ana!.armazem.ler(emVoo)).not.toBeNull()
    ana!.session.disconnect()
    ana!.session.reset()
    ana!.vault.lock()
    await ana!.vault.unlock("frase-passe-de-teste")
    await ana!.session.restore()
    await ana!.session.forgetChannel("!nenhum:localhost").catch(() => {})
    expect(ana!.vault.contents.media?.[emVoo]).toBeUndefined()
    expect(await ana!.armazem.ler(emVoo)).toBeNull()
    soltar()
    await publicacao.catch(() => {})
  }, 60_000)
})
