import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { ProfileEditor } from "./ProfileEditor.js"

afterEach(cleanup)

/**
 * The own portrait in the media store (Task 10): the profile brings
 * `avatarRef` and not `avatarDataUrl`. The sheet shows it through the store,
 * saves it without losing it, and "Remove" really removes it.
 */
function montar() {
  const set = vi.fn(async (_perfil: Profile) => ({ ok: true }))
  const bytes = vi.fn(async () => new Uint8Array([137, 80, 78, 71]))
  const bridge = { profile: { set }, media: { bytes, fixar: vi.fn(async () => {}), soltar: vi.fn(async () => {}) }, on: {} } as unknown as EnclaveBridge
  const inicial: Profile = { displayName: "Ana", donations: [], updatedAt: 1, avatarRef: `retrato-${Math.random()}` }
  const { container } = render(
    <BridgeContext.Provider value={bridge}>
      <ConfirmarProvider>
        <ProfileEditor initial={inicial} address="@ana:casa.pt" onSaved={vi.fn()} onClose={vi.fn()} />
      </ConfirmarProvider>
    </BridgeContext.Provider>,
  )
  return { set, bytes, container, inicial }
}

describe("ProfileEditor: o retrato no armazém de media", () => {
  it("mostra o retrato pela referência, e Remover tira a referência", async () => {
    const { set, bytes, container, inicial } = montar()
    await waitFor(() => expect(container.querySelector(".avatar-preview img")?.getAttribute("src")).toBeTruthy())
    expect(bytes).toHaveBeenCalledWith(inicial.avatarRef)
    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.remove }))
    expect(container.querySelector(".avatar-preview img")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(set.mock.calls[0]?.[0]).not.toHaveProperty("avatarRef")
  })
})
