import { CONTA_PRINCIPAL } from "@enclave/client-core/contas"
import { beforeEach, describe, expect, it } from "vitest"
import { BrowserArmazemBackend } from "./armazem-backend.js"
import { BasesFalsas } from "./testes/idb-falso.js"
import { RECUSA_DE_ESCRITA, nomeDaBaseDeMedia } from "./vault-backend.js"

/**
 * The media store on the web: a database separate from the vault
 * (`enclave-media`, or `enclave-media:<id>` for another account), against the
 * fake IndexedDB in `testes/`.
 */

let idb: BasesFalsas

beforeEach(() => {
  idb = new BasesFalsas()
  ;(globalThis as { indexedDB?: unknown }).indexedDB = idb.indexedDB
})

const OUTRA = "b7"
const blob = (n: number, tamanho = 4): Uint8Array => new Uint8Array(tamanho).fill(n)
const original = (u = 10) => ({ bytes: 4, classe: "original" as const, ultimoUso: u })

describe("nomeDaBaseDeMedia", () => {
  it("a principal é enclave-media; as outras levam o id; um id inválido não passa", () => {
    expect(nomeDaBaseDeMedia(CONTA_PRINCIPAL)).toBe("enclave-media")
    expect(nomeDaBaseDeMedia(OUTRA)).toBe(`enclave-media:${OUTRA}`)
    expect(() => nomeDaBaseDeMedia("../x")).toThrow("there is no such account on this device")
  })
})

