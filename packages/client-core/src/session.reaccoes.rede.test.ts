import { existsSync, readFileSync } from "node:fs"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
// The harness server, for real, on an ephemeral port.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  divergencias,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// From `dist`, like the harness sessions.
import { dobrarReaccoes, entradasDoCanal, Session, Vault, type FichaDeReaccao } from "@enclave/client-core"

/**
 * Reactions to chat messages, between real clients (12/11/2026).
 *
 * Ana reacts to Bruno's message, in a channel and in a direct. Bruno sees the
 * chip, Ana's second device sees it as hers, removing it propagates, and all of
 * it survives reopening the vault. The server sees only ciphertext.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

/**
 * The chips this account sees. Who reacted goes sorted: the order of names before
 * the echo of our own send is a display detail, and not what is measured here.
 */
const fichasDe = (conta: ContaDeTeste, canal: string, alvo: string): FichaDeReaccao[] =>
  (dobrarReaccoes(entradasDoCanal(conta.vault.contents, canal), conta.address).get(alvo) ?? []).map((ficha) => ({
    ...ficha,
    quem: [...ficha.quem].sort(),
  }))

function bytesDoServidor(): string {
  return [servidor.baseDeDados, `${servidor.baseDeDados}-wal`]
    .filter((caminho) => existsSync(caminho))
    .map((caminho) => readFileSync(caminho).toString("latin1"))
    .join("")
}

async function mensagemDoBruno(bruno: ContaDeTeste, ana: ContaDeTeste, canal: string, id: string): Promise<void> {
  await bruno.session.send(canal, mensagemAEnviar("Quem vem amanhã?", undefined, undefined, { id, sentAt: Date.now() }))
  await ate(
    () => entradasDoCanal(ana.vault.contents, canal).some((e) => (e.payload as { id?: string }).id === id),
    "a Ana recebe a mensagem do Bruno",
    30_000,
  )
}

