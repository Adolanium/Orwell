import { toBase64 } from "@enclave/protocol"
import { sha256 } from "@noble/hashes/sha2.js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { Gateway } from "./gateway.js"

/**
 * Short-code pairing boxes per network (1.3.26 review, finding 1).
 *
 * `pair.code.open` passes without an account. With only the per-connection
 * caps, one address could open `PAIR_CODES_LIVE` sockets, park one code on
 * each, and every real new device on the server got `full` for as long as the
 * script ran. The caps are now per network (the same HMAC of the /24 or /56
 * that the account limit uses, kept even when that limit is off): a few
 * waiting codes at once, and a few opens per window, whatever the number of
 * sockets.
 *
 * The test talks from loopback, which the server trusts as a proxy, so an
 * `X-Forwarded-For` gives each client the public network it names.
 */

let server: ServidorDeTeste
const openClients: Cliente[] = []

beforeAll(async () => {
  // No `limiteDeRede`: the pairing caps must hold with the account limit off.
  server = await levantarServidor()
}, 30_000)

afterEach(() => {
  for (const client of openClients.splice(0)) client.fechar()
})

afterAll(async () => {
  await server?.fechar()
})

const newPairId = (): string => toBase64(sha256(crypto.getRandomValues(new Uint8Array(32)))).slice(0, 22)

let nextNameplate = 0
function freshNameplate(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
  const n = nextNameplate++
  return `${alphabet[Math.floor(n / 31) % 31]}${alphabet[n % 31]}`
}

async function from(address: string): Promise<Cliente> {
  const client = await Cliente.withoutAccount(server.url, { forwardedFor: address })
  openClients.push(client)
  return client
}

/** `pair.code.open` on a fresh nameplate; the answer's `t` and `reason`. */
async function tryOpen(client: Cliente): Promise<{ t: string; reason?: string }> {
  const pairId = newPairId()
  client.enviar({ t: "pair.code.open", nameplate: freshNameplate(), pairId })
  for (let i = 0; i < 20; i++) {
    const frame = (await client.proximo()) as { t: string; reason?: string; code?: string }
    if (frame.t === "pair.opened" || frame.t === "pair.rejected") return frame
    if (frame.t === "error" && frame.code === "timeout") break
  }
  throw new Error("no answer to pair.code.open")
}

describe("short-code boxes per network", () => {
  it(`${Gateway.PAIR_CODES_LIVE} sockets of one network no longer use up PAIR_CODES_LIVE`, async () => {
    const answers: { t: string; reason?: string }[] = []
    for (let i = 0; i < Gateway.PAIR_CODES_LIVE; i++) {
      answers.push(await tryOpen(await from(`198.51.100.${(i % 250) + 1}`)))
    }
    const opened = answers.filter((answer) => answer.t === "pair.opened").length
    expect(opened).toBe(Gateway.PAIR_CODES_PER_NETWORK)
    expect(answers.filter((answer) => answer.t === "pair.rejected" && answer.reason === "rate-limited")).toHaveLength(
      Gateway.PAIR_CODES_LIVE - Gateway.PAIR_CODES_PER_NETWORK,
    )
    // A new device on another network still gets a code.
    expect(await tryOpen(await from("203.0.113.7"))).toMatchObject({ t: "pair.opened" })
  }, 60_000)

  it("opens count per network: fresh connections do not start the count again", async () => {
    const network = "192.0.2."
    let opened = 0
    let refused: { t: string; reason?: string } | null = null
    for (let i = 0; i < Gateway.PAIR_CODE_OPENS_PER_NETWORK + 1 && refused === null; i++) {
      const client = await from(`${network}${i + 1}`)
      const answer = await tryOpen(client)
      if (answer.t === "pair.opened") opened++
      else refused = answer
      // Closing burns the box, so the waiting cap never applies here: only the window does.
      client.fechar()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(opened).toBe(Gateway.PAIR_CODE_OPENS_PER_NETWORK)
    expect(refused).toMatchObject({ t: "pair.rejected", reason: "rate-limited" })
  }, 60_000)
})
