import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge, Profile } from "../bridge.js"
import { profileFromPayload, useDirectory } from "./useDirectory.js"

/**
 * The portraits out of the vault (Task 10, design §8): the directory brings
 * `avatar` with `{ ref, mini }`; the lists ask the store for the THUMBNAIL
 * through the media cache, and the interface still speaks `avatarDataUrl`.
 */

describe("os retratos pelo armazém de media", () => {
  it("profileFromPayload guarda a referência e a miniatura do retrato", () => {
    const perfil = profileFromPayload({ t: "profile", displayName: "Ana", avatar: { ref: "r-ana", mini: "m-ana", name: "avatar" }, donations: [] })
    expect(perfil).toMatchObject({ avatarRef: "r-ana", avatarMini: "m-ana" })
    expect("avatarDataUrl" in perfil).toBe(false)
    // The own profile, as the vault keeps it.
    expect(profileFromPayload({ displayName: "Eu", avatarRef: "r-eu" }).avatarRef).toBe("r-eu")
  })

  it("useDirectory resolve o avatarRef pela miniatura, e o perfil próprio pelo ref", async () => {
    const sufixo = Math.random().toString(36).slice(2)
    const bytes = vi.fn(async (sha: string) => (sha.startsWith("m-") || sha.startsWith("r-eu") ? new Uint8Array([1, 2]) : null))
    const bridge = { media: { bytes, fixar: vi.fn(), soltar: vi.fn() }, on: {} } as unknown as EnclaveBridge
    const seed = new Map<string, Profile>([["@ana:s", { displayName: "Ana", donations: [], avatarRef: `r-ana-${sufixo}`, avatarMini: `m-ana-${sufixo}` }]])
    const self = { address: "@eu:s", profile: { displayName: "Eu", donations: [], avatarRef: `r-eu-${sufixo}` } as Profile }
    const embrulho = ({ children }: { children: ReactNode }) => <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>
    const { result } = renderHook(() => useDirectory([], seed, self), { wrapper: embrulho })
    await waitFor(() => expect(result.current.directory.get("@ana:s")?.avatarDataUrl).toBeTruthy())
    await waitFor(() => expect(result.current.directory.get("@eu:s")?.avatarDataUrl).toBeTruthy())
    expect(bytes).toHaveBeenCalledWith(`m-ana-${sufixo}`)
    expect(bytes).not.toHaveBeenCalledWith(`r-ana-${sufixo}`)
    expect(bytes).toHaveBeenCalledWith(`r-eu-${sufixo}`)
    // The profile that came from outside does not change: the resolved face lives only in the directory.
    expect(seed.get("@ana:s")?.avatarDataUrl).toBeUndefined()
    expect(self.profile.avatarDataUrl).toBeUndefined()
  })
})