describe("BrowserArmazemBackend", () => {
  it("escreve, lê, lista e apaga", async () => {
    const backend = new BrowserArmazemBackend()
    await backend.escrever("aaa", blob(1), original(10))
    await backend.escrever("bbb", blob(2), { bytes: 4, classe: "mini", ultimoUso: 20 })
    expect(await backend.ler("aaa")).toEqual(blob(1))
    expect(await backend.ler("zzz")).toBeNull()
    const lista = await backend.listar()
    expect(lista.sort((a, b) => a.sha.localeCompare(b.sha))).toEqual([
      { sha: "aaa", bytes: 4, ultimoUso: 10, classe: "original" },
      { sha: "bbb", bytes: 4, ultimoUso: 20, classe: "mini" },
    ])
    await backend.apagar(["aaa"])
    expect(await backend.ler("aaa")).toBeNull()
    expect((await backend.listar()).map((e) => e.sha)).toEqual(["bbb"])
    expect(idb.bases.has("enclave-media")).toBe(true)
  })

  it("o que se grava é uma cópia exacta, mesmo de uma vista dentro de um buffer maior", async () => {
    const backend = new BrowserArmazemBackend()
    const grande = new Uint8Array([9, 3, 3, 3, 3, 9])
    const escrito = grande.subarray(1, 5)
    await backend.escrever("aaa", escrito, original())
    grande.fill(7)
    const guardado = idb.base("enclave-media").store("blobs").get("aaa") as ArrayBuffer
    expect(guardado.byteLength).toBe(4)
    expect(await backend.ler("aaa")).toEqual(blob(3))
  })

  it("escrever o mesmo sha não duplica nem substitui", async () => {
    const backend = new BrowserArmazemBackend()
    await backend.escrever("aaa", blob(1), original(10))
    await backend.escrever("aaa", blob(2), original(99))
    expect(await backend.listar()).toEqual([{ sha: "aaa", bytes: 4, ultimoUso: 10, classe: "original" }])
    expect(await backend.ler("aaa")).toEqual(blob(1))
  })

  it("tocar muda o último uso; tocar um sha que não existe não o ressuscita", async () => {
    const backend = new BrowserArmazemBackend()
    await backend.escrever("aaa", blob(1), original(10))
    await backend.tocar("aaa", 50)
    await backend.apagar(["aaa"])
    await backend.tocar("aaa", 60)
    await backend.tocar("nunca", 70)
    expect(await backend.listar()).toEqual([])
    await backend.escrever("bbb", blob(2), original(10))
    await backend.tocar("bbb", 80)
    expect(await backend.listar()).toEqual([{ sha: "bbb", bytes: 4, ultimoUso: 80, classe: "original" }])
  })

  it("o tecto guarda-se na base; sem tecto guardado, nulo", async () => {
    const backend = new BrowserArmazemBackend()
    expect(await backend.lerTecto()).toBeNull()
    await backend.guardarTecto(250_000_000)
    expect(await backend.lerTecto()).toBe(250_000_000)
    expect(await new BrowserArmazemBackend().lerTecto()).toBe(250_000_000)
  })

  it("a quota é a do navigator.storage.estimate(); sem ele, ou se falha, nula (Task 11)", async () => {
    const storage = Object.getOwnPropertyDescriptor(navigator, "storage")
    try {
      Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => ({ quota: 300_000_000, usage: 1 }) } })
      expect(await new BrowserArmazemBackend().quota()).toBe(300_000_000)
      Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => Promise.reject(new Error("não")) } })
      expect(await new BrowserArmazemBackend().quota()).toBeNull()
      Object.defineProperty(navigator, "storage", { configurable: true, value: undefined })
      expect(await new BrowserArmazemBackend().quota()).toBeNull()
    } finally {
      if (storage) Object.defineProperty(navigator, "storage", storage)
      else delete (navigator as { storage?: unknown }).storage
    }
  })

  it("depois do selo, escrever, tocar, apagar, o tecto e destruir são recusados", async () => {
    const backend = new BrowserArmazemBackend()
    await backend.escrever("aaa", blob(1), original(10))
    backend.selar()
    await expect(backend.escrever("bbb", blob(2), original())).rejects.toThrow(RECUSA_DE_ESCRITA)
    await expect(backend.apagar(["aaa"])).rejects.toThrow(RECUSA_DE_ESCRITA)
    await expect(backend.tocar("aaa", 99)).rejects.toThrow(RECUSA_DE_ESCRITA)
    await expect(backend.guardarTecto(1)).rejects.toThrow(RECUSA_DE_ESCRITA)
    await expect(backend.destruir()).rejects.toThrow(RECUSA_DE_ESCRITA)
    // Ler continua: dois separadores só leem.
    expect(await backend.ler("aaa")).toEqual(blob(1))
    expect(await backend.listar()).toEqual([{ sha: "aaa", bytes: 4, ultimoUso: 10, classe: "original" }])
  })

  it("destruir apaga a base inteira", async () => {
    const backend = new BrowserArmazemBackend()
    await backend.escrever("aaa", blob(1), original())
    await backend.guardarTecto(1_000)
    await backend.destruir()
    expect(idb.apagadas).toEqual(["enclave-media"])
    expect(idb.bases.has("enclave-media")).toBe(false)
    // After destroying, the database comes back empty if someone opens it.
    expect(await backend.listar()).toEqual([])
    expect(await backend.lerTecto()).toBeNull()
  })

  it("duas contas, duas bases", async () => {
    const principal = new BrowserArmazemBackend()
    const outra = new BrowserArmazemBackend({ conta: OUTRA })
    await principal.escrever("aaa", blob(1), original())
    await outra.escrever("bbb", blob(2), original())
    expect((await principal.listar()).map((e) => e.sha)).toEqual(["aaa"])
    expect((await outra.listar()).map((e) => e.sha)).toEqual(["bbb"])
    expect([...idb.bases.keys()].sort()).toEqual(["enclave-media", `enclave-media:${OUTRA}`])
    await outra.destruir()
    expect((await principal.listar()).map((e) => e.sha)).toEqual(["aaa"])
  })

  it("uma conta inválida não chega a abrir nada", () => {
    expect(() => new BrowserArmazemBackend({ conta: "../x" })).toThrow("there is no such account on this device")
  })

  it("a quota do browser vira media store is full, e nada fica a meio", async () => {
    const backend = new BrowserArmazemBackend()
    idb.base("enclave-media").aoGravar = (store) => {
      if (store === "blobs") throw new DOMException("quota", "QuotaExceededError")
    }
    await expect(backend.escrever("aaa", blob(1), original())).rejects.toThrow("media store is full")
    idb.base("enclave-media").aoGravar = null
    expect(await backend.listar()).toEqual([])
    expect(await backend.ler("aaa")).toBeNull()
  })

  it("outra falha do IndexedDB não se faz passar por quota", async () => {
    const backend = new BrowserArmazemBackend()
    idb.base("enclave-media").aoGravar = () => {
      throw new DOMException("boom", "UnknownError")
    }
    const erro = await backend.escrever("aaa", blob(1), original()).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).not.toBe("media store is full")
  })
})