describe("reacções às mensagens, entre clientes reais", () => {
  it("num canal: chega, conta como minha no outro aparelho, retirar propaga, e sobrevive a reabrir o cofre", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel da Ana entra no canal", 30_000)

    const ALVO = "pergunta-do-bruno-0001"
    await mensagemDoBruno(bruno!, ana!, canal, ALVO)

    await ana!.session.reactToMessage(canal, ALVO, "👍")
    await bruno!.session.reactToMessage(canal, ALVO, "👍")
    await bruno!.session.reactToMessage(canal, ALVO, "🎉")

    const esperado = (souBruno: boolean): FichaDeReaccao[] => [
      { emoji: "👍", quem: [ana!.address, bruno!.address].sort(), minha: true },
      { emoji: "🎉", quem: [bruno!.address], minha: souBruno },
    ]
    await ate(() => fichasDe(bruno!, canal, ALVO).length === 2 && fichasDe(bruno!, canal, ALVO)[0]!.quem.length === 2, "o Bruno vê as duas fichas", 30_000)
    await ate(() => fichasDe(ana!, canal, ALVO)[1]?.emoji === "🎉", "a Ana vê a ficha do Bruno", 30_000)
    await ate(() => fichasDe(telemovel, canal, ALVO)[0]?.quem.length === 2, "o telemóvel da Ana vê as fichas", 30_000)
    expect(fichasDe(ana!, canal, ALVO)).toEqual(esperado(false))
    expect(fichasDe(bruno!, canal, ALVO)).toEqual(esperado(true))
    // The second device of the same account counts the reaction as mine.
    expect(fichasDe(telemovel, canal, ALVO)).toEqual(esperado(false))

    // Ana takes hers back from the phone: it leaves everywhere.
    await telemovel.session.reactToMessage(canal, ALVO, "👍", true)
    const semAAna = [
      { emoji: "👍", quem: [bruno!.address] },
      { emoji: "🎉", quem: [bruno!.address] },
    ]
    for (const conta of [ana!, bruno!, telemovel]) {
      await ate(() => fichasDe(conta, canal, ALVO)[0]?.quem.length === 1, `${conta.nome} vê a reacção retirada`, 30_000)
      expect(fichasDe(conta, canal, ALVO).map(({ emoji, quem }) => ({ emoji, quem }))).toEqual(semAAna)
    }
    expect(fichasDe(ana!, canal, ALVO).some((ficha) => ficha.minha)).toBe(false)

    // The sync summaries agree: reactions do not open a false divergence.
    await ate(() => divergencias([ana!, bruno!], canal).length === 0, "os resumos batem certo", 30_000)

    // Reopen Bruno's vault from the bytes on disk: the chips are still there.
    await bruno!.session.flush()
    const reaberto = new Vault(bruno!.backend)
    await reaberto.unlock("frase-passe-de-teste")
    expect(
      dobrarReaccoes(entradasDoCanal(reaberto.contents, canal), bruno!.address)
        .get(ALVO)
        ?.map(({ emoji, quem }) => ({ emoji, quem })),
    ).toEqual(semAAna)

    // The server holds ciphertext: neither the target nor the emoji in plain.
    const bytes = bytesDoServidor()
    expect(bytes).toContain(canal)
    expect(bytes).not.toContain(ALVO)
    expect(bytes).not.toContain("🎉")
  }, 180_000)

  it("a retirada que outro aparelho da conta fez sobrevive a recarregar o telemóvel logo a seguir", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel da Ana entra no canal", 30_000)

    const ALVO = "pergunta-do-bruno-0002"
    await mensagemDoBruno(bruno!, ana!, canal, ALVO)
    await ate(() => entradasDoCanal(telemovel.vault.contents, canal).some((e) => (e.payload as { id?: string }).id === ALVO), "o telemóvel recebe a pergunta", 30_000)

    await ana!.session.reactToMessage(canal, ALVO, "👍")
    await bruno!.session.reactToMessage(canal, ALVO, "👍")
    await ate(() => fichasDe(telemovel, canal, ALVO)[0]?.quem.length === 2, "o telemóvel vê os dois 👍", 30_000)
    await telemovel.session.reactToMessage(canal, ALVO, "🎉")
    await ate(() => fichasDe(ana!, canal, ALVO).length === 2, "o computador vê a 🎉 do telemóvel", 30_000)

    // Ana takes hers back on the computer; the phone sees it live. The phone's
    // deferred write does not reach the disk before the reload.
    const janela = Vault.JANELA_DA_GRAVACAO_MS
    Vault.JANELA_DA_GRAVACAO_MS = 60_000
    const discoAntes = telemovel.backend.escritas
    await ana!.session.reactToMessage(canal, ALVO, "👍", true)
    await ate(() => fichasDe(telemovel, canal, ALVO)[0]?.quem.length === 1, "o telemóvel vê a retirada", 30_000)
    const esperado = [
      { emoji: "👍", quem: [bruno!.address], minha: false },
      { emoji: "🎉", quem: [ana!.address], minha: true },
    ]
    expect(fichasDe(telemovel, canal, ALVO)).toEqual(esperado)

    // The page reloads right away: what the disk holds now, no flush.
    expect(telemovel.backend.escritas - discoAntes).toBe(0)
    const bytes = telemovel.backend.bytes
    telemovel.session.disconnect()
    telemovel.backend.bytes = bytes
    Vault.JANELA_DA_GRAVACAO_MS = janela
    const reaberto = new Vault(telemovel.backend)
    await reaberto.unlock("frase-do-telemovel")
    const sessao = new Session(reaberto)
    sessao.loadIdentity()
    const depois: ContaDeTeste = { ...telemovel, session: sessao, vault: reaberto }
    abertas.push(depois)
    await sessao.connect()
    // Recovery brings the removal again: the anchor on disk is from before it.
    await ate(() => JSON.stringify(fichasDe(depois, canal, ALVO)) === JSON.stringify(esperado), "o telemóvel recarregado tem as mesmas fichas", 30_000)
  }, 180_000)

  it("numa conversa directa também", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const dm = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno entra na directa", 30_000)
    const ALVO = "pergunta-na-directa-01"
    await mensagemDoBruno(bruno!, ana!, dm, ALVO)
    await ana!.session.reactToMessage(dm, ALVO, "❤️")
    await ate(() => fichasDe(bruno!, dm, ALVO).length === 1, "o Bruno vê o coração", 30_000)
    expect(fichasDe(bruno!, dm, ALVO)).toEqual([{ emoji: "❤️", quem: [ana!.address], minha: false }])
    await ana!.session.reactToMessage(dm, ALVO, "❤️", true)
    await ate(() => fichasDe(bruno!, dm, ALVO).length === 0, "o coração sai do ecrã do Bruno", 30_000)
  }, 120_000)

  it("recusa um emoji vazio ou comprido demais antes de cifrar", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    const canal = await canalComTodos(servidor, ana!, [])
    await expect(ana!.session.reactToMessage(canal, "x", "")).rejects.toThrow("reaction emoji")
    await expect(ana!.session.reactToMessage(canal, "x", "🎉".repeat(20))).rejects.toThrow("reaction emoji")
  }, 60_000)
})
