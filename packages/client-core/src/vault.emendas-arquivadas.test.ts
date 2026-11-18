import { describe, expect, it } from "vitest"
import {
  apagadoNoArquivo,
  appendHistory,
  edicaoNoArquivo,
  HISTORY_MAX_PER_CHANNEL,
  newVaultContents,
  TECTOS_DO_ESTADO,
  type StoredChatMessage,
} from "./vault.js"

/**
 * Amendments of archived messages (review of 1.3.18, I3).
 *
 * The ledger keeps 2 000 amendments per channel; the archive keeps 20 000
 * messages. Past the ledger cap, the edit and then the tombstone of a message
 * that already left the vault were thrown away, and "Load older" showed the
 * first text of an edited message, or a deleted one. What the ledger lets go
 * now stays, compactly, for the archive.
 */

const SALA = "!sala:s"
const ANA = "@ana:s"
const YURI = "@yuri:s"
const MODERADORA = "@mod:s"

const entrada = (seq: number, sender: string, payload: StoredChatMessage["payload"]): StoredChatMessage => ({ seq, sender, at: seq, payload })
const mensagem = (seq: number): StoredChatMessage => entrada(seq, ANA, { t: "message", id: `m${seq}`, body: `mensagem ${seq}`, sentAt: seq })

describe("as emendas das mensagens arquivadas", () => {
  it("com mais de 2 000 emendas, a lápide e a edição de uma mensagem arquivada ficam guardadas para o arquivo", () => {
    const c = newVaultContents()
    let seq = 0
    for (let i = 0; i < HISTORY_MAX_PER_CHANNEL + 50; i++) appendHistory(c, SALA, mensagem(seq++))
    // m0 and m1 have left the vault for the archive.
    expect(c.history[SALA]?.some((e) => e.payload["id"] === "m0")).toBe(false)
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "redact", id: "r0", target: "m0", redactedAt: seq }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "edit", id: "e1", target: "m1", body: "texto novo", editedAt: seq }))
    // Enough later tombstones (of messages no longer anywhere) to push both out of the ledger:
    // edits leave first, then the oldest tombstones.
    for (let i = 0; i < TECTOS_DO_ESTADO.emenda + 10; i++) {
      appendHistory(c, SALA, entrada(seq++, ANA, { t: "redact", id: `r-outra-${i}`, target: `fora-${i}`, redactedAt: seq }))
    }
    const livro = c.estadoDoCanal[SALA] ?? []
    expect(livro.some((e) => e.payload["id"] === "r0")).toBe(false)
    expect(livro.some((e) => e.payload["id"] === "e1")).toBe(false)

    const emendas = c.emendasArquivadas?.[SALA]
    const podeModerar = (): boolean => false
    expect(apagadoNoArquivo(emendas, mensagem(0), podeModerar)).toBe(true)
    expect(edicaoNoArquivo(emendas, mensagem(1))?.payload["body"]).toBe("texto novo")
  })

  /** Pushes the ledger past its cap with tombstones of messages that are nowhere. */
  function empurrar(c: ReturnType<typeof newVaultContents>, seq: number): number {
    for (let i = 0; i < TECTOS_DO_ESTADO.emenda + 10; i++) {
      appendHistory(c, SALA, entrada(seq++, ANA, { t: "redact", id: `r-outra-${seq}`, target: `fora-${seq}`, redactedAt: seq }))
    }
    return seq
  }

  it("uma lápide de quem não pode apagar, guardada primeiro, não tapa a do moderador (I4 da revisão da 1.3.20)", () => {
    const c = newVaultContents()
    let seq = 0
    for (let i = 0; i < HISTORY_MAX_PER_CHANNEL + 50; i++) appendHistory(c, SALA, mensagem(seq++))
    appendHistory(c, SALA, entrada(seq++, YURI, { t: "redact", id: "ry", target: "m0", redactedAt: seq }))
    seq = empurrar(c, seq)
    appendHistory(c, SALA, entrada(seq++, MODERADORA, { t: "redact", id: "rm", target: "m0", redactedAt: seq }))
    empurrar(c, seq)
    const emendas = c.emendasArquivadas?.[SALA]
    const podeModerar = (quem: string): boolean => quem === MODERADORA
    expect(apagadoNoArquivo(emendas, mensagem(0), podeModerar)).toBe(true)
    // Yuri's alone deletes nothing.
    expect(apagadoNoArquivo(emendas, mensagem(0), () => false)).toBe(false)
  })

  it("uma edição de outro membro, guardada depois, não tapa a do autor", () => {
    const c = newVaultContents()
    let seq = 0
    for (let i = 0; i < HISTORY_MAX_PER_CHANNEL + 50; i++) appendHistory(c, SALA, mensagem(seq++))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "edit", id: "ea", target: "m1", body: "sem o dado", editedAt: seq }))
    appendHistory(c, SALA, entrada(seq++, YURI, { t: "edit", id: "ey", target: "m1", body: "outro texto", editedAt: seq }))
    empurrar(c, seq)
    expect(edicaoNoArquivo(c.emendasArquivadas?.[SALA], mensagem(1))?.payload["body"]).toBe("sem o dado")
  })

  it("um cofre de antes (um remetente por id, edição pela id) continua a ler-se", () => {
    const emendas = {
      apagadas: { m0: ANA, m2: YURI } as Record<string, string | string[]>,
      edicoes: {
        m1: entrada(9, ANA, { t: "edit", id: "e1", target: "m1", body: "texto novo", editedAt: 9 }),
        m3: entrada(10, YURI, { t: "edit", id: "e3", target: "m3", body: "de outro", editedAt: 10 }),
      },
    }
    expect(apagadoNoArquivo(emendas, mensagem(0), () => false)).toBe(true)
    expect(apagadoNoArquivo(emendas, mensagem(2), () => false)).toBe(false)
    expect(edicaoNoArquivo(emendas, mensagem(1))?.payload["body"]).toBe("texto novo")
    expect(edicaoNoArquivo(emendas, mensagem(3))).toBeUndefined()
  })
})
