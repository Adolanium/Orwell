import { describe, expect, it } from "vitest"
import { impressaoDoEndereco } from "./impressaoDoEndereco.js"

describe("impressaoDoEndereco", () => {
  it("is 16 hex characters, the same for the same address, and different for another", async () => {
    const uma = await impressaoDoEndereco("@ana:casa.pt")
    expect(uma).toMatch(/^[0-9a-f]{16}$/)
    expect(await impressaoDoEndereco("@ana:casa.pt")).toBe(uma)
    expect(await impressaoDoEndereco("@bruno:casa.pt")).not.toBe(uma)
    expect(uma).not.toContain("ana")
  })
})
