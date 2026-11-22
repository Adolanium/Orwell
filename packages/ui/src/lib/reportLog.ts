import type { DiagnosticEntry } from "./diagnostics.js"

/*
 * The log that goes with "Report a bug". A report can be anonymous and promises
 * no addresses, no channel names and no message text, and `detail` is free text
 * that holds all three. So this is a closed list, never a cleaned copy: time,
 * kind, the code and outcome when they are plain slugs, the number of channels,
 * and for an error only its name, its frames and its components.
 */
const SLUG = /^[a-z][a-z0-9._-]{0,47}$/i
const NAME = /msg="([A-Za-z]{1,40}):/
const STACK = / stack=([\w.-]+:\d+:\d+(?: < [\w.-]+:\d+:\d+)*)/
const COMPONENTS = / in=([\w$>]{1,160})$/
const HEADING = "\n\n-- log --\n"

function safePart(entry: DiagnosticEntry): string {
  const parts: string[] = [entry.kind]
  if (entry.code && SLUG.test(entry.code)) parts.push(entry.code)
  if (entry.outcome && SLUG.test(entry.outcome)) parts.push(entry.outcome)
  const detail = entry.detail ?? ""
  if (entry.kind === "channels" && /^\d{1,5}$/.test(detail)) parts.push(detail)
  if (entry.kind === "error") {
    for (const field of [NAME, STACK, COMPONENTS]) {
      const found = field.exec(detail)?.[1]
      if (found) parts.push(found)
    }
  }
  return parts.join(" ")
}

/** Oldest first. A burst of one event is one line, with how many. */
export function reportLog(entries: readonly DiagnosticEntry[]): string[] {
  const runs: { time: string; what: string; count: number }[] = []
  for (const entry of entries) {
    const what = safePart(entry)
    const previous = runs[runs.length - 1]
    if (previous?.what === what) previous.count++
    else runs.push({ time: new Date(entry.at).toISOString().slice(11, 19), what, count: 1 })
  }
  return runs.map(({ time, what, count }) => `${time} ${what}${count > 1 ? ` x${count}` : ""}`)
}

/** The newest lines that still fit in `room` characters. */
export function fittingLog(lines: readonly string[], room: number): string {
  let left = room - HEADING.length
  let first = lines.length
  while (first > 0 && lines[first - 1]!.length + 1 <= left) {
    first--
    left -= lines[first]!.length + 1
  }
  return lines.slice(first).join("\n")
}

/** It travels inside the description: the servers in use refuse a field they do not know. */
export function withReportLog(description: string, lines: readonly string[], max: number): string {
  const text = description.slice(0, max)
  const log = fittingLog(lines, max - text.length)
  return log === "" ? text : `${text}${HEADING}${log}`
}
