import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { abrirFonteDoFicheiro, formaDoFicheiroNoDisco, gravarPorPartes } from "./ficheiro-de-conta.js"

/**
 * The account file with the images on the desktop (Task 11b): it can be
 * hundreds of MB, so it is written in parts and read by offset, never whole
 * in memory.
 */

const pastas: string[] = []
const pasta = (): string => {
  const p = mkdtempSync(join(tmpdir(), "orwell-conta-"))
  pastas.push(p)
  return p
}
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

async function* partes(lista: Uint8Array[], falharNo?: number) {
  for (const [i, parte] of lista.entries()) {
    if (i === falharNo) throw new Error("media store failed")
    yield parte
  }
}

describe("gravar o ficheiro de conta por partes", () => {
  it("junta as partes pela ordem, no caminho escolhido", async () => {
    const caminho = join(pasta(), "conta.enclave")
    await gravarPorPartes(caminho, partes([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])]))
    expect([...readFileSync(caminho)]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it("uma parte que falha não deixa ficheiro nenhum, nem estraga o que lá estava", async () => {
    const caminho = join(pasta(), "conta.enclave")
    writeFileSync(caminho, "antigo")
    await expect(gravarPorPartes(caminho, partes([new Uint8Array([1]), new Uint8Array([2])], 1))).rejects.toThrow("media store failed")
    expect(readFileSync(caminho, "utf8")).toBe("antigo")
    expect(existsSync(`${caminho}.parcial`)).toBe(false)
  })
})

describe("ler o ficheiro de conta por posições", () => {
  it("dá o tamanho e as fatias pedidas", async () => {
    const caminho = join(pasta(), "conta.enclave")
    writeFileSync(caminho, Uint8Array.from([10, 11, 12, 13, 14]))
    const { fonte, fechar } = await abrirFonteDoFicheiro(caminho)
    try {
      expect(fonte.tamanho).toBe(5)
      expect([...(await fonte.ler(1, 4))]).toEqual([11, 12, 13])
      expect([...(await fonte.ler(3, 99))]).toEqual([13, 14])
    } finally {
      await fechar()
    }
  })
})

describe("só um ficheiro normal se abre (correcção, ronda 1)", () => {
  it("uma pasta, ou um caminho que não existe, nunca se abre: a mesma frase de sempre", async () => {
    const p = pasta()
    await expect(abrirFonteDoFicheiro(p)).rejects.toThrow("this is not an enclave account file")
    await expect(abrirFonteDoFicheiro(join(p, "nao-existe"))).rejects.toThrow("this is not an enclave account file")
  })

  it("a forma do ficheiro escolhido lê-se no disco, e uma pasta é 'outro'", async () => {
    const p = pasta()
    const caminho = join(p, "foto.png")
    writeFileSync(caminho, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))
    expect(await formaDoFicheiroNoDisco(caminho)).toBe("outro")
    expect(await formaDoFicheiroNoDisco(p)).toBe("outro")
    const conta = join(p, "conta.enclave")
    writeFileSync(conta, "orwv2\n" + JSON.stringify({ format: "enclave-vault", formatVersion: 1, exportedAt: 0, vault: { protection: "passphrase", salt: "a", nonce: "b", ciphertext: "c" } }))
    expect(await formaDoFicheiroNoDisco(conta)).toBe("conta")
  })
})
