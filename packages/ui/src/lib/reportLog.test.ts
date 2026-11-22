import { describe, expect, it } from "vitest"
import type { DiagnosticEntry } from "./diagnostics.js"
import { reportLog, withReportLog } from "./reportLog.js"

const at = Date.UTC(2026, 10, 22, 14, 43, 13)

describe("the log of a bug report", () => {
  it("carries times, codes and where an error was, and none of the free text", () => {
    const entries: DiagnosticEntry[] = [
      { at, kind: "status", code: "channel-deleted", channel: "secretroomid", detail: "channel-deleted: The Vine" },
      { at, kind: "action", code: "call-disconnected", detail: "@k4x7m2pq8rtvwxyz:orwell.pt" },
      { at, kind: "action", code: "@someone:orwell.pt", outcome: "two words" },
      { at, kind: "channels", detail: "17" },
      { at, kind: "error", code: "screen-crash", detail: 'v=1.3.28 sync=no msg="SyntaxError: hello world is not JSON" stack=index-AbCd.js:12:345 < index-AbCd.js:6:7 in=Shell>App' },
    ]
    const text = reportLog(entries).join("\n")
    for (const kept of ["14:43:13", "channel-deleted", "call-disconnected", "17", "SyntaxError", "index-AbCd.js:12:345 < index-AbCd.js:6:7", "Shell>App"]) expect(text).toContain(kept)
    for (const gone of ["The Vine", "secretroomid", "k4x7m2pq", "someone", "two words", "hello world"]) expect(text).not.toContain(gone)
  })

  it("says a repeated event once, with how many", () => {
    const lines = reportLog(Array.from({ length: 98 }, (): DiagnosticEntry => ({ at, kind: "message", code: "voice.leave" })))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("x98")
  })

  it("fits in the description and keeps the newest lines", () => {
    const lines = Array.from({ length: 200 }, (_, n) => `line-${n} ${"x".repeat(40)}`)
    const text = withReportLog("It stopped.", lines, 4000)
    expect(text.length).toBeLessThanOrEqual(4000)
    expect(text.startsWith("It stopped.")).toBe(true)
    expect(text).toContain("line-199 ")
    expect(text).not.toContain("line-0 ")
  })
})
