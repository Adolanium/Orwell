import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { Composer, VIDEO_PREVIEW_WAIT_MS } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"

/**
 * "Many YouTube thumbnails are still blank" (21/11/2026).
 *
 * People paste a video link and press Enter at once. The preview (title and
 * thumbnail) comes from the host about a second later: the composer sent the
 * card as it was at Enter, with no thumbnail, and nothing filled it after the
 * message left. These tests paste and submit in the same instant.
 */

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  hostPreview.mockReset()
})

const hostPreview = vi.fn<(url: string) => Promise<{ title?: string; siteName?: string; image?: string }>>()
const bridge = { social: { linkPreview: hostPreview } } as unknown as EnclaveBridge

/** A 1×1 PNG: what the host returns after fetching i.ytimg.com. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

/** The host answers after `ms`, like the homeserver or the main process does. */
function hostAnswersAfter(ms: number): void {
  hostPreview.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve({ title: "A video", siteName: "Someone", image: PNG }), ms)),
  )
}

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

/** Paste and Enter in the same instant: no time for any preview to arrive. */
function pasteAndSend(text: string): void {
  fireEvent.change(box(), { target: { value: text } })
  fireEvent.submit(box().closest("form")!)
}

type Sent = { links?: { url: string; kind?: string; title?: string; thumbnail?: unknown }[] }
const linkOf = (call: unknown[] | undefined) => (call?.[1] as Sent | undefined)?.links?.[0]

/** Every URL form people paste, with the identifier the card must keep. */
const FORMS: [string, string][] = [
  ["watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["no www", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
  ["youtu.be", "https://youtu.be/jNQXAC9IVRw"],
  ["youtu.be with ?si=", "https://youtu.be/jNQXAC9IVRw?si=Xk3vJqPzLm8aB2cD"],
  ["youtu.be with ?si= and &t=", "https://youtu.be/jNQXAC9IVRw?si=Xk3vJqPzLm8aB2cD&t=12"],
  ["watch with &t=", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"],
  ["watch with a playlist", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL0123456789&index=2"],
  ["v= not first", "https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ"],
  ["shorts", "https://www.youtube.com/shorts/aqz-KE-bpKQ"],
  ["shorts with ?si=", "https://youtube.com/shorts/aqz-KE-bpKQ?si=abc123"],
  ["live", "https://www.youtube.com/live/aqz-KE-bpKQ"],
  ["live with ?si=", "https://www.youtube.com/live/aqz-KE-bpKQ?si=abc123&feature=share"],
  ["m.youtube.com", "https://m.youtube.com/watch?v=kJQP7kiw5Fk"],
  ["m.youtube.com with &t=", "https://m.youtube.com/watch?v=kJQP7kiw5Fk&t=10"],
  ["music.youtube.com", "https://music.youtube.com/watch?v=9bZkp7q19f0&si=abc123"],
  ["embed", "https://www.youtube.com/embed/aqz-KE-bpKQ"],
]

describe("Composer: a YouTube link pasted and sent at once keeps its thumbnail", () => {
  it.each(FORMS)("%s: the message leaves with the thumbnail and the title", async (_form, url) => {
    hostAnswersAfter(300)
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend(`look ${url}`)

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 4000 })
    const link = linkOf(onSend.mock.calls[0])
    expect(link?.url).toBe(url)
    expect(link?.kind).toBe("video")
    expect(link?.title).toBe("A video")
    expect(String(link?.thumbnail)).toMatch(/^data:image\//)
    // One request for the video, not one from the box and another from Enter.
    expect(hostPreview).toHaveBeenCalledTimes(1)
  })

  it("the box empties at once: Enter does not wait in front of the person", () => {
    hostAnswersAfter(300)
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend("look https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(box().value).toBe("")
  })

  it("a message written right after the video does not overtake it", async () => {
    hostAnswersAfter(300)
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend("first https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    pasteAndSend("second, plain text")

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2), { timeout: 4000 })
    expect(onSend.mock.calls[0]?.[0]).toBe("first https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(String(linkOf(onSend.mock.calls[0])?.thumbnail)).toMatch(/^data:image\//)
    expect(onSend.mock.calls[1]?.[0]).toBe("second, plain text")
  })

  it("a host that never answers holds the message only up to the cap, then it leaves playable", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    hostPreview.mockImplementation(() => new Promise(() => {}))
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend("look https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VIDEO_PREVIEW_WAIT_MS - 100)
    })
    expect(onSend).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(linkOf(onSend.mock.calls[0])).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "video" })
  })

  it("a host that refuses lets the message go at once, with the playable card", async () => {
    hostPreview.mockRejectedValue(new Error("the host could not"))
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend("look https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(linkOf(onSend.mock.calls[0])).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "video" })
  })

  it("a link that is not YouTube is never fetched on Enter: there the tap is the consent", () => {
    hostAnswersAfter(10)
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend("look https://exemplo.pt/artigo")
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(hostPreview).not.toHaveBeenCalled()
  })

  it("plain text still leaves at once, as before", () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    pasteAndSend("just words")
    expect(onSend).toHaveBeenCalledWith("just words")
  })
})
