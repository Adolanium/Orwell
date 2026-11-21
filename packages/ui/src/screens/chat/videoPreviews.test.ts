import { describe, expect, it, vi } from "vitest"
import { VideoPreviews, withinMs } from "./videoPreviews.js"

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

/** A host whose answers the test releases by hand. */
function heldHost() {
  const waiting: { url: string; release: () => void }[] = []
  const viaHost = vi.fn(
    (url: string) =>
      new Promise<{ title: string; image: string }>((resolve) => {
        waiting.push({ url, release: () => resolve({ title: url, image: PNG }) })
      }),
  )
  return { viaHost, waiting }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("VideoPreviews", () => {
  it("one request per video: &t= and ?si= are the same video", async () => {
    const { viaHost, waiting } = heldHost()
    const previews = new VideoPreviews(viaHost)
    const a = previews.of("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    const b = previews.of("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")
    const c = previews.of("https://youtu.be/dQw4w9WgXcQ?si=abc")
    expect(a).toBe(b)
    expect(a).toBe(c)
    await flush()
    expect(viaHost).toHaveBeenCalledTimes(1)
    waiting[0]?.release()
    await expect(a).resolves.toMatchObject({ thumbnail: PNG })
  })

  it("not YouTube: no promise and no request", () => {
    const { viaHost } = heldHost()
    expect(new VideoPreviews(viaHost).of("https://exemplo.pt/artigo")).toBeNull()
    expect(viaHost).not.toHaveBeenCalled()
  })

  it("never more than two requests in flight: the server refuses a third at once", async () => {
    // `PREVIEWS_AT_ONCE` on the homeserver is 2. Videos pasted one after another
    // asked for more, and every one past the second came back "too many requests"
    // and left with a blank card (measured live, 21/11/2026).
    const { viaHost, waiting } = heldHost()
    const previews = new VideoPreviews(viaHost)
    const ids = ["dQw4w9WgXcQ", "jNQXAC9IVRw", "aqz-KE-bpKQ", "kJQP7kiw5Fk", "9bZkp7q19f0"]
    const all = ids.map((id) => previews.of(`https://www.youtube.com/watch?v=${id}`) as Promise<{ title?: string }>)
    await flush()
    expect(viaHost).toHaveBeenCalledTimes(2)

    for (let round = 0; round < 3; round++) {
      for (const w of waiting.splice(0)) w.release()
      await flush()
      await flush()
      expect(waiting.length).toBeLessThanOrEqual(2)
    }
    const done = await Promise.all(all)
    expect(viaHost).toHaveBeenCalledTimes(5)
    expect(done.map((d) => d.title)).toEqual(ids.map((id) => `https://www.youtube.com/watch?v=${id}`))
  })

  it("a failure is forgotten, so the next ask tries again, and it frees its place", async () => {
    const viaHost = vi.fn().mockRejectedValueOnce(new Error("no")).mockResolvedValue({ title: "ok", image: PNG })
    const previews = new VideoPreviews(viaHost)
    await expect(previews.of("https://youtu.be/jNQXAC9IVRw")).rejects.toThrow()
    await expect(previews.of("https://youtu.be/jNQXAC9IVRw")).resolves.toMatchObject({ title: "ok" })
    expect(viaHost).toHaveBeenCalledTimes(2)
  })
})

describe("withinMs", () => {
  it("the value, null on failure, null after the time", async () => {
    await expect(withinMs(Promise.resolve(1), 50)).resolves.toBe(1)
    await expect(withinMs(Promise.reject(new Error("x")), 50)).resolves.toBeNull()
    await expect(withinMs(new Promise(() => {}), 20)).resolves.toBeNull()
  })
})
