// @vitest-environment node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The session `members` event has its own IPC channel (1.3.26 review, finding 3).
 *
 * On `event:epoch` it reached the renderer's `call.rekey`. The renderer side is
 * pinned in `renderer/bridge.membros.test.ts`; this pins the channel itself.
 */
const main = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8")
const preload = readFileSync(fileURLToPath(new URL("../preload/index.ts", import.meta.url)), "utf8")

describe("members IPC channel", () => {
  it("the main process sends members on event:members, never on event:epoch", () => {
    expect(main).toMatch(/session\.on\("members", \(evento\) => window\.webContents\.send\("event:members", evento\)\)/)
    expect(main).not.toMatch(/session\.on\("members"[^\n]*"event:epoch"/)
  })

  it("the preload subscribes event:members apart from event:epoch", () => {
    expect(preload).toMatch(/members: \(handler: \(payload: unknown\) => void\) => subscribe\("event:members", handler\)/)
  })
})
