import { CAPABILITY_PAIRING_PAKE, generateIdentity, toBase64 } from "@enclave/protocol"
import { sha256 } from "@noble/hashes/sha2.js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { Gateway } from "./gateway.js"

/**
 * Short-code pairing boxes on the server (1.3.26).
 *
 * The server is the one place that can stop an online guesser, so these tests
 * pin its part: the new device opens without an account, the device with the
 * account joins (and only it can), a nameplate joins ONCE, a code dies in five
 * minutes, and an account has a ceiling of attempts per window. What crosses
 * is opaque, as in the QR boxes.
 */

let server: ServidorDeTeste
const openClients: Cliente[] = []

beforeAll(async () => {
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
/** Nameplates the suite has not used yet, so tests never collide with each other. */
function freshNameplate(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
  const n = nextNameplate++
  return `${alphabet[Math.floor(n / 31) % 31]}${alphabet[n % 31]}`
}

async function withoutAccount(): Promise<Cliente> {
  const client = await Cliente.withoutAccount(server.url)
  openClients.push(client)
  return client
}

async function withAccount(): Promise<Cliente> {
  const client = await Cliente.ligar(server.url, generateIdentity(server.casa))
  openClients.push(client)
  return client
}

async function open(newDevice: Cliente, nameplate = freshNameplate()): Promise<{ nameplate: string; pairId: string }> {
  const pairId = newPairId()
  newDevice.enviar({ t: "pair.code.open", nameplate, pairId })
  expect(await newDevice.proximoDe("pair.opened")).toMatchObject({ pairId })
  return { nameplate, pairId }
}

describe("short-code pairing boxes", () => {
  it("the server announces pairing-pake", async () => {
    const client = new WebSocket(server.url)
    const hello = await new Promise<string[]>((resolve) => {
      client.onopen = () => client.send(JSON.stringify({ t: "hello", version: 1 }))
      client.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as { t: string; capabilities?: string[] }
        if (frame.t === "hello.ok") resolve(frame.capabilities ?? [])
      }
    })
    client.close()
    expect(hello).toContain(CAPABILITY_PAIRING_PAKE)
  })

  it("the new device opens without an account; the account joins by nameplate; bytes cross untouched", async () => {
    const newDevice = await withoutAccount()
    const { nameplate, pairId } = await open(newDevice)
    const account = await withAccount()
    account.enviar({ t: "pair.code.join", nameplate })
    expect(await account.proximoDe("pair.code.joined")).toEqual({ t: "pair.code.joined", nameplate, pairId })
    expect(await newDevice.proximoDe("pair.joined")).toMatchObject({ pairId })

    newDevice.enviar({ t: "pair.send", pairId, payload: "cGFrZS1h" })
    expect(await account.proximoDe("pair.message")).toMatchObject({ pairId, payload: "cGFrZS1h" })
    account.enviar({ t: "pair.send", pairId, payload: "cGFrZS1i" })
    expect(await newDevice.proximoDe("pair.message")).toMatchObject({ pairId, payload: "cGFrZS1i" })
  })

  it("pair.code.join without an account is fatal", async () => {
    const newDevice = await withoutAccount()
    const { nameplate } = await open(newDevice)
    const intruder = await withoutAccount()
    intruder.enviar({ t: "pair.code.join", nameplate })
    expect(await intruder.proximo()).toMatchObject({ t: "error", code: "unauthenticated", fatal: true })
  })

  it("a nameplate joins once: a second account finds nothing, and no second guess in that box", async () => {
    const newDevice = await withoutAccount()
    const { nameplate } = await open(newDevice)
    const firstAccount = await withAccount()
    firstAccount.enviar({ t: "pair.code.join", nameplate })
    await firstAccount.proximoDe("pair.code.joined")
    const secondAccount = await withAccount()
    secondAccount.enviar({ t: "pair.code.join", nameplate })
    expect(await secondAccount.proximoDe("pair.code.rejected")).toEqual({ t: "pair.code.rejected", nameplate, reason: "unknown" })
    // The same account again, too.
    firstAccount.enviar({ t: "pair.code.join", nameplate })
    expect(await firstAccount.proximoDe("pair.code.rejected")).toMatchObject({ reason: "unknown" })
  })

  it("a failed confirmation kills the session: the new device closes, the other side is told, nothing is left", async () => {
    const newDevice = await withoutAccount()
    const { nameplate, pairId } = await open(newDevice)
    const account = await withAccount()
    account.enviar({ t: "pair.code.join", nameplate })
    await account.proximoDe("pair.code.joined")
    await newDevice.proximoDe("pair.joined")
    // The tag did not verify on the new device: it closes the box.
    newDevice.enviar({ t: "pair.close", pairId })
    expect(await account.proximoDe("pair.closed")).toMatchObject({ pairId, reason: "closed" })
    const otherAccount = await withAccount()
    otherAccount.enviar({ t: "pair.code.join", nameplate })
    expect(await otherAccount.proximoDe("pair.code.rejected")).toMatchObject({ reason: "unknown" })
  })

  it("two open boxes cannot share a nameplate", async () => {
    const first = await withoutAccount()
    const { nameplate } = await open(first)
    const second = await withoutAccount()
    const pairId = newPairId()
    second.enviar({ t: "pair.code.open", nameplate, pairId })
    expect(await second.proximoDe("pair.rejected")).toEqual({ t: "pair.rejected", pairId, reason: "exists" })
  })

  it("one waiting code per connection", async () => {
    const newDevice = await withoutAccount()
    await open(newDevice)
    const pairId = newPairId()
    newDevice.enviar({ t: "pair.code.open", nameplate: freshNameplate(), pairId })
    expect(await newDevice.proximoDe("pair.rejected")).toMatchObject({ pairId, reason: "exists" })
  })

  it("an account has a ceiling of codes per window, wrong or right", async () => {
    const account = await withAccount()
    for (let i = 0; i < Gateway.PAIR_CODE_ATTEMPTS_PER_ACCOUNT; i++) {
      const nameplate = freshNameplate()
      account.enviar({ t: "pair.code.join", nameplate })
      expect(await account.proximoDe("pair.code.rejected")).toMatchObject({ nameplate, reason: "unknown" })
    }
    // Even a real code is refused now.
    const newDevice = await withoutAccount()
    const { nameplate } = await open(newDevice)
    account.enviar({ t: "pair.code.join", nameplate })
    expect(await account.proximoDe("pair.code.rejected")).toEqual({ t: "pair.code.rejected", nameplate, reason: "rate-limited" })
    // The box is still there for the right account.
    const rightAccount = await withAccount()
    rightAccount.enviar({ t: "pair.code.join", nameplate })
    expect(await rightAccount.proximoDe("pair.code.joined")).toMatchObject({ nameplate })
  })

  it("the ceiling is per window, and the window is ten minutes", () => {
    expect(Gateway.PAIR_CODE_ATTEMPTS_PER_ACCOUNT).toBe(5)
    expect(Gateway.PAIR_CODE_WINDOW_MS).toBe(10 * 60_000)
  })

  it("a code nobody joined dies at five minutes", async () => {
    expect(Gateway.PAIR_CODE_TTL_MS).toBe(5 * 60_000)
    const original = Gateway.PAIR_CODE_TTL_MS
    Gateway.PAIR_CODE_TTL_MS = 300
    try {
      const newDevice = await withoutAccount()
      const { nameplate, pairId } = await open(newDevice)
      expect(await newDevice.proximoDe("pair.closed")).toEqual({ t: "pair.closed", pairId, reason: "expired" })
      const account = await withAccount()
      account.enviar({ t: "pair.code.join", nameplate })
      expect(await account.proximoDe("pair.code.rejected")).toMatchObject({ reason: "unknown" })
    } finally {
      Gateway.PAIR_CODE_TTL_MS = original
    }
  })

  it("once joined, the pairing outlives the code's five minutes", async () => {
    const original = Gateway.PAIR_CODE_TTL_MS
    Gateway.PAIR_CODE_TTL_MS = 300
    try {
      const newDevice = await withoutAccount()
      const { nameplate, pairId } = await open(newDevice)
      const account = await withAccount()
      account.enviar({ t: "pair.code.join", nameplate })
      await account.proximoDe("pair.code.joined")
      await newDevice.proximoDe("pair.joined")
      await new Promise((done) => setTimeout(done, 600))
      newDevice.enviar({ t: "pair.send", pairId, payload: "YWluZGE" })
      expect(await account.proximoDe("pair.message")).toMatchObject({ pairId, payload: "YWluZGE" })
    } finally {
      Gateway.PAIR_CODE_TTL_MS = original
    }
  })

  it("the new device's socket stays past the login deadline while its code waits", async () => {
    const original = Gateway.PRAZO_DO_LOGIN_MS
    Gateway.PRAZO_DO_LOGIN_MS = 300
    try {
      const newDevice = await withoutAccount()
      const { nameplate } = await open(newDevice)
      await new Promise((done) => setTimeout(done, 800))
      const account = await withAccount()
      account.enviar({ t: "pair.code.join", nameplate })
      expect(await account.proximoDe("pair.code.joined")).toMatchObject({ nameplate })
    } finally {
      Gateway.PRAZO_DO_LOGIN_MS = original
    }
  })
})
