import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

/**
 * `scripts/vez.mjs`, the queue for heavy runs on one machine.
 *
 * Every run here uses its own lock file and `--so-lock`, so the test neither
 * waits for nor blocks the real suites that may be running on the machine.
 */
const VEZ = fileURLToPath(new URL("../../../scripts/vez.mjs", import.meta.url))
const pasta = mkdtempSync(join(tmpdir(), "vez-teste-"))
afterAll(() => rmSync(pasta, { recursive: true, force: true }))

let n = 0
function lockNovo(): string {
  return join(pasta, `lock-${++n}`)
}

function correr(lock: string, argumentos: string[]): Promise<{ codigo: number | null; erro: string }> {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [VEZ, ...argumentos], {
      env: { ...process.env, ORWELL_VEZ_LOCK: lock, ORWELL_VEZ_INTERVALO_MS: "50" },
      stdio: ["ignore", "ignore", "pipe"],
    })
    let erro = ""
    filho.stderr.on("data", (bocado: Buffer) => (erro += bocado.toString()))
    filho.on("exit", (codigo) => resolve({ codigo, erro }))
  })
}

/** A node command that appends `start` and `end` lines to `diario`, with `ms` in between. */
function trabalho(diario: string, nome: string, ms: number): string[] {
  const js = `const fs=require("fs");fs.appendFileSync(${JSON.stringify(diario)},"start ${nome}\\n");setTimeout(()=>{fs.appendFileSync(${JSON.stringify(diario)},"end ${nome}\\n")},${ms})`
  return [process.execPath, "-e", js]
}

describe("vez.mjs", () => {
  it("runs the command, returns its exit code and leaves no lock behind", async () => {
    const lock = lockNovo()
    const { codigo } = await correr(lock, ["--so-lock", "--", process.execPath, "-e", "process.exit(3)"])
    expect(codigo).toBe(3)
    expect(existsSync(lock)).toBe(false)
  })

  it("two runs at the same time take turns: one ends before the other starts", async () => {
    const lock = lockNovo()
    const diario = join(pasta, "diario-turnos")
    writeFileSync(diario, "")
    await Promise.all([
      correr(lock, ["--so-lock", "--", ...trabalho(diario, "a", 400)]),
      correr(lock, ["--so-lock", "--", ...trabalho(diario, "b", 400)]),
    ])
    const linhas = readFileSync(diario, "utf8").trim().split("\n")
    expect(linhas).toHaveLength(4)
    // Whichever went first, its end comes before the other's start.
    expect(linhas[0]!.replace("start", "end")).toBe(linhas[1])
    expect(linhas[2]!.startsWith("start")).toBe(true)
  })

  it("clears a lock whose pid is dead", async () => {
    const lock = lockNovo()
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 7, comando: "morto", desde: "" }))
    const { codigo, erro } = await correr(lock, ["--so-lock", "--", process.execPath, "-e", ""])
    expect(codigo).toBe(0)
    expect(erro).toContain("lock morto limpo")
  })

  it("clears a lock whose pid is alive but is no longer a vez.mjs (the pid was reused)", async () => {
    const lock = lockNovo()
    writeFileSync(lock, JSON.stringify({ pid: process.pid, comando: "outro", desde: "" }))
    const { codigo } = await correr(lock, ["--so-lock", "--", process.execPath, "-e", ""])
    expect(codigo).toBe(0)
  })

  it("clears a lock with garbage in it", async () => {
    const lock = lockNovo()
    writeFileSync(lock, "{meio escrito")
    const { codigo } = await correr(lock, ["--so-lock", "--", process.execPath, "-e", ""])
    expect(codigo).toBe(0)
  })

  it("gives up with 75 after --max-espera while a live run holds the turn, and the holder keeps it", async () => {
    const lock = lockNovo()
    const diario = join(pasta, "diario-espera")
    writeFileSync(diario, "")
    const dono = correr(lock, ["--so-lock", "--", ...trabalho(diario, "dono", 2_500)])
    while (!existsSync(lock)) await new Promise((r) => setTimeout(r, 20))
    const { codigo, erro } = await correr(lock, ["--so-lock", "--max-espera=0.01", "--", process.execPath, "-e", ""])
    expect(codigo).toBe(75)
    expect(erro).toContain("desisti")
    expect(existsSync(lock)).toBe(true)
    expect((await dono).codigo).toBe(0)
    expect(existsSync(lock)).toBe(false)
  })

  it("refuses to run without a command, and with an option it does not know", async () => {
    expect((await correr(lockNovo(), ["--so-lock"])).codigo).toBe(2)
    expect((await correr(lockNovo(), ["--depressa", "--", "true"])).codigo).toBe(2)
  })
})
