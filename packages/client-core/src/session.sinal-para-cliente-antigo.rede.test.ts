import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { Payload } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  type ContaDeTeste,
  type ServidorDeTeste,
  levantarServidor,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { entradasDoCanal } from "@enclave/client-core"

/**
 * Old clients against the server that delivers by `para` (21/11/2026).
 *
 *   ORWELL_CORE_ANTIGO=<worktree of a released version> npx vitest run --root packages/client-core src/session.sinal-para-cliente-antigo.rede.test.ts
 *
 * The released core comes from that worktree's `packages/client-core/dist`
 * (built there). Without the variable, the test skips.
 *
 * What it proves, on one server of this branch: two OLD accounts and two NEW
 * ones in one channel. The old ones never send `para`, so their signals still
 * go to everyone ("is typing" from an old account reaches old and new). The
 * new ones send "is typing" without `para` too. And D2 (only the new ones)
 * still brings the past to a late new account with old members in the
 * channel, while the old ones stay untouched by it.
 */
const RAIZ_ANTIGA = process.env.ORWELL_CORE_ANTIGO
const descrever = RAIZ_ANTIGA ? describe : describe.skip

type Antiga = { nome: string; session: any; address: string }

let servidor: ServidorDeTeste
const novas: ContaDeTeste[] = []
const antigas: Antiga[] = []

beforeAll(async () => {
  servidor = await levantarServidor({ sinal: { porMinutoPorLigacao: 100_000, bytesPorCanalPorMinuto: 1024 * 1024 * 1024 } })
}, 30_000)

afterAll(async () => {
  desligarContas(novas.splice(0))
  for (const a of antigas.splice(0)) a.session.disconnect()
  await servidor?.fechar()
})

async function contaAntiga(nucleo: any, nome: string): Promise<Antiga> {
  const vault = new nucleo.Vault(new CofreEmMemoria())
  await vault.create("frase-passe-de-teste")
  const session = new nucleo.Session(vault, { armazem: new nucleo.ArmazemEmMemoria() })
  const identidade = await session.createIdentity(servidor.casa)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, address: identidade.address as string }
  antigas.push(conta)
  return conta
}

const mensagem = (corpo: string): Payload =>
  ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], links: [], mentions: [] }) as unknown as Payload

descrever("um cliente antigo com o servidor que entrega por para", () => {
  it("os sinais continuam em difusão, e o D2 anda com membros antigos no canal", async () => {
    const nucleo = await import(pathToFileURL(join(RAIZ_ANTIGA!, "packages/client-core/dist/index.js")).href)
    const velhaAna = await contaAntiga(nucleo, "VelhaAna")
    const velhoBruno = await contaAntiga(nucleo, "VelhoBruno")
    const [nova, tardia] = await contasDeTeste(servidor, ["Nova", "Tardia"], { salaComum: false })
    novas.push(nova!, tardia!)
    // An old account founds the channel and seats the others.
    const { moradaDeSala } = await import("@enclave/protocol")
    const canal = moradaDeSala(servidor.casa)
    await velhaAna.session.createSpaceChannel(canal)
    await ate(() => velhaAna.session.founderOf(canal) === velhaAna.address, "a VelhaAna funda o canal")
    for (const outra of [velhoBruno, nova!]) {
      await velhaAna.session.seat(canal, outra.address)
      await ate(() => outra.session.channels.includes(canal), `${outra.nome} entra`, 30_000)
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // "Is typing" from an old account: everyone hears it.
    const ouvidos: Record<string, string[]> = { bruno: [], nova: [], ana: [] }
    velhoBruno.session.on("typing", (e: { channel: string; from: string }) => e.channel === canal && ouvidos.bruno!.push(e.from))
    nova!.session.on("typing", (e) => e.channel === canal && ouvidos.nova!.push(String(e.from)))
    velhaAna.session.on("typing", (e: { channel: string; from: string }) => e.channel === canal && ouvidos.ana!.push(e.from))
    await velhaAna.session.sinalizarEscrita(canal, "geral", Date.now() + 5_000)
    await ate(() => ouvidos.bruno!.includes(velhaAna.address) && ouvidos.nova!.includes(velhaAna.address), "a escrita da antiga chega a todos")
    // And from a new account, to both old ones.
    await nova!.session.sinalizarEscrita(canal, "geral", Date.now() + 5_000)
    await ate(() => ouvidos.bruno!.includes(nova!.address) && ouvidos.ana!.includes(nova!.address), "a escrita da nova chega aos antigos")

    // A past, from everyone. Then a late new account joins.
    for (let i = 1; i <= 5; i++) await velhaAna.session.send(canal, mensagem(`velha-${i}`))
    await nova!.session.send(canal, mensagem("da-nova"))
    const corpos = (conta: ContaDeTeste): string[] =>
      entradasDoCanal(conta.vault.contents, canal).filter((e) => e.payload.t === "message").map((e) => String(e.payload["body"]))
    await ate(() => corpos(nova!).includes("velha-5"), "a Nova tem o passado", 30_000)
    await velhaAna.session.seat(canal, tardia!.address)
    await ate(() => tardia!.session.channels.includes(canal), "a Tardia entra", 30_000)
    await ate(() => tardia!.session.lugarEm(canal) !== null, "a Tardia tem lugar")
    tardia!.session.pedirHistoricoDosMembros()
    await ate(
      () => ["velha-1", "velha-5", "da-nova"].every((c) => corpos(tardia!).includes(c)),
      "o passado chega à Tardia pela Nova",
      120_000,
    ).catch((erro: unknown) => {
      console.log("Tardia:", JSON.stringify(corpos(tardia!)), JSON.stringify(tardia!.session.estatisticasDosMembros))
      throw erro
    })
    console.log("Tardia, D2 com membros antigos:", JSON.stringify(tardia!.session.estatisticasDosMembros))
    expect(nova!.session.estatisticasDosMembros.paginasServidas).toBeGreaterThan(0)

    // The old ones still talk, both ways, after all of it.
    await velhoBruno.session.send(canal, mensagem("o-velho-ainda-fala"))
    await ate(() => corpos(tardia!).includes("o-velho-ainda-fala") && corpos(nova!).includes("o-velho-ainda-fala"), "o antigo ainda fala")
    await tardia!.session.send(canal, mensagem("a-tardia-fala"))
    await ate(
      () => [velhaAna, velhoBruno].every((a) => (a.session.history(canal) as { payload: { body?: string } }[]).some((e) => e.payload.body === "a-tardia-fala")),
      "os antigos ouvem a Tardia",
    )
  }, 300_000)
})
