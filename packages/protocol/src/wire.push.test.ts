import { describe, expect, it } from "vitest"
import {
  CALAR_PARA_SEMPRE,
  CAPACIDADE_WEB_PUSH,
  ClientFrame,
  PUSH_SILENCIADOS_MAX,
  RAZOES_DE_RECUSA_DO_PUSH,
  ServerFrame,
} from "./wire.js"

/**
 * The `push.*` frames on the wire (Web Push).
 *
 * What is asserted: the contract names, the request and reply shapes, the
 * schema limits (endpoint, keys, muted list, language), and that the frames
 * from before still pass unchanged through the new union.
 */
const P256DH = "B" + "A".repeat(86) // 65 bytes in base64url
const AUTH = "A".repeat(22) // 16 bytes

const subscricao = {
  t: "push.subscribe",
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: P256DH,
  auth: AUTH,
  lingua: "pt",
  silenciados: ["!x:casa.pt"],
  calarAte: 0,
} as const

describe("push.* no fio", () => {
  it("os nomes do contrato não mudam", () => {
    expect(CAPACIDADE_WEB_PUSH).toBe("web-push")
    expect(RAZOES_DE_RECUSA_DO_PUSH).toEqual(["push-off", "no-device", "endpoint-not-allowed", "bad-keys", "rate-limited"])
    expect(CALAR_PARA_SEMPRE).toBe(Number.MAX_SAFE_INTEGER)
  })

  it("as três tramas do cliente passam", () => {
    expect(ClientFrame.parse({ t: "push.key.get" })).toEqual({ t: "push.key.get" })
    expect(ClientFrame.parse(subscricao)).toMatchObject(subscricao)
    expect(ClientFrame.parse({ ...subscricao, expiresAt: 1_800_000_000_000 })).toMatchObject({ expiresAt: 1_800_000_000_000 })
    expect(ClientFrame.parse({ t: "push.unsubscribe" })).toEqual({ t: "push.unsubscribe" })
  })

  it("as três respostas do servidor passam", () => {
    expect(ServerFrame.parse({ t: "push.key", publicKey: P256DH })).toEqual({ t: "push.key", publicKey: P256DH })
    expect(ServerFrame.parse({ t: "push.key", publicKey: null })).toEqual({ t: "push.key", publicKey: null })
    expect(ServerFrame.parse({ t: "push.subscribed", ok: true })).toEqual({ t: "push.subscribed", ok: true })
    expect(ServerFrame.parse({ t: "push.subscribed", ok: false, reason: "no-device" })).toMatchObject({ reason: "no-device" })
    expect(ServerFrame.parse({ t: "push.unsubscribed" })).toEqual({ t: "push.unsubscribed" })
  })

  it("só leva a língua pt ou en", () => {
    expect(ClientFrame.safeParse({ ...subscricao, lingua: "fr" }).success).toBe(false)
  })

  it("o endpoint é https e tem limite de tamanho", () => {
    expect(ClientFrame.safeParse({ ...subscricao, endpoint: "http://fcm.googleapis.com/x" }).success).toBe(false)
    expect(ClientFrame.safeParse({ ...subscricao, endpoint: `https://a.b/${"x".repeat(2048)}` }).success).toBe(false)
  })

  it("as chaves têm o tamanho certo em base64url", () => {
    expect(ClientFrame.safeParse({ ...subscricao, p256dh: "A".repeat(80) }).success).toBe(false)
    expect(ClientFrame.safeParse({ ...subscricao, auth: "A".repeat(21) }).success).toBe(false)
    expect(ClientFrame.safeParse({ ...subscricao, auth: "A+".repeat(11) }).success).toBe(false)
  })

  it("a lista de silenciados tem tecto, e calarAte é um instante válido", () => {
    const muitos = Array.from({ length: PUSH_SILENCIADOS_MAX + 1 }, (_, i) => `!c${i}:casa.pt`)
    expect(ClientFrame.safeParse({ ...subscricao, silenciados: muitos }).success).toBe(false)
    expect(ClientFrame.safeParse({ ...subscricao, calarAte: -1 }).success).toBe(false)
    expect(ClientFrame.safeParse({ ...subscricao, calarAte: CALAR_PARA_SEMPRE }).success).toBe(true)
  })

  it("as tramas de antes continuam a passar", () => {
    expect(ClientFrame.parse({ t: "ping" })).toEqual({ t: "ping" })
    expect(ServerFrame.parse({ t: "pong" })).toEqual({ t: "pong" })
  })
})
