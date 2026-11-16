import { randomBytes } from "node:crypto"
import { toBase64 } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { CABECALHO_DO_COFRE, comCabecalho } from "../cabecalhoDoCofre.js"
import {
  MARCA_DO_CONTENTOR,
  cabecaDoContentor,
  cabecaDoRegisto,
  eContentor,
  fonteDeBlob,
  fonteDeBytes,
  formaDoFicheiroDeConta,
  lerContentor,
} from "./contentor.js"

/**
 * The account file container with the images (Task 11b, design §9 B):
 *
 *     "orwv2\n" ‖ "orwc1\n" ‖ len(JSON) 8 B BE ‖ JSON (with mediaCount: N)
 *     ‖ N × ( sha 32 B ‖ len 8 B BE ‖ blob orwm1 )
 *
 * Reading validates the WHOLE container before returning a single record: a
 * file cut halfway never lets anything be written.
 */

const sha = (): string => toBase64(Uint8Array.from(randomBytes(32)))
const blob = (n: number): Uint8Array => {
  const b = Uint8Array.from(randomBytes(n))
  b.set(new TextEncoder().encode("orwm1\n"), 0)
  return b
}

function juntar(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, p) => soma + p.length, 0)
  const saida = new Uint8Array(total)
  let pos = 0
  for (const p of partes) {
    saida.set(p, pos)
    pos += p.length
  }
  return saida
}

function contentor(registos: { sha: string; blob: Uint8Array }[], extra: Record<string, unknown> = {}): Uint8Array {
  const json = JSON.stringify({ format: "enclave-vault", formatVersion: 1, vault: {}, mediaCount: registos.length, ...extra })
  return juntar([cabecaDoContentor(json), ...registos.flatMap((r) => [cabecaDoRegisto(r.sha, r.blob.length), r.blob])])
}

describe("o contentor do ficheiro de conta com as imagens", () => {
  it("começa pelo cabeçalho do cofre e pela marca, e distingue-se do ficheiro simples", () => {
    const bytes = contentor([])
    expect(new TextDecoder().decode(bytes.subarray(0, 12))).toBe(CABECALHO_DO_COFRE + MARCA_DO_CONTENTOR)
    expect(eContentor(bytes.subarray(0, 12))).toBe(true)
    expect(eContentor(comCabecalho('{"format":"enclave-vault"}').subarray(0, 12))).toBe(false)
    expect(eContentor(new TextEncoder().encode("orwv2\n"))).toBe(false)
  })

  it("lê o JSON e os registos, com a posição de cada blob", async () => {
    const registos = [
      { sha: sha(), blob: blob(100) },
      { sha: sha(), blob: blob(3_000) },
    ]
    const bytes = contentor(registos)
    const lido = await lerContentor(fonteDeBytes(bytes))
    expect(JSON.parse(lido.json).mediaCount).toBe(2)
    expect(lido.registos.map((r) => r.sha)).toEqual(registos.map((r) => r.sha))
    for (const [i, r] of lido.registos.entries()) {
      expect(bytes.subarray(r.inicio, r.inicio + r.bytes)).toEqual(registos[i]?.blob)
    }
  })

  it("lê de um Blob por fatias, como a web", async () => {
    const registos = [{ sha: sha(), blob: blob(500) }]
    const bytes = contentor(registos)
    const fonte = fonteDeBlob(new Blob([bytes]))
    expect(fonte.tamanho).toBe(bytes.length)
    const lido = await lerContentor(fonte)
    const r = lido.registos[0]!
    expect(await fonte.ler(r.inicio, r.inicio + r.bytes)).toEqual(registos[0]?.blob)
  })

  it("um contentor cortado a meio de um blob não é um ficheiro de conta", async () => {
    const bytes = contentor([
      { sha: sha(), blob: blob(100) },
      { sha: sha(), blob: blob(1_000) },
    ])
    await expect(lerContentor(fonteDeBytes(bytes.subarray(0, bytes.length - 10)))).rejects.toThrow("this is not an enclave account file")
  })

  it("um len absurdo, bytes a mais no fim, ou um mediaCount que não confere são recusados", async () => {
    const registo = { sha: sha(), blob: blob(100) }
    const bom = contentor([registo])
    // The record len at 2^60.
    const absurdo = bom.slice()
    const inicioDoRegisto = bom.length - 100 - 40
    absurdo.set([0x10, 0, 0, 0, 0, 0, 0, 0], inicioDoRegisto + 32)
    await expect(lerContentor(fonteDeBytes(absurdo))).rejects.toThrow("this is not an enclave account file")
    // Garbage after the last record.
    await expect(lerContentor(fonteDeBytes(juntar([bom, new Uint8Array([1])])))).rejects.toThrow("this is not an enclave account file")
    // Says two and brings one.
    const mentiroso = juntar([cabecaDoContentor(JSON.stringify({ mediaCount: 2 })), cabecaDoRegisto(registo.sha, 100), registo.blob])
    await expect(lerContentor(fonteDeBytes(mentiroso))).rejects.toThrow("this is not an enclave account file")
    // The JSON length larger than the file.
    const semJson = bom.slice(0, 20)
    await expect(lerContentor(fonteDeBytes(semJson))).rejects.toThrow("this is not an enclave account file")
    // A mediaCount that is not a number.
    await expect(lerContentor(fonteDeBytes(contentor([], { mediaCount: "muitos" })))).rejects.toThrow("this is not an enclave account file")
  })

  it("um sha que não tem 32 bytes não entra no contentor", () => {
    expect(() => cabecaDoRegisto("curto", 10)).toThrow(RangeError)
  })
})

describe("a forma de um ficheiro escolhido, antes da frase", () => {
  const envelope = { format: "enclave-vault", formatVersion: 1, exportedAt: 0, vault: { version: 3, protection: "passphrase", salt: "c2Fs", nonce: "bm9u", ciphertext: "Y2lm" } }
  const simples = comCabecalho(JSON.stringify(envelope))

  it("o simples, o contentor, o do beta e o resto", async () => {
    expect(await formaDoFicheiroDeConta(fonteDeBytes(simples))).toBe("conta")
    expect(await formaDoFicheiroDeConta(fonteDeBytes(contentor([], envelope)))).toBe("conta")
    expect(await formaDoFicheiroDeConta(fonteDeBytes(new TextEncoder().encode(JSON.stringify(envelope))))).toBe("beta")
    expect(await formaDoFicheiroDeConta(fonteDeBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])))).toBe("outro")
    const cortado = contentor([{ sha: sha(), blob: blob(100) }], envelope)
    expect(await formaDoFicheiroDeConta(fonteDeBytes(cortado.subarray(0, cortado.length - 1)))).toBe("outro")
  })

  it("uma leitura que falha é 'outro', nunca um erro", async () => {
    expect(await formaDoFicheiroDeConta({ tamanho: 100, ler: () => Promise.reject(new Error("EIO")) })).toBe("outro")
  })
})
