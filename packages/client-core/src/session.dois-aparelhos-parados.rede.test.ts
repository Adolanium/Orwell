import { Session as Inspector } from "node:inspector/promises"
import type { Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Two devices of one account, left alone (hotfix 1.3.14, measurement).
 *
 *   ORWELL_MEDIR_PARADO_MIN=12 npx vitest run --root packages/client-core src/session.dois-aparelhos-parados.rede.test.ts
 *
 * The bug in 1.3.13: "every 5 minutes or so the app does not respond",
 * with no traffic. Skipped unless `ORWELL_MEDIR_PARADO_MIN` is set: it runs with
 * the real clocks for that many minutes. Logs, per device, every vault write
 * (when, and the stack that asked for it) and the worst timer lateness per minute.
 */

const MINUTOS = Number(process.env.ORWELL_MEDIR_PARADO_MIN ?? 0)

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

function vigiarEscritas(conta: ContaDeTeste, t0: () => number): { s: number; quem: string }[] {
  const escritas: { s: number; quem: string }[] = []
  const original = conta.backend.write.bind(conta.backend)
  conta.backend.write = async (bytes: Uint8Array): Promise<void> => {
    const pilha = (new Error().stack ?? "")
      .split("\n")
      .slice(2)
      .map((linha) => linha.trim().replace(/^at /, "").replace(/\(.*\/src\//, "(").replace(/\)$/, ""))
      .filter((linha) => !linha.includes("node:internal") && !linha.includes("cofre") && !linha.includes("vault.ts"))
      .slice(0, 4)
      .join(" < ")
    escritas.push({ s: Math.round((Date.now() - t0()) / 1000), quem: pilha })
    return original(bytes)
  }
  return escritas
}

describe.skipIf(!MINUTOS)("dois aparelhos parados", () => {
  it(`${MINUTOS} minutos sem ninguém fazer nada`, async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canais: string[] = []
    for (let c = 0; c < 6; c++) canais.push(await canalComTodos(servidor, ana!, [bruno!]))
    const mensagem = (body: string): Payload => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] })
    for (const canal of canais) await bruno!.session.sendBatch(canal, Array.from({ length: 40 }, (_, i) => mensagem(`${i} em ${canal}`)))
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    // Settle: pairing, history transfer, the first rounds.
    await new Promise((resolve) => setTimeout(resolve, 60_000))

    let inicio = Date.now()
    const t0 = (): number => inicio
    const escritas = { ana: vigiarEscritas(ana!, t0), telemovel: vigiarEscritas(telemovel, t0), bruno: vigiarEscritas(bruno!, t0) }
    const atrasos: number[] = []
    let esperado = Date.now() + 50
    const relogio = setInterval(() => {
      const agora = Date.now()
      const minuto = Math.floor((agora - inicio) / 60_000)
      atrasos[minuto] = Math.max(atrasos[minuto] ?? 0, agora - esperado)
      esperado = agora + 50
    }, 50)
    const inspector = new Inspector()
    inspector.connect()
    await inspector.post("Profiler.enable")
    await inspector.post("Profiler.setSamplingInterval", { interval: 5_000 })
    await inspector.post("Profiler.start")
    inicio = Date.now()
    await new Promise((resolve) => setTimeout(resolve, MINUTOS * 60_000))
    clearInterval(relogio)
    const { profile } = (await inspector.post("Profiler.stop")) as { profile: { nodes: { id: number; hitCount?: number; callFrame: { functionName: string; url: string; lineNumber: number } }[] } }
    inspector.disconnect()

    const porFuncao = new Map<string, number>()
    for (const n of profile.nodes) {
      if (!n.callFrame.url.includes("/src/") && !n.callFrame.url.includes("/dist/")) continue
      const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber}`
      porFuncao.set(k, (porFuncao.get(k) ?? 0) + (n.hitCount ?? 0))
    }
    const topo = [...porFuncao].sort((a, b) => b[1] - a[1]).slice(0, 15)
    console.log(`atraso máximo por minuto (ms): ${atrasos.join(" ")}`)
    for (const [quem, lista] of Object.entries(escritas)) {
      console.log(`${quem}: ${lista.length} escritas do cofre em ${MINUTOS} min`)
      for (const e of lista) console.log(`  ${e.s}s  ${e.quem}`)
    }
    console.log(`funções com mais amostras (5 ms cada):\n  ${topo.map(([k, v]) => `${v} ${k}`).join("\n  ")}`)
    expect(true).toBe(true)
  }, (MINUTOS + 5) * 60_000)
})
