import { describe, expect, it, vi } from "vitest"
import { quitAfterDrain } from "./quit-after-drain.js"

describe("quitAfterDrain: the second app.quit() is never in the same task", () => {
  it("with an empty queue, quit waits for a new task (not a microtask)", async () => {
    vi.useFakeTimers()
    try {
      const quit = vi.fn()
      await quitAfterDrain(() => Promise.resolve(), quit)
      // All microtasks have run here. A quit now is the re-entrant one that
      // left the process alive after SIGTERM.
      expect(quit).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(quit).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("waits for the queue first", async () => {
    let finish: () => void = () => {}
    const quit = vi.fn()
    const done = quitAfterDrain(
      () => new Promise<void>((resolve) => (finish = resolve)),
      quit,
      (task) => task(),
    )
    await Promise.resolve()
    expect(quit).not.toHaveBeenCalled()
    finish()
    await done
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it("a drain that fails still quits", async () => {
    const quit = vi.fn()
    await quitAfterDrain(() => Promise.reject(new Error("store")), quit, (task) => task())
    expect(quit).toHaveBeenCalledTimes(1)
  })
})
