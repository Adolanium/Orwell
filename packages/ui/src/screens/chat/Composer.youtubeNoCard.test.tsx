import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"

/**
 * Enter before the card is born.
 *
 * In a real browser, paste and Enter can land before the card in the box
 * exists: the card is set from an effect of `LinkAttach`, a render after the
 * text. Measured live on 21/11/2026 (`scripts/e2e-youtube-thumbnails.mjs`):
 * five of seven pasted videos left as plain text, with no card at all. Here
 * the card never comes, which is that moment held still.
 */
vi.mock("./LinkAttach.js", () => ({ LinkAttach: () => null }))

const { Composer } = await import("./Composer.js")

afterEach(() => {
  cleanup()
  hostPreview.mockReset()
})

const hostPreview = vi.fn<(url: string) => Promise<{ title?: string; image?: string }>>()
const bridge = { social: { linkPreview: hostPreview } } as unknown as EnclaveBridge
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

function Harness({ onSend }: { onSend: (body: string, extras?: unknown) => void }): React.JSX.Element {
  const [value, setValue] = useState("")
  return (
    <BridgeContext.Provider value={bridge}>
      <Composer connection="online" value={value} onChange={setValue} onSend={onSend} />
    </BridgeContext.Provider>
  )
}

const box = (): HTMLTextAreaElement => screen.getByPlaceholderText(strings.chat.composerPlaceholder) as HTMLTextAreaElement

describe("Composer: Enter before the card exists", () => {
  it("a YouTube address in the text still leaves as a video card, with its thumbnail", async () => {
    hostPreview.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ title: "A video", image: PNG }), 100)))
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    fireEvent.change(box(), { target: { value: "look https://youtu.be/jNQXAC9IVRw?si=Xk3vJqPzLm8aB2cD" } })
    fireEvent.submit(box().closest("form")!)

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 4000 })
    const link = (onSend.mock.calls[0]?.[1] as { links?: { url: string; kind: string; title?: string; thumbnail?: string }[] } | undefined)?.links?.[0]
    expect(link?.url).toBe("https://youtu.be/jNQXAC9IVRw?si=Xk3vJqPzLm8aB2cD")
    expect(link?.kind).toBe("video")
    expect(link?.title).toBe("A video")
    expect(String(link?.thumbnail)).toMatch(/^data:image\//)
  })

  it("an address that is not YouTube gets no card from Enter: there the tap is the consent", () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    fireEvent.change(box(), { target: { value: "look https://exemplo.pt/artigo" } })
    fireEvent.submit(box().closest("form")!)
    expect(onSend).toHaveBeenCalledWith("look https://exemplo.pt/artigo")
    expect(hostPreview).not.toHaveBeenCalled()
  })
})
