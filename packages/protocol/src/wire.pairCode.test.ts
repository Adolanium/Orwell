import { describe, expect, it } from "vitest"
import { CAPABILITY_PAIRING_PAKE, ClientFrame, ServerFrame } from "./wire.js"

/**
 * The short-code pairing frames (1.3.26). The server only ever sees the
 * nameplate (two characters) and a random box id; these tests pin that the
 * wire has no field for more than that.
 */
const PAIR_ID = "AAAAAAAAAAAAAAAAAAAAAA"

describe("short-code pairing on the wire", () => {
  it("the capability has a stable name", () => {
    expect(CAPABILITY_PAIRING_PAKE).toBe("pairing-pake")
  })

  it("pair.code.open takes a nameplate and a box id, nothing else", () => {
    expect(ClientFrame.parse({ t: "pair.code.open", nameplate: "K7", pairId: PAIR_ID })).toEqual({
      t: "pair.code.open",
      nameplate: "K7",
      pairId: PAIR_ID,
    })
    // A code smuggled in is dropped by the schema, never stored.
    expect(ClientFrame.parse({ t: "pair.code.open", nameplate: "K7", pairId: PAIR_ID, code: "K7P4QM" })).not.toHaveProperty("code")
    expect(ClientFrame.safeParse({ t: "pair.code.open", nameplate: "K7P", pairId: PAIR_ID }).success).toBe(false)
    expect(ClientFrame.safeParse({ t: "pair.code.open", nameplate: "K0", pairId: PAIR_ID }).success).toBe(false)
  })

  it("pair.code.join takes only the nameplate", () => {
    expect(ClientFrame.parse({ t: "pair.code.join", nameplate: "K7" })).toEqual({ t: "pair.code.join", nameplate: "K7" })
    expect(ClientFrame.safeParse({ t: "pair.code.join", nameplate: "k7" }).success).toBe(false)
  })

  it("the server answers a join with the box id, or a reason", () => {
    expect(ServerFrame.parse({ t: "pair.code.joined", nameplate: "K7", pairId: PAIR_ID }).t).toBe("pair.code.joined")
    for (const reason of ["unknown", "rate-limited"]) {
      expect(ServerFrame.parse({ t: "pair.code.rejected", nameplate: "K7", reason }).t).toBe("pair.code.rejected")
    }
    expect(ServerFrame.safeParse({ t: "pair.code.rejected", nameplate: "K7", reason: "other" }).success).toBe(false)
  })
})
