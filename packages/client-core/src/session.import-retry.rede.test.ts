import { toBase64 } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// The same build as the harness (`@enclave/client-core`), so the classes are the same ones.
import {
  ArmazemEmMemoria,
  ERRO_CONTA_CHEIA_NO_IMPORTAR,
  pendingImportKeysIn,
  Session,
  Vault,
  type PendingImportKeys,
  type PedidoDePassagem,
  type VaultBackend,
} from "@enclave/client-core"

/**
 * A failed import of the account file never takes a seat (B1, review of
 * 21/11/2026), against the real server.
 *
 * The handover publishes the new device key before the vault is written. A
 * failure after the publish (the reply lost, the vault write failed, the tab
 * closed) left that key in the manifest, and each retry drew a new one. With
 * the cap of 4 devices, an account whose only way in is the file was locked for
 * good. What this holds:
 *
 * - without the seed store, two failed imports fill a 2-device account, and the
 *   next import is refused (the bug, kept as the contrast);
 * - with it, four failed imports in a row leave ONE extra key, and the fifth
 *   import goes in with that same key: the account never fills;
 * - a kept key that another device removed meanwhile is dropped, and the import
 *   draws a new one;
 * - the seed goes once the vault is written: the next import is a new device.
 */

const FRASE = "frase-passe-de-teste"

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

/** One device's seed store, in memory. */
function memoryStore(): PendingImportKeys & { text: () => string | null } {
  let text: string | null = null
  const store = pendingImportKeysIn({ read: () => text, write: (next) => void (text = next) })
  return { ...store, text: () => text }
}

class FailingDisk extends CofreEmMemoria implements VaultBackend {
  override async write(bytes: Uint8Array): Promise<void> {
    void bytes
    throw new Error("vault storage is full")
  }
}

type Failure = "reply-lost" | "write-fails"

/**
 * One import of `file` on this device. `failure`: the handover publishes and the
 * answer is lost, or the vault write fails after the handover. Resolves the
 * vault when the import went in.
 */
async function importOnce(file: Uint8Array, store: PendingImportKeys | undefined, failure?: Failure): Promise<{ vault: Vault; backend: CofreEmMemoria; session: Session }> {
  const backend = failure === "write-fails" ? new FailingDisk() : new CofreEmMemoria()
  const vault = new Vault(backend)
  const session = new Session(vault, { armazem: new ArmazemEmMemoria() })
  await vault.importVault(file, FRASE, {
    passagem: async (pedido: PedidoDePassagem) => {
      const result = await session.passagemDoImportar(pedido)
      // The manifest is published; the device never hears it.
      if (failure === "reply-lost") throw new Error("the connection dropped")
      return result
    },
    ...(store ? { pendingImportKeys: store } : {}),
  })
  return { vault, backend, session }
}

async function deviceKeys(account: ContaDeTeste): Promise<string[]> {
  return ((await account.session.aparelhosDaConta()) ?? []).map((device) => device.deviceKey)
}

/** Ana with a paired phone: 2 devices of the 4. */
async function anaWithPhone(): Promise<{ ana: ContaDeTeste; file: Uint8Array }> {
  const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
  abertas.push(ana!)
  const phone = await emparelharAparelho(ana!, "Ana (phone)")
  abertas.push(phone)
  await ana!.session.flush()
  expect(await deviceKeys(ana!)).toHaveLength(2)
  return { ana: ana!, file: await ana!.vault.exportVault() }
}

describe("a failed import never takes a seat", () => {
  it("without the seed store, two failed imports fill the account and the file is refused (the bug)", async () => {
    const { ana, file } = await anaWithPhone()
    await expect(importOnce(file, undefined, "reply-lost")).rejects.toThrow("the connection dropped")
    await expect(importOnce(file, undefined, "reply-lost")).rejects.toThrow("the connection dropped")
    expect(await deviceKeys(ana)).toHaveLength(4)
    await expect(importOnce(file, undefined)).rejects.toThrow(ERRO_CONTA_CHEIA_NO_IMPORTAR)
  }, 120_000)

  it("four failed imports in a row leave one extra key, and the fifth goes in with that key", async () => {
    const { ana, file } = await anaWithPhone()
    const before = await deviceKeys(ana)
    const store = memoryStore()

    const failures: Failure[] = ["reply-lost", "write-fails", "reply-lost", "write-fails"]
    for (const failure of failures) {
      await expect(importOnce(file, store, failure)).rejects.toThrow()
      const keys = await deviceKeys(ana)
      expect(keys, `after ${failure}`).toHaveLength(3)
      // The seed stays for the next try.
      expect(store.text()).not.toBeNull()
    }
    const ghost = (await deviceKeys(ana)).find((key) => !before.includes(key))
    expect(ghost).toBeDefined()

    const { vault, backend, session } = await importOnce(file, store)
    await vault.unlock(FRASE)
    const identity = session.loadIdentity()
    // The import that went in IS the key of the failed tries: no new seat.
    expect(toBase64(identity.deviceSigningPublicKey)).toBe(ghost)
    expect(await deviceKeys(ana)).toHaveLength(3)
    // The vault is written: the seed is gone, and the next import is a new device.
    expect(store.text()).toBeNull()
    expect(backend.bytes).not.toBeNull()

    await session.connect()
    abertas.push({ nome: "Ana (imported)", session, vault, backend, armazem: new ArmazemEmMemoria(), address: identity.address, avisos: [] })
    expect(session.connection).toBe("online")
  }, 180_000)

  it("a kept key that another device removed is dropped, and the import draws a new one", async () => {
    const { ana, file } = await anaWithPhone()
    const before = await deviceKeys(ana)
    const store = memoryStore()
    await expect(importOnce(file, store, "reply-lost")).rejects.toThrow("the connection dropped")
    const ghost = (await deviceKeys(ana)).find((key) => !before.includes(key))!
    // Ana sees the new-device card and removes the ghost.
    await ana.session.revokeDevice(ghost)
    expect(await deviceKeys(ana)).toHaveLength(2)

    const { vault, session } = await importOnce(file, store)
    await vault.unlock(FRASE)
    const key = toBase64(session.loadIdentity().deviceSigningPublicKey)
    expect(key).not.toBe(ghost)
    const after = await deviceKeys(ana)
    expect(after).toHaveLength(3)
    expect(after).toContain(key)
    expect(store.text()).toBeNull()
  }, 120_000)
})
