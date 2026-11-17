// The busy stretches of a .cpuprofile: each run of non-idle samples longer than
// `minMs`, with the functions that took the most total time inside it. A long
// stretch in the main process is time the window's synchronous reads wait for.
//
//   node scripts/blocos-perfil-cpu.mjs <file.cpuprofile> [minMs=50] [functions per stretch=12] [--programa]
//
// `--programa` counts "(program)" as busy: in a renderer that is style, layout
// and paint, which are not JavaScript but block the thread all the same. In the
// main process leave it out, there it is mostly the event loop waiting.
import { readFileSync } from "node:fs"

const p = JSON.parse(readFileSync(process.argv[2], "utf8"))
const posicionais = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const MIN_MS = Number(posicionais[1] ?? 50)
const TOPO = Number(posicionais[2] ?? 12)
const porId = new Map(p.nodes.map((n) => [n.id, n]))
const pai = new Map()
for (const n of p.nodes) for (const c of n.children ?? []) pai.set(c, n.id)
const nome = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`
// Garbage collection counts as busy: it blocks the thread like anything else.
const PROGRAMA_OCUPADO = process.argv.includes("--programa")
const ocioso = (id) => {
  const f = porId.get(id).callFrame.functionName
  return f === "(idle)" || (f === "(program)" && !PROGRAMA_OCUPADO)
}

let t = p.startTime
const blocos = []
let actual = null
for (let i = 0; i < p.samples.length; i++) {
  const id = p.samples[i]
  const dt = p.timeDeltas[i] ?? 0
  t += dt
  if (ocioso(id)) {
    if (actual) blocos.push(actual)
    actual = null
    continue
  }
  actual ??= { inicio: t, fim: t, amostras: [] }
  actual.fim = t
  actual.amostras.push([id, dt])
}
if (actual) blocos.push(actual)

const longos = blocos.filter((b) => (b.fim - b.inicio) / 1000 >= MIN_MS)
console.log(`${longos.length} stretches of ${MIN_MS} ms or more (of ${blocos.length})`)
for (const b of longos) {
  const total = new Map()
  for (const [id, us] of b.amostras) {
    const vistos = new Set()
    for (let c = id; c !== undefined; c = pai.get(c)) {
      const k = nome(porId.get(c))
      if (vistos.has(k)) continue
      vistos.add(k)
      total.set(k, (total.get(k) ?? 0) + us)
    }
  }
  console.log(`\n== at ${((b.inicio - p.startTime) / 1000).toFixed(0)} ms, ${((b.fim - b.inicio) / 1000).toFixed(0)} ms`)
  for (const [k, v] of [...total].sort((a, c) => c[1] - a[1]).slice(0, TOPO)) console.log(`${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`)
}
