import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Gateway } from "../../../apps/server/src/gateway.js"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { HISTORY_MAX_PER_CHANNEL } from "./vault.js"
import type { Payload } from "@enclave/protocol"

/**
 * A day away from a busy channel (17/11/2026).
 *
 * The common room of a real server took 11 000 to 16 000 application events a
 * day. Someone away for the day came back to the last 400 messages
 * (`HISTORY_MAX_PER_CHANNEL`): recovery decrypted every one of them, in order,
 * and the vault cap threw the rest away. MLS spends each key as it reads, so
 * the server's copy of those events never opens again on that device: the
 * day was gone. Typing and the other ephemeral payloads never counted for the
 * cap (they do not reach the history); what is measured here is that the
 * visible messages past the cap stay on the device, outside the vault JSON,
 * and come back page by page when the person scrolls up.
 */

const MENSAGENS = 1_000
const SINAIS_POR_MENSAGEM = 10

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const envios = Gateway.ENVIOS_POR_MINUTO
beforeAll(async () => {
  // 11 000 events from one account: past the server's per-minute send cap, which is not what this measures.
  ;(Gateway as unknown as { ENVIOS_POR_MINUTO: number }).ENVIOS_POR_MINUTO = 1_000_000
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  ;(Gateway as unknown as { ENVIOS_POR_MINUTO: number }).ENVIOS_POR_MINUTO = envios
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

const corpo = (entrada: { payload: Record<string, unknown> }): string => String(entrada.payload["body"] ?? "")

/** Every visible message this device can show for the channel: the vault, then the archive, page by page. */
async function tudoOQueSeVe(conta: Pick<ContaDeTeste, "session">, canal: string): Promise<string[]> {
  const vistas = conta.session.history(canal).map(corpo)
  let cursor: number | null | undefined
  for (let volta = 0; volta < 1_000; volta++) {
    const pagina = await conta.session.conversaArquivada(canal, cursor)
    vistas.unshift(...pagina.entradas.map(corpo))
    if (pagina.seguinte === null) break
    cursor = pagina.seguinte
  }
  return vistas.filter((texto) => texto.startsWith("dia-"))
}

describe("um dia fora de um canal com muito movimento", () => {
  it("1 000 mensagens e 10 000 sinais efémeros: quem esteve fora o dia todo vê as 1 000 ao subir", async () => {
    const [xana, william] = await contasDeTeste(servidor, ["Xana", "William"])
    abertas.push(xana!, william!)
    const canal = await canalComTodos(servidor, xana!, [william!])

    william!.session.disconnect()
    const lote: Payload[] = []
    for (let i = 0; i < MENSAGENS; i++) {
      for (let s = 0; s < SINAIS_POR_MENSAGEM; s++) lote.push({ t: "typing", until: Date.now() + 5_000 } as Payload)
      lote.push({ t: "message", body: `dia-${String(i).padStart(4, "0")}`, sentAt: Date.now(), id: `dia-${String(i).padStart(8, "0")}` })
      if (lote.length >= 220) await xana!.session.sendBatch(canal, lote.splice(0))
    }
    if (lote.length > 0) await xana!.session.sendBatch(canal, lote.splice(0))

    await william!.session.connect()
    // 11 000 events to read: alone this takes under a minute; with the whole suite running beside it, several.
    await ate(() => william!.session.history(canal).some((m) => corpo(m) === "dia-0999"), "o William apanha o dia", 540_000, 250)
    await william!.session.flush()

    // The ephemeral signals spent nothing: the vault holds the cap, all of it visible messages.
    const noCofre = william!.session.history(canal).map(corpo).filter((texto) => texto.startsWith("dia-"))
    expect(noCofre).toHaveLength(HISTORY_MAX_PER_CHANNEL)

    const vistas = await tudoOQueSeVe(william!, canal)
    expect(new Set(vistas).size).toBe(MENSAGENS)
    expect(vistas[0]).toBe("dia-0000")
    expect(vistas.at(-1)).toBe("dia-0999")

    // And after a restart: the archive lives on the disks, not in memory.
    const depois = await recarregar(william!)
    expect(new Set(await tudoOQueSeVe(depois, canal)).size).toBe(MENSAGENS)
  }, 900_000)
})
