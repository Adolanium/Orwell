import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { CallPanel } from "./CallPanel.js"

/**
 * Our own portrait in a call, when the profile holds it by reference.
 *
 * Since the media store (13/11/2026) our own profile can carry `avatarRef` and no
 * `avatarDataUrl`. Other people's profiles go through `useDirectory`, which turns
 * the reference into a picture; ours came to the panel raw, and the card and the
 * tile only look for `avatarDataUrl`. On the Windows app our own card in the call
 * showed the initial instead of the portrait (17/11/2026).
 */

afterEach(cleanup)

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

function montar() {
  const bytes = vi.fn(async () => new Uint8Array([137, 80, 78, 71]))
  const bridge = { media: { bytes, fixar: vi.fn(async () => {}), soltar: vi.fn(async () => {}) }, on: {} } as unknown as EnclaveBridge
  const perfil: Profile = { displayName: "Eu", donations: [], updatedAt: 1, avatarRef: `retrato-${Math.random()}` }
  const { container } = render(
    <BridgeContext.Provider value={bridge}>
      <CallPanel
        call={{ setMuted: () => {}, setCameraOff: () => {} } as unknown as EnclaveBridge["call"]}
        channel="!geral:s"
        participants={[{ address: "@ana:s", connected: true, stream: null } as Participant]}
        localStream={null}
        selfLabel="Eu"
        selfProfile={perfil}
        nameFor={(sender) => sender}
        directory={new Map()}
        onToggleMic={() => {}}
        onToggleSound={() => {}}
        onLeave={() => {}}
      />
    </BridgeContext.Provider>,
  )
  return { bytes, container, perfil }
}

describe("CallPanel: o nosso retrato pela referência", () => {
  it("o nosso cartão na chamada mostra o retrato do armazém, e não a inicial", async () => {
    const { bytes, container, perfil } = montar()
    const nosso = (): Element | null => container.querySelector(".call-people .call-person")
    await waitFor(() => expect(nosso()?.querySelector("img")?.getAttribute("src")).toBeTruthy())
    expect(bytes).toHaveBeenCalledWith(perfil.avatarRef)
  })
})
