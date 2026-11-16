import { DatabaseSync } from "node:sqlite"
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
 * "Is typing" travels as an ephemeral signal, never as a stored MLS message
 * (12/11/2026).
 *
 * In the common room on 10/11, 94 % of the stored events were 588-byte frames:
 * "is typing" and other expired `typing`. Each one was kept 30 days, decrypted
 * by every member, live and again in every recovery, and spent a generation of
 * the sender's ratchet. The encrypted `channel.sinal` already exists for this:
 * keyed from the MLS exporter, signed by the device, never stored.
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

function eventosGuardados(canal: string): number {
  const db = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
  try {
    return (db.prepare("SELECT count(*) AS n FROM events WHERE channel = ?").get(canal) as { n: number }).n
  } finally {
    db.close()
  }
}

describe("a escrever, pelo sinal efémero", () => {
  it("o Bruno vê a Ana a escrever, e o servidor não guarda nada", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    // Let the joins and their cascades settle before counting.
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const vistos: { from: string; room: string; until: number }[] = []
    bruno!.session.on("typing", (evento) => {
      if (evento.channel === canal) vistos.push(evento)
    })
    const antes = eventosGuardados(canal)
    const ate5s = Date.now() + 5_000
    await ana!.session.sinalizarEscrita(canal, "geral", ate5s)
    await ate(() => vistos.length > 0, "o Bruno vê a Ana a escrever", 10_000)
    expect(vistos[0]).toMatchObject({ from: ana!.address, room: "geral", until: ate5s })
    // Nothing reached the stored history of the channel.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(eventosGuardados(canal)).toBe(antes)
  }, 90_000)

  it("o ref do sinal de escrita não diz ao servidor que é escrita (revisão do 1.3.8, achado 4)", async () => {
    // It carried the prefix `ty-`, and the server reads the `ref`: it learned, in
    // clear, who was typing where and when.
    const Original = globalThis.WebSocket
    const refs: string[] = []
    class Espia extends Original {
      override send(dados: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (typeof dados === "string" && dados.includes('"t":"channel.sinal"')) refs.push(String((JSON.parse(dados) as { ref?: unknown }).ref ?? ""))
        super.send(dados)
      }
    }
    globalThis.WebSocket = Espia as typeof WebSocket
    try {
      const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
      abertas.push(ana!, bruno!)
      const canal = await canalComTodos(servidor, ana!, [bruno!])
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const vistos: unknown[] = []
      bruno!.session.on("typing", (evento) => vistos.push(evento))
      const antes = refs.length
      await ana!.session.sinalizarEscrita(canal, "", Date.now() + 5_000)
      await ate(() => vistos.length > 0, "o Bruno vê a Ana a escrever", 10_000)
      const daEscrita = refs.slice(antes)
      expect(daEscrita.length).toBeGreaterThan(0)
      for (const ref of daEscrita) expect(ref.startsWith("ty-")).toBe(false)
    } finally {
      globalThis.WebSocket = Original
    }
  }, 90_000)
})
