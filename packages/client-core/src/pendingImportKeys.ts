import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { devicePublicKeyOf, fromBase64, toBase64 } from "@enclave/protocol"

/**
 * The new device key of an import, kept stable across retries (B1, review of
 * 21/11/2026).
 *
 * The handover publishes the manifest with the new device key BEFORE the vault
 * is written (`passagem.ts`). When something fails after the publish (the
 * `manifest.published` reply is lost, the vault write fails, the tab closes),
 * the key stays in the manifest. Each retry used to draw a new key, so each
 * failure left one more ghost device. With the cap of `APARELHOS_POR_CONTA`
 * devices, an account whose only way in is the file was then locked for good.
 *
 * Now the first attempt draws a random SEED and stores it on this device,
 * per account address, before the handover. The device key is
 * HKDF-SHA256(account private key, seed). The next import of a file of the same
 * account on this device reads the seed back and gets the same key, so the
 * handover finds it "already in" and adds nothing. The seed is removed once the
 * vault is written.
 *
 * The seed is stored in the clear. Alone it gives nothing: the key needs the
 * account private key, which only the decrypted file holds. A different device
 * draws its own seed, so two devices that import the same file never share a
 * device key.
 */

/** Where the seeds live: one small text record on this device, outside every vault. */
export interface PendingImportKeysRecord {
  read(): string | null
  write(text: string | null): void
}

export interface PendingImportKeys {
  /** The seed of an import of `address` that did not finish on this device, or `null`. */
  read(address: string): Promise<Uint8Array | null>
  write(address: string, seed: Uint8Array): Promise<void>
  remove(address: string): Promise<void>
}

/** The `localStorage` key on the web. */
export const PENDING_IMPORT_KEYS_STORAGE_KEY = "enclave.pendingImportKeys"

/** The file name in the desktop's user data folder. */
export const PENDING_IMPORT_KEYS_FILE = "pending-import-keys.json"

/** Seeds kept at most: one per account this device tried to import and did not finish. The oldest goes first. */
const MAX_SEEDS = 16

const SEED_BYTES = 32
const HKDF_INFO = new TextEncoder().encode("orwell import device key v1")

/** A new random seed. */
export function newImportSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SEED_BYTES))
}

/** The device key of an import: the same account key and seed always give the same key. */
export function importDeviceKey(accountPrivateKey: Uint8Array, seed: Uint8Array): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = hkdf(sha256, accountPrivateKey, seed, HKDF_INFO, 32)
  return { privateKey, publicKey: devicePublicKeyOf(privateKey) }
}

/** The seeds over one text record (a `localStorage` entry, a file). A record that does not read is empty. */
export function pendingImportKeysIn(record: PendingImportKeysRecord): PendingImportKeys {
  const readAll = (): [string, string][] => {
    try {
      const raw = JSON.parse(record.read() ?? "[]") as unknown
      if (!Array.isArray(raw)) return []
      return raw.filter(
        (entry): entry is [string, string] =>
          Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string",
      )
    } catch {
      return []
    }
  }
  const writeAll = (entries: [string, string][]): void => {
    record.write(entries.length === 0 ? null : JSON.stringify(entries.slice(-MAX_SEEDS)))
  }
  return {
    async read(address) {
      const seed = readAll().find(([entry]) => entry === address)?.[1]
      if (seed === undefined) return null
      try {
        const bytes = fromBase64(seed)
        return bytes.length === SEED_BYTES ? bytes : null
      } catch {
        return null
      }
    },
    async write(address, seed) {
      // Newest last: the cap removes the oldest.
      writeAll([...readAll().filter(([entry]) => entry !== address), [address, toBase64(seed)]])
    },
    async remove(address) {
      const entries = readAll()
      const rest = entries.filter(([entry]) => entry !== address)
      if (rest.length !== entries.length) writeAll(rest)
    },
  }
}

/** The seeds in `localStorage`. Without storage (a private window that refuses it), nothing is kept: each import draws a new key, as before. */
export function pendingImportKeysInLocalStorage(): PendingImportKeys {
  return pendingImportKeysIn({
    read: () => {
      try {
        return localStorage.getItem(PENDING_IMPORT_KEYS_STORAGE_KEY)
      } catch {
        return null
      }
    },
    write: (text) => {
      if (text === null) localStorage.removeItem(PENDING_IMPORT_KEYS_STORAGE_KEY)
      else localStorage.setItem(PENDING_IMPORT_KEYS_STORAGE_KEY, text)
    },
  })
}
