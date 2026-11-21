import {
  pairCodeBoxKey,
  pairCodeCi,
  encodePake,
  cpaceStart,
  cpaceFinish,
  decifrarPairPayload,
  decodePake,
  generateIdentity,
  parseServerName,
  pairCodePrs,
  type ClientFrame,
  type ServerFrame,
} from "@enclave/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AnfitriaoDeEmparelhamento, type PairEvento } from "./emparelhar.js"

/**
 * The side with the account in a short-code pairing, against a new device
 * played by hand (CPace initiator in the test, `cpace.ts`).
 *
 * What is measured: the right code gives the box key and the pairing goes on
 * as with a QR; a wrong code (or a forged tag) kills the box at once, with
 * `pair.close`, and this side never sends anything encrypted; garbage during
 * CPace kills it too; and the box never gets a second CPace run.
 */

const PAIR_ID = "QUJDREVGR0hJSktMTU5PUF"
const CODE = "K7P4QM"

function setUp(code = CODE) {
  const identity = generateIdentity(parseServerName("localhost"))
  const sent: ClientFrame[] = []
  const events: PairEvento[] = []
  const host = new AnfitriaoDeEmparelhamento(
    identity,
    "localhost",
    () => "",
    (frame) => sent.push(frame),
    (event) => events.push(event),
    {
      confirmarEspaco: async () => {},
      publicarManifestoCom: async () => {},
      assentar: async () => {},
    },
    { code },
  )
  const receive = (frame: ServerFrame): boolean => host.receber(frame)
  return { host, sent, events, receive, identity }
}

function sentPake(sent: ClientFrame[]) {
  return sent
    .filter((frame): frame is Extract<ClientFrame, { t: "pair.send" }> => frame.t === "pair.send")
    .map((frame) => decodePake(frame.payload))
}

afterEach(() => vi.useRealTimers())

describe("the account side of a short-code pairing", () => {
  it("joins by the nameplate, never sends the code", () => {
    const { host, sent } = setUp()
    host.abrir()
    expect(sent).toEqual([{ t: "pair.code.join", nameplate: "K7" }])
    expect(JSON.stringify(sent)).not.toContain("P4QM")
  })

  it("the right code: confirms both ways, then the box key carries the device key", () => {
    const { host, sent, events, receive, identity } = setUp()
    host.abrir()
    receive({ t: "pair.code.joined", nameplate: "K7", pairId: PAIR_ID })
    expect(events).toContainEqual({ fase: "ligado" })
    expect(host.pairId).toBe(PAIR_ID)

    const newDevice = cpaceStart(pairCodePrs(CODE), pairCodeCi())
    receive({ t: "pair.message", pairId: PAIR_ID, payload: encodePake({ t: "pake-a", ...newDevice.message }) })
    const reply = sentPake(sent).at(-1)
    expect(reply?.t).toBe("pake-b")
    if (reply?.t !== "pake-b") throw new Error("no pake-b")
    const result = cpaceFinish(newDevice, { y: reply.y })!
    expect(result.verifyPeerTag(reply.tag)).toBe(true)

    receive({ t: "pair.message", pairId: PAIR_ID, payload: encodePake({ t: "pake-tag", tag: result.tag }) })
    const last = sent.at(-1)
    expect(last?.t).toBe("pair.send")
    const key = pairCodeBoxKey(result.isk, PAIR_ID)
    const opened = decifrarPairPayload(key, PAIR_ID, (last as Extract<ClientFrame, { t: "pair.send" }>).payload)
    expect(opened).toMatchObject({ t: "chave-do-aparelho" })
    expect(host.acabou).toBe(false)
    void identity
  })

  it("a wrong code: the new device's tag does not verify, the box closes, nothing encrypted leaves", () => {
    const { host, sent, events, receive } = setUp("K7P4QN")
    host.abrir()
    receive({ t: "pair.code.joined", nameplate: "K7", pairId: PAIR_ID })
    const newDevice = cpaceStart(pairCodePrs(CODE), pairCodeCi())
    receive({ t: "pair.message", pairId: PAIR_ID, payload: encodePake({ t: "pake-a", ...newDevice.message }) })
    const reply = sentPake(sent).at(-1)
    if (reply?.t !== "pake-b") throw new Error("no pake-b")
    const result = cpaceFinish(newDevice, { y: reply.y })!
    // The new device sees the wrong tag too; a liar sends its own tag anyway.
    expect(result.verifyPeerTag(reply.tag)).toBe(false)
    receive({ t: "pair.message", pairId: PAIR_ID, payload: encodePake({ t: "pake-tag", tag: result.tag }) })
    expect(sent.at(-1)).toEqual({ t: "pair.close", pairId: PAIR_ID })
    expect(events.at(-1)).toEqual({ fase: "falhou", razao: "wrong-code" })
    expect(host.acabou).toBe(true)
    expect(sentPake(sent).filter((m) => m === null)).toHaveLength(0)
  })

  it("no second CPace run in the same box", () => {
    const { host, sent, receive } = setUp()
    host.abrir()
    receive({ t: "pair.code.joined", nameplate: "K7", pairId: PAIR_ID })
    const first = cpaceStart(pairCodePrs(CODE), pairCodeCi())
    receive({ t: "pair.message", pairId: PAIR_ID, payload: encodePake({ t: "pake-a", ...first.message }) })
    const before = sent.length
    // A second Ya: this is a second guess. The box dies.
    const second = cpaceStart(pairCodePrs(CODE), pairCodeCi())
    receive({ t: "pair.message", pairId: PAIR_ID, payload: encodePake({ t: "pake-a", ...second.message }) })
    expect(sent.slice(before)).toEqual([{ t: "pair.close", pairId: PAIR_ID }])
    expect(host.acabou).toBe(true)
  })

  it("garbage during CPace kills the box", () => {
    const { host, sent, events, receive } = setUp()
    host.abrir()
    receive({ t: "pair.code.joined", nameplate: "K7", pairId: PAIR_ID })
    receive({ t: "pair.message", pairId: PAIR_ID, payload: "bGl4bw" })
    expect(sent.at(-1)).toEqual({ t: "pair.close", pairId: PAIR_ID })
    expect(events.at(-1)).toEqual({ fase: "falhou", razao: "wrong-code" })
  })

  it("the new device closing during CPace reads as a wrong code", () => {
    const { host, events, receive } = setUp()
    host.abrir()
    receive({ t: "pair.code.joined", nameplate: "K7", pairId: PAIR_ID })
    receive({ t: "pair.closed", pairId: PAIR_ID, reason: "closed" })
    expect(events.at(-1)).toEqual({ fase: "falhou", razao: "wrong-code" })
  })

  it("an unknown code, and the account ceiling", () => {
    const first = setUp()
    first.host.abrir()
    first.receive({ t: "pair.code.rejected", nameplate: "K7", reason: "unknown" })
    expect(first.events.at(-1)).toEqual({ fase: "falhou", razao: "unknown-code" })
    const second = setUp()
    second.host.abrir()
    second.receive({ t: "pair.code.rejected", nameplate: "K7", reason: "rate-limited" })
    expect(second.events.at(-1)).toEqual({ fase: "falhou", razao: "recusado:rate-limited" })
  })

  it("the new device must speak within the deadline", () => {
    vi.useFakeTimers()
    const { host, events, receive } = setUp()
    host.abrir()
    receive({ t: "pair.code.joined", nameplate: "K7", pairId: PAIR_ID })
    vi.advanceTimersByTime(16_000)
    expect(events.at(-1)).toEqual({ fase: "falhou", razao: "tempo-esgotado" })
  })
})
