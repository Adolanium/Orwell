import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { Composer } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"

/**
 * A YouTube message held for its preview is not lost (1.3.26 review, note 9).
 *
 * Enter empties the box at once, and the message waits up to five seconds for
 * the thumbnail. Two ways it vanished:
 *  - the page went away in those seconds (a reload, a closed tab, iOS putting
 *    it in the back-forward cache): the waiting message never left. It now
 *    leaves at once on `pagehide`, with the card it has;
 *  - `onSend` failed: the error was swallowed. The composer now says so
 *    (Error 370), and puts the text back if the box is still empty.
 */

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  hostPreview.mockReset()
})

const hostPreview = vi.fn<(url: string) => Promise<{ title?: string; image?: string }>>()
const bridge = { social: { linkPreview: hostPreview } } as unknown as EnclaveBridge

function Harness({ onSend }: { onSend: (body: string, extras?: unknown) => void }): React.JSX.Element {
  const [value, setValue] = useState("")
  return (
    <StrictMode>
      <BridgeContext.Provider value={bridge}>
        <Composer connection="online" value={value} onChange={setValue} onSend={onSend} />
      </BridgeContext.Provider>
    </StrictMode>
  )
}

const box = (): HTMLTextAreaElement => screen.getByPlaceholderText(strings.chat.composerPlaceholder) as HTMLTextAreaElement

function pasteAndSend(text: string): void {
  fireEvent.change(box(), { target: { value: text } })
  fireEvent.submit(box().closest("form")!)
}

const URL_DO_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

describe("Composer: a held YouTube message is not lost", () => {
  it("leaves at once when the page hides, with the card it has", async () => {
    // The host never answers: the message would wait the whole five seconds.
    hostPreview.mockImplementation(() => new Promise(() => {}))
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend(`look ${URL_DO_VIDEO}`)
    expect(onSend).not.toHaveBeenCalled()

    window.dispatchEvent(new Event("pagehide"))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(onSend.mock.calls[0]?.[0]).toBe(`look ${URL_DO_VIDEO}`)
    expect((onSend.mock.calls[0]?.[1] as { links?: { url: string }[] }).links?.[0]?.url).toBe(URL_DO_VIDEO)
  })

  it("a send that fails while held is said in the composer, not swallowed", async () => {
    hostPreview.mockResolvedValue({ title: "A video" })
    const onSend = vi.fn(() => {
      throw new Error("the message could not be sent")
    })
    render(<Harness onSend={onSend} />)
    pasteAndSend(`look ${URL_DO_VIDEO}`)

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 4000 })
    await waitFor(() => expect(screen.getByText(/370/)).toBeTruthy())
    // The box was still empty: the text the person typed comes back.
    expect(box().value).toBe(`look ${URL_DO_VIDEO}`)
  })
})
