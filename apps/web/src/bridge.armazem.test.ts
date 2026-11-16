import { ArmazemEmMemoria, Session, Vault, type ArmazemBackend, type DerivarChaveDoCofre, type EventoDeMedia } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserArmazemBackend } from "./armazem-backend.js"
import { createBrowserBridge } from "./bridge.js"
import { BasesFalsas } from "./testes/idb-falso.js"
import { BrowserVaultBackend, RECUSA_DE_ESCRITA } from "./vault-backend.js"

/**
 * The media store in the browser bridge (design §8 and §9), with the real
 * parts: the core's `Vault` and `Session`, the two backends in this folder,
 * and only the fake IndexedDB underneath.
 *
 * What is pinned: the interface reads bytes, pins, unpins, reads the state,
 * changes the ceiling and asks to "Fetch" through the bridge; a failing backend
 * gives `null` and never throws (Review Focus 1); `pararDeEscrever` seals the
 * store with the vault, and a tab without ownership neither migrates nor
 * collects (Ruling R23); the old tab does not write, and the orphan it wrote
 * earlier leaves at the hand of the new owner (Focus 4); `destroy` deletes the
 * media database.
 */

const FRASE = "frase-de-teste-do-armazem"
const rapida: DerivarChaveDoCofre = async () => new Uint8Array(32).fill(7)
const RETRATO = `data:image/png;base64,${"R".repeat(4_000)}`
/** A valid sha that no vault reference points to: the orphan blob of a crash. */
const ORFAO = "o".repeat(43)

let idb: BasesFalsas
const recolhaAntes = Session.RECOLHA_ADIADA_MS

beforeEach(() => {
  idb = new BasesFalsas()
  ;(globalThis as { indexedDB?: unknown }).indexedDB = idb.indexedDB
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  Session.RECOLHA_ADIADA_MS = recolhaAntes
})

interface Aberta {
  ponte: ReturnType<typeof createBrowserBridge>
  session: Session
  vault: Vault
}

/** A bridge with the vault created and the identity made. `armazem` swaps the media backend. */
async function abrir(opcoes: { armazem?: ArmazemBackend; dono?: string; criar?: boolean } = {}): Promise<Aberta> {
  let partes: { session: Session; vault: Vault } | null = null
  const ponte = createBrowserBridge({
    backend: new BrowserVaultBackend(),
    derivar: rapida,
    ...(opcoes.armazem ? { armazem: opcoes.armazem, miniaturista: null } : {}),
    aoCriar: (criadas) => (partes = criadas),
  })
  await ponte.assumirPosse(opcoes.dono ?? "dono-a")
  if (opcoes.criar ?? true) {
    await ponte.vault.create(FRASE)
    await ponte.identity.create("localhost:8448")
  }
  const { session, vault } = partes as unknown as { session: Session; vault: Vault }
  return { ponte, session, vault }
}

/** Sets a portrait on the profile (absorbs it into the store) and returns the sha. */
async function comRetrato({ ponte, vault }: Aberta): Promise<string> {
  await ponte.profile.set({ displayName: "Ana", donations: [], avatarDataUrl: RETRATO })
  const sha = vault.contents.profile.avatarRef
  expect(sha, "o retrato foi para o armazém").toBeTruthy()
  return sha as string
}

