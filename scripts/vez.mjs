#!/usr/bin/env node
/**
 * One heavy run at a time on this machine: suites, `.rede` batteries, e2e.
 *
 * Two suites side by side give false reds (timing budgets blow up under load),
 * and a `.rede` battery next to anything else is worthless. So runs queue up.
 *
 *   node scripts/vez.mjs -- npx vitest run --root apps/server
 *   node scripts/vez.mjs -- node scripts/e2e-convite.mjs
 *   node scripts/vez.mjs --estado
 *
 * How the turn is taken:
 *
 *   1. A lock file in `os.tmpdir()` (`orwell-vez.lock`, shared by every
 *      worktree of this machine), created with `O_EXCL`: whoever creates it
 *      holds the turn. It records the pid, the command and the start time.
 *   2. A lock whose pid is dead, or whose pid now belongs to a process that is
 *      not a `vez.mjs`, is stale and is cleared. Clearing goes through a second
 *      short lock, so two waiters cannot both clear and one of them delete the
 *      lock the other has just taken.
 *   3. Runs that do not use this script still count: while it waits, it also
 *      waits for any `node` process running vitest, an `e2e-*.mjs` or a
 *      `capturar-*` script that is not its own descendant. Shells are ignored
 *      on purpose: a waiting loop like `until ! pgrep -f "vitest run"` has that
 *      text in its own command line and used to wait for itself forever.
 *
 * Options (before `--`):
 *   --max-espera=<minutes>  give up after this long, exit code 75
 *   --so-lock               wait only for the lock, not for foreign processes
 *   --estado                print who holds the turn and what else is running
 *
 * The exit code is the command's. The lock is released when the command ends,
 * on Ctrl+C and on SIGTERM (which are passed to the command first).
 */
import { execFileSync, spawn } from "node:child_process"
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs"
import { constants, tmpdir } from "node:os"
import { join } from "node:path"

const LOCK = process.env.ORWELL_VEZ_LOCK ?? join(tmpdir(), "orwell-vez.lock")
const DISJUNTOR = `${LOCK}.limpar`
const INTERVALO_MS = Number(process.env.ORWELL_VEZ_INTERVALO_MS ?? 2000)
// A process that is a heavy run when no lock is in sight.
const PESADO = /vitest\/vitest\.mjs|vitest\.mjs\s+run|\be2e-[a-z0-9-]+\.mjs|\bcapturar-[a-z0-9-]+\.(?:mjs|ts)/
const CONCHA = /^(?:\S*\/)?(?:zsh|bash|sh|dash|fish)\b/

function analisarArgumentos(argv) {
  const separador = argv.indexOf("--")
  const opcoes = separador === -1 ? argv : argv.slice(0, separador)
  const comando = separador === -1 ? [] : argv.slice(separador + 1)
  const resultado = { comando, maxEsperaMs: Infinity, soLock: false, estado: false }
  for (const opcao of opcoes) {
    if (opcao === "--so-lock") resultado.soLock = true
    else if (opcao === "--estado") resultado.estado = true
    else if (opcao.startsWith("--max-espera=")) {
      const minutos = Number(opcao.slice("--max-espera=".length))
      if (!(minutos > 0)) sair(2, `--max-espera precisa de minutos > 0: ${opcao}`)
      resultado.maxEsperaMs = minutos * 60_000
    } else sair(2, `opção que não conheço: ${opcao}`)
  }
  return resultado
}

function sair(codigo, mensagem) {
  process.stderr.write(`vez: ${mensagem}\n`)
  process.exit(codigo)
}

/** Every process of the machine as `{ pid, ppid, comando }`. */
function processos() {
  try {
    const saida = execFileSync("ps", ["-Ao", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 << 20 })
    return saida.split("\n").flatMap((linha) => {
      const m = linha.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), comando: m[3] }] : []
    })
  } catch {
    return []
  }
}

function vivo(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    return erro.code === "EPERM"
  }
}

/** The holder is alive and is still a `vez.mjs` (pids get reused). */
function donoVivo(dono, lista) {
  if (!dono || !Number.isInteger(dono.pid) || !vivo(dono.pid)) return false
  const processo = lista.find((p) => p.pid === dono.pid)
  return processo ? /vez\.mjs/.test(processo.comando) : true
}

function lerLock() {
  try {
    return JSON.parse(readFileSync(LOCK, "utf8"))
  } catch (erro) {
    if (erro.code === "ENOENT") return null
    // Half written or garbage: treated as a holder with no pid, so stale.
    return {}
  }
}

function tentarTomar(comando) {
  try {
    const fd = openSync(LOCK, "wx")
    const dono = { pid: process.pid, comando: comando.join(" "), cwd: process.cwd(), desde: new Date().toISOString() }
    writeSync(fd, JSON.stringify(dono))
    closeSync(fd)
    return true
  } catch (erro) {
    if (erro.code === "EEXIST") return false
    throw erro
  }
}

