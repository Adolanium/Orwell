import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Composer } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"

afterEach(cleanup)

/**
 * The composer of a new account in the common room (1.3.26): it says why, and
 * images and files cannot be chosen there in the first 24 hours.
 */
const bridge = { social: { linkPreview: vi.fn().mockRejectedValue(new Error("não")) } } as unknown as EnclaveBridge

describe("o composer de uma conta nova na sala comum", () => {
  it("diz o aviso e não deixa escolher imagens nem ficheiros", () => {
    const { container } = render(
      <BridgeContext.Provider value={bridge}>
        <Composer connection="online" value="" onChange={vi.fn()} onSend={vi.fn()} avisoDeContaNova={strings.contaNova.avisoNaSala} />
      </BridgeContext.Provider>,
    )
    expect(screen.getByText(strings.contaNova.avisoNaSala)).toBeTruthy()
    const campos = [...container.querySelectorAll('input[type="file"]')] as HTMLInputElement[]
    expect(campos.length).toBe(2)
    expect(campos.every((campo) => campo.disabled)).toBe(true)
  })

  it("sem o aviso, como sempre", () => {
    const { container } = render(
      <BridgeContext.Provider value={bridge}>
        <Composer connection="online" value="" onChange={vi.fn()} onSend={vi.fn()} />
      </BridgeContext.Provider>,
    )
    const campos = [...container.querySelectorAll('input[type="file"]')] as HTMLInputElement[]
    expect(campos.some((campo) => campo.disabled)).toBe(false)
  })
})