describe("a ponte do browser expõe o armazém de media", () => {
  it("o perfil lido traz o avatarRef, e guardá-lo outra vez (mudar o estado) não perde o retrato (Task 10)", async () => {
    const aberta = await abrir({ armazem: new ArmazemEmMemoria() })
    const sha = await comRetrato(aberta)
    const lido = await aberta.ponte.profile.get()
    expect(lido.avatarRef).toBe(sha)
    expect(lido.avatarDataUrl).toBeUndefined()
    await aberta.ponte.profile.set({ ...lido, statusText: "na eira" })
    expect(aberta.vault.contents.profile.avatarRef).toBe(sha)
    expect(aberta.vault.contents.profile.statusText).toBe("na eira")
  })

  it("bytes, estado, tecto, fixar, soltar e trazer passam pela ponte", async () => {
    const aberta = await abrir({ armazem: new ArmazemEmMemoria() })
    const { ponte } = aberta
    const eventos: EventoDeMedia[] = []
    ponte.on.media?.((evento) => eventos.push(evento))

    const sha = await comRetrato(aberta)
    const bytes = await ponte.media?.bytes(sha)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(bytes as Uint8Array).toString("base64")).toBe("R".repeat(4_000))
    await vi.waitFor(() => expect(eventos).toContainEqual({ sha, estado: "guardado" }))

    expect(await ponte.media?.bytes("x".repeat(43)), "um sha sem referência").toBeNull()

    await ponte.media?.fixar(sha)
    await ponte.media?.soltar(sha)
    const estado = await ponte.media?.estado()
    expect(estado?.tecto).toBe(500_000_000)
    // A small portrait is its own thumbnail (class "mini"): it stays outside the ceiling.
    expect(estado?.minis).toBe(1)

    await ponte.media?.definirTecto(250_000_000)
    expect((await ponte.media?.estado())?.tecto).toBe(250_000_000)
    await expect(ponte.media?.definirTecto(123)).rejects.toThrow("invalid media store ceiling")

    // Without a server there is no one to ask: the outcome says so, and does not throw.
    expect(await ponte.media?.trazer({ sha })).toEqual({ ok: false, motivo: "sem-ligacao" })
    expect(await ponte.media?.trazer({ a: "@bruno:localhost:8448" })).toEqual({ ok: false, motivo: "sem-ligacao" })
    expect(await ponte.media?.trazer({ channel: "c", alvo: "m", indice: 0 })).toEqual({ ok: false, motivo: "sem-ligacao" })
  })

  it("libertar tira os originais não fixados e deixa as miniaturas (Task 11)", async () => {
    const armazem = new ArmazemEmMemoria()
    const aberta = await abrir({ armazem })
    const mini = await comRetrato(aberta)
    await vi.waitFor(async () => expect(await armazem.ler(mini)).not.toBeNull())
    await armazem.escrever(ORFAO, new Uint8Array(8), { bytes: 8, classe: "original", ultimoUso: 1 })
    await aberta.ponte.vault.lock()
    // Reopening rereads the disk inventory, with the original that was put there.
    await aberta.ponte.vault.unlock(FRASE)
    expect((await aberta.ponte.media?.estado())?.originais).toBe(1)
    await aberta.ponte.media?.libertar()
    expect(await armazem.ler(ORFAO)).toBeNull()
    expect(await armazem.ler(mini)).not.toBeNull()
    expect(await aberta.ponte.media?.estado()).toMatchObject({ originais: 0, minis: 1 })
  })

  it("a quota do browser chega ao estado como tecto efectivo (Task 11)", async () => {
    const armazem = Object.assign(new ArmazemEmMemoria(), { quota: async () => 150_000_000 })
    const { ponte } = await abrir({ armazem })
    expect(await ponte.media?.estado()).toMatchObject({ tecto: 500_000_000, tectoEfectivo: 100_000_000 })
  })

  it("um backend que falha a ler dá null, e não atira (Review Focus 1)", async () => {
    const armazem = new ArmazemEmMemoria()
    const aberta = await abrir({ armazem })
    const sha = await comRetrato(aberta)
    // Until the write finishes the blob is still in memory: wait for the disk.
    await vi.waitFor(async () => expect(await armazem.ler(sha)).not.toBeNull())
    armazem.ler = () => Promise.reject(new Error("local storage failed"))
    await expect(aberta.ponte.media?.bytes(sha)).resolves.toBeNull()
  })

  it("com o cofre fechado, bytes dá null", async () => {
    const aberta = await abrir({ armazem: new ArmazemEmMemoria() })
    const sha = await comRetrato(aberta)
    await aberta.ponte.vault.lock()
    await expect(aberta.ponte.media?.bytes(sha)).resolves.toBeNull()
  })
})

