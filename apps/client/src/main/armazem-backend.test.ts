import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ArmazemDeMedia, type RefDeMedia } from "@enclave/client-core"

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

/** The full disk, requested per test (as in `vault-backend.test.ts`). */
const disco = vi.hoisted(() => {
  const estado = { codigo: null as string | null }
  const falso = async (original: () => Promise<unknown>): Promise<unknown> => {
    const fs = (await original()) as typeof import("node:fs")
    const writeFileSync = (...argumentos: Parameters<typeof fs.writeFileSync>): void => {
      if (estado.codigo !== null) {
        fs.writeFileSync(argumentos[0], "meio")
        throw Object.assign(new Error(`${estado.codigo}: no space left on device, write`), { code: estado.codigo })
      }
      fs.writeFileSync(...argumentos)
    }
    return { ...fs, default: { ...fs, writeFileSync }, writeFileSync }
  }
  return { estado, falso }
})
vi.mock("node:fs", (original) => disco.falso(original))
vi.mock("fs", (original) => disco.falso(original))

const { ArmazemDaContaActiva, DesktopArmazemBackend } = await import("./armazem-backend.js")
const { DesktopVaultBackend } = await import("./vault-backend.js")

const pastas: string[] = []
afterEach(() => {
  disco.estado.codigo = null
  vi.useRealTimers()
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function novaPasta(): string {
  const pasta = mkdtempSync(join(tmpdir(), "armazem-"))
  pastas.push(pasta)
  return pasta
}

const blob = (n: number, tamanho = 4): Uint8Array => new Uint8Array(tamanho).fill(n)
const original = (u = 10) => ({ bytes: 4, classe: "original" as const, ultimoUso: u })
const ordenado = <T extends { sha: string }>(lista: T[]): T[] => lista.sort((a, b) => a.sha.localeCompare(b.sha))
const indice = (pasta: string): { v: number; tecto: number | null; usos: Record<string, number>; minis: string[] } =>
  JSON.parse(readFileSync(join(pasta, "media", "indice.json"), "utf8"))

describe("DesktopArmazemBackend", () => {
  it("escreve <sha>.orwm em media/, com modo 0600, e lê, lista e apaga", async () => {
    const pasta = novaPasta()
    const backend = new DesktopArmazemBackend(pasta)
    await backend.escrever("aaa", blob(1), original(10))
    await backend.escrever("bbb", blob(2, 6), { bytes: 6, classe: "mini", ultimoUso: 20 })
    expect(readdirSync(join(pasta, "media")).filter((f) => f.endsWith(".orwm")).sort()).toEqual(["aaa.orwm", "bbb.orwm"])
    if (process.platform !== "win32") expect(statSync(join(pasta, "media", "aaa.orwm")).mode & 0o777).toBe(0o600)
    expect(await backend.ler("aaa")).toEqual(blob(1))
    expect(await backend.ler("zzz")).toBeNull()
    expect(ordenado(await backend.listar())).toEqual([
      { sha: "aaa", bytes: 4, ultimoUso: 10, classe: "original" },
      { sha: "bbb", bytes: 6, ultimoUso: 20, classe: "mini" },
    ])
    await backend.apagar(["aaa"])
    expect(existsSync(join(pasta, "media", "aaa.orwm"))).toBe(false)
    expect((await backend.listar()).map((e) => e.sha)).toEqual(["bbb"])
  })

  it("escrever o mesmo sha não duplica nem substitui", async () => {
    const backend = new DesktopArmazemBackend(novaPasta())
    await backend.escrever("aaa", blob(1), original(10))
    await backend.escrever("aaa", blob(2), original(99))
    expect(await backend.listar()).toEqual([{ sha: "aaa", bytes: 4, ultimoUso: 10, classe: "original" }])
    expect(await backend.ler("aaa")).toEqual(blob(1))
  })

  it("um sha que não é base64url não vira caminho", async () => {
    const pasta = novaPasta()
    const backend = new DesktopArmazemBackend(pasta)
    await expect(backend.escrever("../fora", blob(1), original())).rejects.toThrow()
    expect(await backend.ler("../vault")).toBeNull()
    expect(existsSync(join(pasta, "fora.orwm"))).toBe(false)
  })

  it("tocar muda o último uso; tocar um sha que não existe não o ressuscita", async () => {
    const pasta = novaPasta()
    const backend = new DesktopArmazemBackend(pasta)
    await backend.escrever("aaa", blob(1), original(10))
    await backend.tocar("aaa", 50)
    await backend.apagar(["aaa"])
    await backend.tocar("aaa", 60)
    await backend.tocar("nunca", 70)
    expect(await backend.listar()).toEqual([])
    await backend.escrever("bbb", blob(2), original(10))
    await backend.tocar("bbb", 80)
    expect(await backend.listar()).toEqual([{ sha: "bbb", bytes: 4, ultimoUso: 80, classe: "original" }])
    backend.descarregar()
    expect(indice(pasta).usos).toEqual({ bbb: 80 })
  })

  it("o índice escreve-se no máximo de 10 em 10 s, e ao descarregar", async () => {
    vi.useFakeTimers()
    const pasta = novaPasta()
    const backend = new DesktopArmazemBackend(pasta)
    await backend.escrever("aaa", blob(1), { bytes: 4, classe: "mini", ultimoUso: 10 })
    await backend.tocar("aaa", 20)
    expect(existsSync(join(pasta, "media", "indice.json"))).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(indice(pasta)).toEqual({ v: 1, tecto: null, usos: { aaa: 20 }, minis: ["aaa"] })
    await backend.tocar("aaa", 30)
    backend.descarregar()
    expect(indice(pasta).usos).toEqual({ aaa: 30 })
  })

  it("o que ficou no disco abre noutra sessão, com o índice", async () => {
    const pasta = novaPasta()
    const antes = new DesktopArmazemBackend(pasta)
    await antes.escrever("aaa", blob(1), original(10))
    await antes.escrever("bbb", blob(2), { bytes: 4, classe: "mini", ultimoUso: 20 })
    await antes.tocar("aaa", 30)
    await antes.guardarTecto(250_000_000)
    antes.descarregar()
    const depois = new DesktopArmazemBackend(pasta)
    expect(await depois.lerTecto()).toBe(250_000_000)
    expect(ordenado(await depois.listar())).toEqual([
      { sha: "aaa", bytes: 4, ultimoUso: 30, classe: "original" },
      { sha: "bbb", bytes: 4, ultimoUso: 20, classe: "mini" },
    ])
  })

  it("sem índice, reconstrói-se do mtime; os blobs pequenos ficam miniaturas, que nunca saem", async () => {
    const pasta = novaPasta()
    const antes = new DesktopArmazemBackend(pasta)
    await antes.escrever("aaa", blob(1, 300_000), { bytes: 300_000, classe: "original", ultimoUso: 10 })
    await antes.escrever("bbb", blob(2, 1_000), { bytes: 1_000, classe: "mini", ultimoUso: 20 })
    antes.descarregar()
    rmSync(join(pasta, "media", "indice.json"))
    utimesSync(join(pasta, "media", "aaa.orwm"), 1_000, 1_000)
    utimesSync(join(pasta, "media", "bbb.orwm"), 2_000, 2_000)
    const depois = new DesktopArmazemBackend(pasta)
    expect(await depois.lerTecto()).toBeNull()
    expect(ordenado(await depois.listar())).toEqual([
      { sha: "aaa", bytes: 300_000, ultimoUso: 1_000_000, classe: "original" },
      { sha: "bbb", bytes: 1_000, ultimoUso: 2_000_000, classe: "mini" },
    ])
  })

  it("um índice estragado conta como índice em falta", async () => {
    const pasta = novaPasta()
    const antes = new DesktopArmazemBackend(pasta)
    await antes.escrever("aaa", blob(1), original(10))
    antes.descarregar()
    writeFileSync(join(pasta, "media", "indice.json"), "{ meio")
    const lista = await new DesktopArmazemBackend(pasta).listar()
    expect(lista.map((e) => e.sha)).toEqual(["aaa"])
  })

  it("os .tmp de uma escrita interrompida não aparecem na lista", async () => {
    const pasta = novaPasta()
    const backend = new DesktopArmazemBackend(pasta)
    await backend.escrever("aaa", blob(1), original(10))
    writeFileSync(join(pasta, "media", "bbb.orwm.tmp"), "meio")
    expect((await new DesktopArmazemBackend(pasta).listar()).map((e) => e.sha)).toEqual(["aaa"])
  })

  it("ENOSPC vira media store is full, e não fica ficheiro a meio", async () => {
    const pasta = novaPasta()
    const backend = new DesktopArmazemBackend(pasta)
    await backend.escrever("aaa", blob(1), original(10))
    disco.estado.codigo = "ENOSPC"
    await expect(backend.escrever("bbb", blob(2), original())).rejects.toThrow("media store is full")
    disco.estado.codigo = null
    expect(readdirSync(join(pasta, "media")).filter((f) => f !== "indice.json").sort()).toEqual(["aaa.orwm"])
    expect((await backend.listar()).map((e) => e.sha)).toEqual(["aaa"])
  })

  it("depois do selo, as escritas são recusadas", async () => {
    const backend = new DesktopArmazemBackend(novaPasta())
    await backend.escrever("aaa", blob(1), original(10))
    backend.selar()
    await expect(backend.escrever("bbb", blob(2), original())).rejects.toThrow()
    await expect(backend.apagar(["aaa"])).rejects.toThrow()
    expect(await backend.ler("aaa")).toEqual(blob(1))
  })

  it("destruir apaga media/ e não deixa um índice atrasado voltar", async () => {
    vi.useFakeTimers()
    const pasta = novaPasta()
    const backend = new DesktopArmazemBackend(pasta)
    await backend.escrever("aaa", blob(1), original(10))
    await backend.destruir()
    vi.advanceTimersByTime(20_000)
    expect(existsSync(join(pasta, "media"))).toBe(false)
    expect(await backend.listar()).toEqual([])
    expect(await backend.lerTecto()).toBeNull()
  })

  it("largarConta apaga também o media/ dessa conta", async () => {
    const raiz = novaPasta()
    const cofre = new DesktopVaultBackend(raiz)
    const { pastaDaConta } = await import("./vault-backend.js")
    const pasta = pastaDaConta(raiz, "b7")
    const backend = new DesktopArmazemBackend(pasta)
    await backend.escrever("aaa", blob(1), original(10))
    backend.descarregar()
    cofre.largarConta("b7")
    expect(existsSync(join(pasta, "media"))).toBe(false)
  })
})

describe("ArmazemDaContaActiva", () => {
  it("guarda na pasta da conta activa, e usarConta passa à outra (contas:mudar)", async () => {
    const raiz = novaPasta()
    const { pastaDaConta } = await import("./vault-backend.js")
    const armazem = new ArmazemDaContaActiva(raiz, "principal")
    await armazem.escrever("aaa", blob(1), original(10))
    expect(existsSync(join(raiz, "media", "aaa.orwm"))).toBe(true)

    armazem.usarConta("b7")
    expect(await armazem.ler("aaa"), "a outra conta não vê os media da primeira").toBeNull()
    await armazem.escrever("bbb", blob(2), original(20))
    expect(existsSync(join(pastaDaConta(raiz, "b7"), "media", "bbb.orwm"))).toBe(true)
    expect((await armazem.listar()).map((e) => e.sha)).toEqual(["bbb"])

    armazem.usarConta("principal")
    expect(await armazem.ler("aaa")).toEqual(blob(1))
  })

  it("mudar de conta e descarregar escrevem o índice já, sem esperar os 10 s", async () => {
    vi.useFakeTimers()
    const raiz = novaPasta()
    const { pastaDaConta } = await import("./vault-backend.js")
    const armazem = new ArmazemDaContaActiva(raiz, "principal")
    await armazem.escrever("aaa", blob(1), original(10))
    armazem.usarConta("b7")
    expect(indice(raiz).usos).toEqual({ aaa: 10 })

    await armazem.escrever("bbb", blob(2), original(20))
    armazem.descarregar()
    expect(indice(pastaDaConta(raiz, "b7")).usos).toEqual({ bbb: 20 })
  })

  it("destruir apaga só o media/ da conta activa", async () => {
    const raiz = novaPasta()
    const armazem = new ArmazemDaContaActiva(raiz, "principal")
    await armazem.escrever("aaa", blob(1), original(10))
    armazem.usarConta("b7")
    await armazem.escrever("bbb", blob(2), original(20))
    await armazem.destruir()
    expect(await armazem.listar()).toEqual([])
    expect(existsSync(join(raiz, "media", "aaa.orwm"))).toBe(true)
  })

  it("o selo passa à conta seguinte", async () => {
    const armazem = new ArmazemDaContaActiva(novaPasta(), "principal")
    armazem.selar()
    armazem.usarConta("b7")
    await expect(armazem.escrever("aaa", blob(1), original())).rejects.toThrow("media store failed")
  })
})

describe("mudar de conta com uma escrita do armazém na fila", () => {
  /** A media item for the real `ArmazemDeMedia`: key and nonce in base64, sha in base64url (a file name). */
  function media(): { bytes: Uint8Array; ref: RefDeMedia; sha: string } {
    const aleatorio = (n: number): Buffer => randomBytes(n)
    return {
      bytes: Uint8Array.from(aleatorio(1_000)),
      ref: { v: 1, k: aleatorio(32).toString("base64"), n: aleatorio(24).toString("base64"), b: 1_000, t: "image/png", f: "bytes", p: "data:image/png;base64,", c: "original", at: 1 },
      sha: aleatorio(32).toString("base64url"),
    }
  }

  it("trancada e trocada sem drenar, a escrita nunca aparece na pasta da conta seguinte", async () => {
    const raiz = novaPasta()
    const { pastaDaConta } = await import("./vault-backend.js")
    const backend = new ArmazemDaContaActiva(raiz, "principal")
    const armazem = new ArmazemDeMedia(backend, null)
    await armazem.abrir()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    // What `aplicarMudancaDeConta` does, without the wait: lock and switch folder.
    armazem.trancar()
    backend.usarConta("b7")
    await armazem.drenar()
    expect(existsSync(join(pastaDaConta(raiz, "b7"), "media", `${m.sha}.orwm`))).toBe(false)
    expect(existsSync(join(raiz, "media", `${m.sha}.orwm`))).toBe(false)
  })

  it("drenada antes de trancar, a escrita fica na pasta da conta de onde partiu", async () => {
    const raiz = novaPasta()
    const { pastaDaConta } = await import("./vault-backend.js")
    const backend = new ArmazemDaContaActiva(raiz, "principal")
    const armazem = new ArmazemDeMedia(backend, null)
    await armazem.abrir()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    armazem.trancar()
    backend.usarConta("b7")
    expect(existsSync(join(raiz, "media", `${m.sha}.orwm`))).toBe(true)
    expect(existsSync(join(pastaDaConta(raiz, "b7"), "media", `${m.sha}.orwm`))).toBe(false)
  })
})
