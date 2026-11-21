import { beforeEach, describe, expect, it } from "vitest"
import type { EnclaveBridge } from "../bridge.js"
import { ACCOUNT_NAMES_KEY, activeAccountId, forgetAccountName, rememberAccountName, SINGLE_ACCOUNT_ID, storedAccountName } from "./accountNames.js"

beforeEach(() => localStorage.clear())

describe("account names outside the vault", () => {
  it("stores, updates and forgets the name of each account by id", () => {
    rememberAccountName("a", "Duarte")
    rememberAccountName("b", "Helena")
    expect(storedAccountName("a")).toBe("Duarte")
    rememberAccountName("a", "  Duarte B ")
    expect(storedAccountName("a")).toBe("Duarte B")
    forgetAccountName("a")
    expect(storedAccountName("a")).toBe("")
    expect(storedAccountName("b")).toBe("Helena")
  })

  it("keeps only names: a damaged entry reads as none", () => {
    localStorage.setItem(ACCOUNT_NAMES_KEY, "{broken")
    expect(storedAccountName("a")).toBe("")
    localStorage.setItem(ACCOUNT_NAMES_KEY, JSON.stringify({ a: 3, b: "Rui" }))
    expect(storedAccountName("a")).toBe("")
    expect(storedAccountName("b")).toBe("Rui")
  })

  it("the active account id comes from the device list, or the single account without one", async () => {
    const withList = {
      contas: { listar: async () => ({ contas: [{ id: "x", activa: false }, { id: "y", activa: true }] }) },
    } as unknown as EnclaveBridge
    expect(await activeAccountId(withList)).toBe("y")
    expect(await activeAccountId({} as EnclaveBridge)).toBe(SINGLE_ACCOUNT_ID)
  })
})