describe("o armazém sela-se com o cofre", () => {
  it("pararDeEscrever sem gravar sela o armazém, e a sessão deixa de escrever", async () => {
    const armazem = new ArmazemEmMemoria()
    const { ponte, session } = await abrir({ armazem })
    await ponte.pararDeEscrever({ gravar: false })
    expect(session.escreve()).toBe(false)
    await expect(armazem.escrever(ORFAO, new Uint8Array(4), { bytes: 4, classe: "original", ultimoUso: 1 })).rejects.toThrow("media store failed")
    await expect(armazem.apagar([ORFAO])).rejects.toThrow()
  })

  it("pararDeEscrever com gravação também sela o armazém", async () => {
    const armazem = new ArmazemEmMemoria()
    const { ponte } = await abrir({ armazem })
    await ponte.pararDeEscrever()
    await expect(armazem.escrever(ORFAO, new Uint8Array(4), { bytes: 4, classe: "original", ultimoUso: 1 })).rejects.toThrow("media store failed")
  })

  it("com gravação, o blob que estava na fila chega ao disco antes do selo, sem Erro 521", async () => {
    const armazem = new ArmazemEmMemoria()
    const aberta = await abrir({ armazem })
    const eventos: EventoDeMedia[] = []
    aberta.ponte.on.media?.((evento) => eventos.push(evento))
    // The disk is slow: the portrait write stays in the queue until the gate opens.
    let abrirPortao: () => void = () => {}
    const portao = new Promise<void>((resolve) => (abrirPortao = resolve))
    const escrever = armazem.escrever.bind(armazem)
    armazem.escrever = async (...argumentos) => {
      await portao
      return escrever(...argumentos)
    }
    const sha = await comRetrato(aberta)
    const parado = aberta.ponte.pararDeEscrever()
    await Promise.resolve()
    abrirPortao()
    await parado
    expect(await armazem.ler(sha), "o blob que o cofre gravado referencia").not.toBeNull()
    expect(eventos.filter((evento) => evento.estado === "falhou")).toEqual([])
  })

  it("o separador velho não escreve, e o órfão que escreveu antes sai pela mão do dono novo (Review Focus 4)", async () => {
    Session.RECOLHA_ADIADA_MS = 0
    const doVelho = new BrowserArmazemBackend()
    const velho = await abrir({ armazem: doVelho })
    // Before yielding, the old tab left a blob the vault does not reference (a crash halfway).
    await doVelho.escrever(ORFAO, new Uint8Array(8), { bytes: 8, classe: "original", ultimoUso: 1 })
    await velho.ponte.pararDeEscrever()
    // Sealed: the old tab's backend refuses to write and delete.
    await expect(doVelho.escrever("n".repeat(43), new Uint8Array(8), { bytes: 8, classe: "original", ultimoUso: 2 })).rejects.toThrow(RECUSA_DE_ESCRITA)
    await expect(doVelho.apagar([ORFAO])).rejects.toThrow(RECUSA_DE_ESCRITA)
    expect(await doVelho.ler("n".repeat(43))).toBeNull()
    await expect(velho.ponte.profile.set({ displayName: "Ana", donations: [], avatarDataUrl: RETRATO })).rejects.toThrow()
    expect(await new BrowserArmazemBackend().ler(ORFAO), "ainda lá, ninguém recolheu").not.toBeNull()

    const novo = await abrir({ dono: "dono-b", criar: false })
    await novo.ponte.vault.unlock(FRASE)
    await novo.session.restore()
    await vi.waitFor(async () => expect(await new BrowserArmazemBackend().ler(ORFAO)).toBeNull())
  })

  /*
    R23. Opening a vault with nothing to migrate runs only in microtasks until
    it schedules the collection (`#cuidarDoArmazem`): one turn of the event loop
    is enough for the decision to be made, without waiting any time. The
    collection has a single delay, and what is measured is whether that
    `setTimeout` was requested.
  */
  const RECOLHA_MARCADA = 4_321

  /** Opens the vault in a second tab and says whether opening scheduled the collection. */
  async function recolhaAgendadaNoSegundo(parar: boolean): Promise<boolean> {
    Session.RECOLHA_ADIADA_MS = RECOLHA_MARCADA
    const primeiro = await abrir()
    await primeiro.ponte.pararDeEscrever()
    const segundo = await abrir({ dono: "dono-b", criar: false })
    await segundo.ponte.vault.unlock(FRASE)
    if (parar) await segundo.ponte.pararDeEscrever({ gravar: false })
    const relogio = vi.spyOn(globalThis, "setTimeout")
    await segundo.session.restore()
    // One turn of the loop: the opening's microtasks finish first.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (parar) expect(segundo.session.escreve()).toBe(false)
    return relogio.mock.calls.some(([, atraso]) => atraso === RECOLHA_MARCADA)
  }

  it("o dono agenda a recolha ao abrir (o controlo do teste seguinte)", async () => {
    expect(await recolhaAgendadaNoSegundo(false)).toBe(true)
  })

  it("um separador que para antes de restore nunca migra nem recolhe (Ruling R23)", async () => {
    expect(await recolhaAgendadaNoSegundo(true)).toBe(false)
  })
})

describe("apagar a conta apaga os media", () => {
  it("destroy chama destruir: a base enclave-media vai-se", async () => {
    const aberta = await abrir()
    await comRetrato(aberta)
    await vi.waitFor(async () => expect((await new BrowserArmazemBackend().listar()).length).toBe(1))
    await aberta.ponte.vault.destroy()
    expect(idb.apagadas).toContain("enclave-media")
  })
})