/** Clears a stale lock, under the breaker so only one waiter does it. */
function limparSeMorto(lista) {
  try {
    closeSync(openSync(DISJUNTOR, "wx"))
  } catch (erro) {
    if (erro.code !== "EEXIST") throw erro
    // A breaker left behind by a waiter that died mid-clear.
    try {
      if (Date.now() - statSync(DISJUNTOR).mtimeMs > 30_000) unlinkSync(DISJUNTOR)
    } catch {}
    return
  }
  try {
    const dono = lerLock()
    if (dono && !donoVivo(dono, lista)) {
      unlinkSync(LOCK)
      process.stderr.write(`vez: lock morto limpo (pid ${dono.pid ?? "?"})\n`)
    }
  } catch {
  } finally {
    try {
      unlinkSync(DISJUNTOR)
    } catch {}
  }
}

/** Heavy runs that are not this process or one of its descendants. */
function pesadosAlheios(lista) {
  const meus = new Set([process.pid])
  let cresceu = true
  while (cresceu) {
    cresceu = false
    for (const p of lista) {
      if (!meus.has(p.pid) && meus.has(p.ppid)) {
        meus.add(p.pid)
        cresceu = true
      }
    }
  }
  return lista.filter((p) => !meus.has(p.pid) && !CONCHA.test(p.comando) && /\bnode\b/.test(p.comando) && PESADO.test(p.comando))
}

function mostrarEstado() {
  const lista = processos()
  const dono = lerLock()
  if (!dono) console.log("vez: livre (sem lock)")
  else if (!donoVivo(dono, lista)) console.log(`vez: lock morto do pid ${dono.pid ?? "?"} (limpa-se na próxima vez)`)
  else console.log(`vez: ocupado pelo pid ${dono.pid} desde ${dono.desde}\n  ${dono.comando}\n  em ${dono.cwd}`)
  for (const p of pesadosAlheios(lista)) console.log(`a correr fora do lock: ${p.pid} ${p.comando.slice(0, 160)}`)
}

async function esperarVez({ comando, maxEsperaMs, soLock }) {
  const inicio = Date.now()
  let ultimoAviso = 0
  const avisar = (texto) => {
    if (Date.now() - ultimoAviso < 60_000) return
    ultimoAviso = Date.now()
    process.stderr.write(`vez: ${texto}\n`)
  }
  const pausa = () => {
    if (Date.now() - inicio > maxEsperaMs) sair(75, "desisti: passou o --max-espera")
    return new Promise((r) => setTimeout(r, INTERVALO_MS))
  }
  // First the lock, in arrival order among the runs that use it.
  while (!tentarTomar(comando)) {
    const lista = processos()
    limparSeMorto(lista)
    const dono = lerLock()
    if (dono?.pid) avisar(`à espera do pid ${dono.pid}: ${String(dono.comando).slice(0, 120)}`)
    await pausa()
  }
  process.on("exit", libertar)
  // Then, holding it, the runs that do not use it.
  for (;;) {
    const alheios = soLock ? [] : pesadosAlheios(processos())
    if (alheios.length === 0) return
    avisar(`à espera de ${alheios.length} corrida(s) fora do lock: ${alheios.map((p) => p.pid).join(", ")}`)
    await pausa()
  }
}

function libertar() {
  try {
    if (lerLock()?.pid === process.pid) unlinkSync(LOCK)
  } catch {}
}

const opcoes = analisarArgumentos(process.argv.slice(2))
if (opcoes.estado) {
  mostrarEstado()
  process.exit(0)
}
if (opcoes.comando.length === 0) sair(2, "falta o comando: node scripts/vez.mjs -- <comando> [argumentos]")

for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  // While waiting there is no child yet: just leave (the exit hook frees the lock).
  process.once(sinal, () => process.exit(128 + constants.signals[sinal]))
}
await esperarVez(opcoes)
const inicio = Date.now()
const filho = spawn(opcoes.comando[0], opcoes.comando.slice(1), { stdio: "inherit" })
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.removeAllListeners(sinal)
  process.on(sinal, () => filho.kill(sinal))
}
filho.on("error", (erro) => {
  libertar()
  sair(127, `não consegui correr ${opcoes.comando[0]}: ${erro.message}`)
})
filho.on("exit", (codigo, sinal) => {
  libertar()
  process.stderr.write(`vez: terminou em ${((Date.now() - inicio) / 1000).toFixed(1)} s\n`)
  process.exit(codigo ?? (sinal ? 128 + (constants.signals[sinal] ?? 0) : 1))
})
