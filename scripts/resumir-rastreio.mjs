// A Chromium trace, summed by event name on the renderer's main thread: how much
// of a stretch is style (UpdateLayoutTree), layout, prepaint, paint, script.
// Only events at least `minMs` long are listed one by one, in order.
//
//   node scripts/resumir-rastreio.mjs <trace.json> [minMs=8]
import { readFileSync } from "node:fs"

const { traceEvents } = JSON.parse(readFileSync(process.argv[2], "utf8"))
const MIN_MS = Number(process.argv[3] ?? 8)
const fios = new Map()
for (const e of traceEvents) if (e.name === "thread_name" && e.args?.name === "CrRendererMain") fios.set(`${e.pid}:${e.tid}`, true)
const doFio = traceEvents.filter((e) => e.ph === "X" && fios.has(`${e.pid}:${e.tid}`) && typeof e.dur === "number")
if (doFio.length === 0) {
  console.log("no renderer main thread events")
  process.exit(0)
}
const inicio = Math.min(...doFio.map((e) => e.ts))
const soma = new Map()
for (const e of doFio) soma.set(e.name, (soma.get(e.name) ?? 0) + e.dur)
console.log("TOTAL by name (includes nesting)")
for (const [k, v] of [...soma].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(v / 1000).toFixed(1).padStart(8)} ms  ${k}`)
console.log(`\nEvents of ${MIN_MS} ms or more (ms from the first event)`)
for (const e of doFio.filter((x) => x.dur / 1000 >= MIN_MS).sort((a, b) => a.ts - b.ts)) {
  const detalhe = e.args?.data?.type ?? e.args?.data?.functionName ?? ""
  console.log(`${((e.ts - inicio) / 1000).toFixed(0).padStart(6)}  ${(e.dur / 1000).toFixed(1).padStart(7)} ms  ${e.name} ${detalhe}`)
}
