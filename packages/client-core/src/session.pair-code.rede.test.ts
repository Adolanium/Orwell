import { formatPairingCode } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Gateway } from "../../../apps/server/src/gateway.js"
import {
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import type { PairEvento } from "./emparelhar.js"
import { ArmazemEmMemoria } from "./armazem/emMemoria.js"
import { Session } from "./session.js"
import { Vault } from "./vault.js"

/**
 * Short-code pairing from end to end (1.3.26), on a real server: the new
 * device shows "K7P · 4QM", the device with the account types it, CPace runs
 * through the box, and from there the pairing is the QR one (words,
 * certificate, the account private key, the manifest).
 *
 * And the three promises of the short code: a wrong code fails on both sides
 * and kills the session; there is no second try with the same code; a code
 * nobody typed dies.
 */

let server: ServidorDeTeste
const openAccounts: ContaDeTeste[] = []
const sessions: Session[] = []

beforeAll(async () => {
  server = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(openAccounts.splice(0))
  for (const session of sessions.splice(0)) {
    session.cancelarEmparelhamento()
    session.disconnect()
  }
})

afterAll(async () => {
  await server?.fechar()
})

async function newDevice(): Promise<{ session: Session; vault: Vault; phases: PairEvento[] }> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-do-telemovel")
  const session = new Session(vault, { armazem: new ArmazemEmMemoria() })
  sessions.push(session)
  const phases: PairEvento[] = []
  session.on("pair", (event) => phases.push(event))
  return { session, vault, phases }
}

function phase<F extends PairEvento["fase"]>(session: Session, target: F, timeoutMs = 20_000): Promise<Extract<PairEvento, { fase: F }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`never reached ${target}`))
    }, timeoutMs)
    const unsubscribe = session.on("pair", (event) => {
      if (event.fase === target) {
        clearTimeout(timer)
        unsubscribe()
        resolve(event as Extract<PairEvento, { fase: F }>)
      } else if (event.fase === "falhou" && target !== "falhou") {
        clearTimeout(timer)
        unsubscribe()
        reject(new Error(`pairing failed: ${event.razao}`))
      }
    })
  })
}

/** A code with the same nameplate (first two characters) and a wrong secret part. */
function wrong(code: string): string {
  const last = code[5] === "2" ? "3" : "2"
  return `${code.slice(0, 5)}${last}`
}

describe("short-code pairing on a real server", () => {
  it("the new device shows a code, the account types it, and the device joins with the same words on both", async () => {
    const [ana] = await contasDeTeste(server, ["Ana"])
    openAccounts.push(ana!)
    const device = await newDevice()

    const shown = phase(device.session, "code")
    device.session.pairAsGuestByCode(server.casa)
    const { code, link } = await shown
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/)
    expect(link).toContain(`#code=${code}`)

    const sasDevice = phase(device.session, "sas")
    const sasAccount = phase(ana!.session, "sas")
    // As the person types it, with the dot and in lower case.
    await ana!.session.pairAsHostByCode(formatPairingCode(code).toLowerCase())
    const [wordsDevice, wordsAccount] = await Promise.all([sasDevice, sasAccount])
    expect(wordsDevice.palavras).toBe(wordsAccount.palavras)
    expect(wordsDevice.palavras.split("-")).toHaveLength(6)

    const certificate = phase(device.session, "certificado")
    const completed = phase(ana!.session, "concluido", 30_000)
    await device.session.confirmarSas()
    await ana!.session.confirmarSas()
    expect((await certificate).address).toBe(ana!.address)
    // The account private key came, as in the QR pairing (1.3.16).
    expect(device.vault.contents.signingPrivateKey).toBeTruthy()
    const identity = device.session.loadIdentity()
    expect(identity.address).toBe(ana!.address)
    await device.session.connect()
    device.session.concluirEmparelhamento()
    await completed
    const devices = await ana!.session.aparelhosDaConta()
    expect(devices?.length).toBe(2)
  }, 90_000)

  it("the QR of the new device works the same way", async () => {
    const [ana] = await contasDeTeste(server, ["Ana"])
    openAccounts.push(ana!)
    const device = await newDevice()
    const shown = phase(device.session, "code")
    device.session.pairAsGuestByCode(server.casa)
    const { link } = await shown
    const sasAccount = phase(ana!.session, "sas")
    await ana!.session.pairAsHostByCode(link)
    await sasAccount
  }, 60_000)

  it("a wrong code fails on both sides, kills the session, and the right code then finds nothing", async () => {
    const [ana] = await contasDeTeste(server, ["Ana"])
    openAccounts.push(ana!)
    const device = await newDevice()
    const shown = phase(device.session, "code")
    device.session.pairAsGuestByCode(server.casa)
    const { code } = await shown

    const deviceFailure = phase(device.session, "falhou")
    const accountFailure = phase(ana!.session, "falhou")
    await ana!.session.pairAsHostByCode(wrong(code))
    expect((await deviceFailure).razao).toBe("wrong-code")
    expect((await accountFailure).razao).toBe("wrong-code")
    // Nobody saw words, nothing was signed.
    expect(device.phases.some((event) => event.fase === "sas")).toBe(false)

    // No second try: the code was spent at the first join.
    const again = phase(ana!.session, "falhou")
    await ana!.session.pairAsHostByCode(code).catch(() => {})
    expect((await again).razao).toBe("unknown-code")
    expect(device.vault.contents.accountPublicKey).toBeFalsy()
  }, 60_000)

  it("a code nobody typed expires", async () => {
    const original = Gateway.PAIR_CODE_TTL_MS
    Gateway.PAIR_CODE_TTL_MS = 500
    try {
      const device = await newDevice()
      const failure = phase(device.session, "falhou")
      device.session.pairAsGuestByCode(server.casa)
      expect((await failure).razao).toBe("expired-code")
    } finally {
      Gateway.PAIR_CODE_TTL_MS = original
    }
  }, 30_000)

  it("what is not a code is refused before anything goes to the server", async () => {
    const [ana] = await contasDeTeste(server, ["Ana"])
    openAccounts.push(ana!)
    await expect(ana!.session.pairAsHostByCode("K0P4QM")).rejects.toThrow("that is not a pairing code")
    await expect(ana!.session.pairAsHostByCode("https://outro.exemplo/app/emparelhar#code=K7P4QM")).rejects.toThrow("this pairing code is for another server")
  }, 30_000)
})
