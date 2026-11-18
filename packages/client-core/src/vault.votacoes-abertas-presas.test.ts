import { describe, expect, it } from "vitest"
import { lerVoto, VOTACOES_ABERTAS_PRESAS_MAX } from "./votos.js"
import { appendHistory, entradasDoCanal, newVaultContents, TECTOS_DO_ESTADO, type StoredChatMessage } from "./vault.js"

/**
 * An open poll stays in the vault like a pinned message (diag-votacao, 18/11/2026).
 *
 * - The conversation cap (`HISTORY_MAX_PER_CHANNEL`) does not move it to the archive
 *   (`porArquivar`) while it is open: it takes the next oldest message instead.
 * - The vote bucket does not drop its counted votes for age.
 * - Closed (deadline or `closePoll`) or deleted, it follows the normal rules again.
 * - At most `VOTACOES_ABERTAS_PRESAS_MAX` open polls are held, the newest.
 */

const SALA = "!sala:s"
const BRUNO = "@bruno:s"
const ANA = "@ana:s"

const entrada = (seq: number, sender: string, payload: StoredChatMessage["payload"]): StoredChatMessage => ({ seq, sender, at: seq, payload })
const poll = (closesAt?: number) => ({ question: "?", options: ["a", "b"], ...(closesAt === undefined ? {} : { closesAt }) })
const noCofre = (c: ReturnType<typeof newVaultContents>, id: string): boolean => (c.history[SALA] ?? []).some((e) => e.payload["id"] === id)
const arquivada = (c: ReturnType<typeof newVaultContents>, id: string): boolean => (c.porArquivar?.[SALA] ?? []).some((e) => e.payload["id"] === id)

function conversa(c: ReturnType<typeof newVaultContents>, desde: number, quantas: number): number {
  let seq = desde
  for (let i = 0; i < quantas; i++) appendHistory(c, SALA, entrada(seq++, ANA, { t: "message", id: `m${seq}`, body: "olá", sentAt: seq }))
  return seq
}

describe("uma votação aberta fica no cofre", () => {
  it("com 1 000 mensagens depois, não vai para o arquivo; as mensagens à volta vão", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(1, BRUNO, { t: "message", id: "aberta", body: "?", sentAt: 1, poll: poll() }))
    conversa(c, 2, 1_000)
    expect(noCofre(c, "aberta")).toBe(true)
    expect(arquivada(c, "aberta")).toBe(false)
    expect(arquivada(c, "m3")).toBe(true)
  })

  it("com prazo passado, segue as regras normais e vai para o arquivo", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(1, BRUNO, { t: "message", id: "fechada", body: "?", sentAt: 1, poll: poll(Date.now() - 1) }))
    conversa(c, 2, 1_000)
    expect(arquivada(c, "fechada")).toBe(true)
  })

  it("fechada à mão pelo autor, ou eliminada, volta às regras normais", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(1, BRUNO, { t: "message", id: "a-fechar", body: "?", sentAt: 1, poll: poll() }))
    appendHistory(c, SALA, entrada(2, BRUNO, { t: "message", id: "a-apagar", body: "?", sentAt: 2, poll: poll() }))
    let seq = conversa(c, 3, 500)
    expect(noCofre(c, "a-fechar")).toBe(true)
    expect(noCofre(c, "a-apagar")).toBe(true)
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "edit", id: "e1", target: "a-fechar", body: "?", editedAt: seq, closePoll: true }))
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "redact", id: "r1", target: "a-apagar" }))
    conversa(c, seq, 10)
    expect(arquivada(c, "a-fechar")).toBe(true)
    expect(arquivada(c, "a-apagar")).toBe(true)
  })

  it("só as 50 abertas mais recentes ficam presas", () => {
    const c = newVaultContents()
    let seq = 1
    for (let i = 0; i < VOTACOES_ABERTAS_PRESAS_MAX + 5; i++) {
      appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: `v${i}`, body: "?", sentAt: seq, poll: poll() }))
    }
    conversa(c, seq, 1_000)
    expect(arquivada(c, "v0")).toBe(true)
    expect(arquivada(c, "v4")).toBe(true)
    expect(noCofre(c, "v5")).toBe(true)
    expect(noCofre(c, `v${VOTACOES_ABERTAS_PRESAS_MAX + 4}`)).toBe(true)
  })

  it("os votos contados de uma votação aberta não saem do balde por idade", () => {
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "aberta", body: "?", sentAt: 1, poll: poll() }))
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "outra", body: "?", sentAt: 2, poll: poll(Date.now() - 1) }))
    const naAberta = 300
    // The open poll's votes are the OLDEST: by age alone, they would leave first.
    for (let i = 0; i < naAberta; i++) {
      appendHistory(c, SALA, entrada(seq++, `@a${i}:s`, { t: "post.reaction", id: `a${i}`, target: "aberta", emoji: "", at: 1, remove: false, vote: 0 }))
    }
    for (let i = 0; i < TECTOS_DO_ESTADO.voto; i++) {
      appendHistory(c, SALA, entrada(seq++, `@o${i}:s`, { t: "post.reaction", id: `o${i}`, target: "outra", emoji: "", at: 1, remove: false, vote: 1 }))
    }
    const votos = (alvo: string): number => entradasDoCanal(c, SALA).filter((e) => lerVoto(e)?.alvo === alvo).length
    expect(votos("aberta")).toBe(naAberta)
    expect(votos("outra")).toBeLessThan(TECTOS_DO_ESTADO.voto)
  })
})
