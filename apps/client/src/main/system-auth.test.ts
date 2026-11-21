import { describe, expect, it, vi } from "vitest"
import { ERRO_SISTEMA_NAO_CONFIRMOU } from "@enclave/client-core"
import { confirmWithSystem } from "./system-auth.js"

describe("the system re-auth before a change without the current password", () => {
  it("macOS with Touch ID asks, with the reason", async () => {
    const promptTouchID = vi.fn(async () => {})
    expect(await confirmWithSystem({ platform: "darwin", canPromptTouchID: () => true, promptTouchID }, "change the account password")).toBe("confirmed")
    expect(promptTouchID).toHaveBeenCalledWith("change the account password")
  })

  it("a cancel or a wrong finger refuses with Erro 143", async () => {
    const auth = { platform: "darwin" as const, canPromptTouchID: () => true, promptTouchID: async () => Promise.reject(new Error("User cancelled")) }
    await expect(confirmWithSystem(auth, "x")).rejects.toThrow(ERRO_SISTEMA_NAO_CONFIRMOU)
  })

  it("Windows, Linux and a Mac without Touch ID cannot ask: the open vault is the only proof", async () => {
    const promptTouchID = vi.fn(async () => {})
    for (const [platform, can] of [["win32", true], ["linux", true], ["darwin", false]] as const) {
      expect(await confirmWithSystem({ platform, canPromptTouchID: () => can, promptTouchID }, "x")).toBe("not-available")
    }
    expect(promptTouchID).not.toHaveBeenCalled()
  })
})
