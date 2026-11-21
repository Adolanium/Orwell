import { describe, expect, it } from "vitest"
import { importDeviceKey, newImportSeed, pendingImportKeysIn } from "./pendingImportKeys.js"

/** The seed store of `pendingImportKeys.ts` (B1): per address, capped, and safe on a damaged record. */

function store(initial: string | null = null) {
  let text = initial
  return { keys: pendingImportKeysIn({ read: () => text, write: (next) => void (text = next) }), text: () => text }
}

describe("pending import keys", () => {
  it("the same account key and seed give the same device key; another seed gives another", () => {
    const account = crypto.getRandomValues(new Uint8Array(32))
    const seed = newImportSeed()
    const a = importDeviceKey(account, seed)
    const b = importDeviceKey(account, seed.slice())
    expect(a.publicKey).toEqual(b.publicKey)
    expect(a.privateKey).toEqual(b.privateKey)
    expect(importDeviceKey(account, newImportSeed()).publicKey).not.toEqual(a.publicKey)
    expect(importDeviceKey(crypto.getRandomValues(new Uint8Array(32)), seed).publicKey).not.toEqual(a.publicKey)
  })

  it("keeps one seed per address, and removing the last one removes the record", async () => {
    const { keys, text } = store()
    const one = newImportSeed()
    const two = newImportSeed()
    await keys.write("@ana:orwell.test", one)
    await keys.write("@bruno:orwell.test", two)
    expect(await keys.read("@ana:orwell.test")).toEqual(one)
    expect(await keys.read("@bruno:orwell.test")).toEqual(two)
    expect(await keys.read("@carla:orwell.test")).toBeNull()
    await keys.remove("@ana:orwell.test")
    expect(await keys.read("@ana:orwell.test")).toBeNull()
    await keys.remove("@bruno:orwell.test")
    expect(text()).toBeNull()
  })

  it("keeps at most 16 seeds, the oldest goes first", async () => {
    const { keys } = store()
    for (let i = 0; i < 20; i++) await keys.write(`@a${i}:orwell.test`, newImportSeed())
    expect(await keys.read("@a3:orwell.test")).toBeNull()
    expect(await keys.read("@a4:orwell.test")).not.toBeNull()
    expect(await keys.read("@a19:orwell.test")).not.toBeNull()
  })

  it("a damaged record reads as empty and does not throw", async () => {
    for (const damaged of ["{", "{}", '[["@ana:orwell.test", 7]]', '[["@ana:orwell.test", "not base64 !"]]', '[["@ana:orwell.test", "AAAA"]]']) {
      const { keys } = store(damaged)
      expect(await keys.read("@ana:orwell.test"), damaged).toBeNull()
    }
  })
})
