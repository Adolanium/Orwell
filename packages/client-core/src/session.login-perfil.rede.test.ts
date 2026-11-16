import type { Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The profile at login (hotfix 1.3.14).
 *
 * Measured in production on 13/11/2026: the owner (founder and admin, 72
 * channels, a 20 MB vault) logs in and the Windows app freezes 3 to 4 s. In
 * that minute the server got 277 frames in 72 channels, about one profile per
 * channel. A profile that did not change goes nowhere: only a changed profile,
 * a channel that does not have it yet, or a request (`pp`) sends it.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

/** Profile sends from this account, per channel, from now on. */
function contarPerfis(conta: ContaDeTeste): Map<string, number> {
  const contagem = new Map<string, number>()
  const original = conta.session.send.bind(conta.session)
  conta.session.send = async (channel: string, payload: Payload, opcoes?: { daPessoa?: boolean }): Promise<void> => {
    if (payload.t === "profile") contagem.set(channel, (contagem.get(channel) ?? 0) + 1)
    return original(channel, payload, opcoes)
  }
  return contagem
}

const total = (contagem: Map<string, number>, canais?: readonly string[]): number =>
  [...contagem].filter(([canal]) => !canais || canais.includes(canal)).reduce((soma, [, n]) => soma + n, 0)

async function religar(conta: ContaDeTeste): Promise<void> {
  conta.session.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
  await conta.session.connect()
  await ate(() => conta.session.channels.every((canal) => !conta.session.aRecuperar(canal)), `${conta.nome} recupera`, 30_000)
  await new Promise((resolve) => setTimeout(resolve, 1_500))
}

describe("o perfil no login", () => {
  it("religar 3 vezes com o perfil sem mudanças dá 0 perfis; mudar o perfil dá 1 por canal", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canais: string[] = []
    for (let c = 0; c < 4; c++) canais.push(await canalComTodos(servidor, ana!, [bruno!]))
    // The first reconnection is the repair round of a new vault: once per device.
    await religar(ana!)
    expect(ana!.vault.contents.profileRepairRound ?? 0).toBeGreaterThan(0)

    const perfis = contarPerfis(ana!)
    for (let r = 0; r < 3; r++) await religar(ana!)
    console.log(`perfis em 3 religações sem mudanças: ${total(perfis)} (${ana!.session.channels.length} canais)`)
    expect(total(perfis)).toBe(0)

    await ana!.session.updateProfile({ displayName: "Ana Maria", donations: [] })
    await ate(() => canais.every((canal) => (perfis.get(canal) ?? 0) >= 1), "o perfil novo sai em cada canal")
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    for (const canal of canais) expect(perfis.get(canal)).toBe(1)
    await ate(() => bruno!.vault.contents.directory[ana!.address]?.payload["displayName"] === "Ana Maria", "o Bruno vê o nome novo")
  }, 120_000)

  it("um canal onde o perfil não sai não faz a ronda de reparação repetir-se nos outros a cada ligação", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canais: string[] = []
    for (let c = 0; c < 4; c++) canais.push(await canalComTodos(servidor, ana!, [bruno!]))
    const [surdo, ...bons] = canais as [string, ...string[]]

    // A channel where the send keeps failing (offline group, rate refusal, vault full):
    // the round stays pending, and before 1.3.14 it forced the profile into every channel on every connection.
    const perfis = contarPerfis(ana!)
    const enviar = ana!.session.send.bind(ana!.session)
    ana!.session.send = async (channel: string, payload: Payload, opcoes?: { daPessoa?: boolean }): Promise<void> => {
      if (channel === surdo && payload.t === "profile") throw new Error("socket not open")
      return enviar(channel, payload, opcoes)
    }
    await religar(ana!)
    const naRonda = total(perfis, bons)
    expect(naRonda).toBe(bons.length)
    expect(ana!.avisos).toContain("profile-repair-pending")

    for (let r = 0; r < 3; r++) await religar(ana!)
    console.log(`perfis nos canais bons em 3 religações com um canal surdo: ${total(perfis, bons) - naRonda}`)
    expect(total(perfis, bons) - naRonda).toBe(0)

    // The channel that failed still gets it, once it can.
    ana!.session.send = enviar
    await religar(ana!)
    expect(total(perfis, bons) - naRonda).toBe(0)
    expect(perfis.get(surdo)).toBe(1)
    expect(ana!.vault.contents.profileRepairRound ?? 0).toBeGreaterThan(0)
    expect(ana!.vault.contents.profileRepairChannels).toBeUndefined()
  }, 120_000)
})
