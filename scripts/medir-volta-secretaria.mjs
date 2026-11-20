/**
 * The desktop app coming back from a minimized window.
 *
 *   node --max-old-space-size=8192 scripts/medir-volta-secretaria.mjs --saida <results folder> --caso <case folder> --out <apps/client/out of a build> --rotulo antes [--minutos 5] [--voltas 3] [--cpu 4] [--modo esconder|minimizar] [--perfil]
 *
 * The complaint: the app does not answer for a few seconds when it comes back
 * from minimized (Windows, Electron). This opens the real desktop app on a copy
 * of the big case of `medir-fluidez.mjs` (the common room of 400) and creates an
 * account there (Eva, remembered), with Playwright. Then it reopens the same app
 * WITHOUT Playwright (`lancarSemPlaywright`: Playwright keeps the page visible),
 * driven from the main process (`medir-volta-secretaria.medidor.cjs`), and
 * `--voltas` times: hides the window for `--minutos` while Bruno writes one
 * message a second in the common room, brings it back, and clicks a room right
 * away. Measured in the window: the INP of that click, the Long Tasks of the next
 * 15 s and the first frame after the return; in the main process: the
 * event-loop delay and the synchronous reads the window made over those 15 s.
 * `--cpu` throttles the window (CDP); `--cpu-principal` the main process. ALL LOCAL: own server
 * on the case's ports (8570/8571).
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Session, Vault } from "@enclave/client-core"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./frente-lenta.mjs"
import { abrirSecretaria, lancarSemPlaywright } from "./secretaria.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const arg = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const casa_ = (p) => resolve(String(p).replace(/^~/, process.env.HOME ?? "~"))
const CASO = casa_(arg("--caso", "~/.orwell/fluidez-caso"))
const OUT = casa_(arg("--out", join(RAIZ, "apps/client/out")))
const ROTULO = arg("--rotulo", "agora")
const MINUTOS = Number(arg("--minutos", 5))
const VOLTAS = Number(arg("--voltas", 3))
const CPU = Number(arg("--cpu", 4))
// Where the results go: always given, so a measure never writes into the tree by surprise.
if (!arg("--saida")) {
  console.error("pass --saida <folder> (the results and profiles go there)")
  process.exit(2)
}
const SAIDA = casa_(arg("--saida"))
// `--perfil`: a CPU profile of the main process and of the window over the 15 s after the restore.
const PERFIL = process.argv.includes("--perfil")
// `--rastreio`: a Chromium trace of the window over the first 2 s after the return.
const RASTREIO = process.argv.includes("--rastreio")
/*
  `--modo esconder` (default) or `--modo minimizar`. On Windows a minimized
  window's page goes hidden (Chromium's WasHidden) and the renderer is throttled.
  On macOS a minimized Electron window keeps its page "visible" (measured), and
  restoring runs the dock animation in a nested run loop that holds the first
  synchronous IPC reply for ~0.5 s. `hide()`/`show()` gives the Windows signal
  (page hidden, renderer throttled) without the macOS animation.
*/
const MODO = arg("--modo", "esconder")
/*
  \`--cpu-principal N\`: the main process N times slower, by stopping it for
  (N - 1) of every N slices of 5 ms (SIGSTOP/SIGCONT). Chromium throttles only
  the window; on a slower Windows machine the main process (core, vault, the
  answers to the window's synchronous reads) is slower too.
*/
const CPU_PRINCIPAL = Number(arg("--cpu-principal", 1))
/*
  \`--conta Carla\`: the desktop opens that member's vault from the case (8 MB,
  the common room of 400 and its history) instead of creating Eva, whose new
  vault is small. The vault is sealed and written in the main process, so its
  size is what the main process pays. Never Dona or Bruno: they run here.
*/
const CONTA = arg("--conta", null)
if (CONTA === "Dona" || CONTA === "Bruno") throw new Error("--conta: Dona and Bruno are used by this script")
function estrangular(pid, vezes) {
  if (!(vezes > 1)) return () => {}
  let ligado = true
  let parado = false
  const passo = () => {
    if (!ligado) return
    try {
      process.kill(pid, parado ? "SIGCONT" : "SIGSTOP")
    } catch {
      ligado = false
      return
    }
    parado = !parado
    setTimeout(passo, parado ? 5 * (vezes - 1) : 5)
  }
  setTimeout(passo, 5)
  return () => {
    ligado = false
    try {
      process.kill(pid, "SIGCONT")
    } catch {}
  }
}
const FRASE_NO = "frase-de-teste-do-no"
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 500) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await Promise.resolve(condicao()).catch(() => false)) return true
    await wait(passo)
  }
  return false
}
const mensagem = (body) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] })
const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b)
  return o.length ? o[Math.floor(o.length / 2)] : null
}

const caso = JSON.parse(readFileSync(join(CASO, "caso.json"), "utf8"))
const CORRIDA = join(tmpdir(), `orwell-volta-secretaria-${process.pid}`)
for (const parte of ["servidor", "nos"]) cpSync(join(CASO, parte), join(CORRIDA, parte), { recursive: true })
const casa = await levantarServidor({ dist: join(RAIZ, "apps/web/dist"), portaDaFrente: 8570, portaDoServidor: 8571, dados: join(CORRIDA, "servidor") })
const sessoes = []
async function reabrir(nome) {
  const vault = new Vault({
    supportsOsProtection: false,
    read: async () => new Uint8Array(readFileSync(join(CORRIDA, "nos", `${nome}.cofre`))),
    write: async (b) => writeFileSync(join(CORRIDA, "nos", `${nome}.cofre`), b),
    clear: async () => {},
  })
  await vault.unlock(FRASE_NO)
  const session = new Session(vault)
  session.loadIdentity()
  await session.connect()
  sessoes.push(session)
  return session
}
const resultado = { rotulo: ROTULO, out: OUT, minutos: MINUTOS, cpu: CPU, cpuPrincipal: CPU_PRINCIPAL, modo: MODO, conta: CONTA ?? "Eva (nova)", voltas: [] }
mkdirSync(SAIDA, { recursive: true })
const gravar = () => writeFileSync(join(SAIDA, `secretaria-${ROTULO}.json`), JSON.stringify(resultado, null, 2))
let sec
let nua
let pararEstrangulamento = () => {}
let dadosDaApp = null
try {
  const dona = await reabrir("Dona")
  const bruno = await reabrir("Bruno")
  // 1. Setup with Playwright: the account (remembered, so the reopen needs no password), the room, the history.
  let pastaDaConta
  if (CONTA) {
    pastaDaConta = mkdtempSync(join(tmpdir(), "orwell-volta-conta-"))
    cpSync(join(CORRIDA, "nos", `${CONTA}.cofre`), join(pastaDaConta, "vault.enc"))
  }
  sec = await abrirSecretaria({ rotulo: "eva", principal: join(OUT, "main/index.cjs"), ...(pastaDaConta ? { dados: pastaDaConta } : {}) })
  const page = sec.page
  if (CONTA) {
    const frase = page.locator('.gate-card input[type="password"]')
    await frase.waitFor({ timeout: 60_000 })
    await frase.fill(FRASE_NO)
    await page.locator('input[name="memorizar"]').setChecked(true)
    await frase.press("Enter")
  } else {
    await criarConta(page, { nome: "Eva", frase: "frase-da-eva-2026", servidor: caso.NOME, memorizar: true })
  }
  await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 120_000 })
  await ate(async () => (await page.locator(".channel-name").count()) >= 1, 180_000)
  await page.locator(".channel-name").first().click()
  // Settle: the history and the room state arrive.
  await wait(60_000)
  const dados = sec.dados
  dadosDaApp = dados
  await sec.fechar({ guardarDados: true })
  sec = null
  // 2. The same data folder, without Playwright: see `lancarSemPlaywright`.
  nua = await lancarSemPlaywright({ dados, principal: join(OUT, "main/index.cjs"), medidor: join(RAIZ, "scripts/medir-volta-secretaria.medidor.cjs") })
  await nua.pedir("pronto", { cpu: CPU })
  pararEstrangulamento = estrangular(nua.pid, CPU_PRINCIPAL)
  await wait(30_000)
  for (let v = 0; v < VOLTAS; v++) {
    const { visibilidade, diagnostico } = await nua.pedir("esconder", { modo: MODO, indice: v })
    if (diagnostico) console.log("not hidden:", JSON.stringify(diagnostico))
    console.log(`volta ${v + 1}: ${MODO}, page ${visibilidade}`)
    if (visibilidade !== "hidden") throw new Error("the page never went hidden: this return would measure nothing")
    const fim = Date.now() + MINUTOS * 60_000
    let n = 0
    while (Date.now() < fim) { await bruno.send(caso.SALA, mensagem(`minimizada ${v}.${n++}`)); await wait(1_000) }
    const v_ = await nua.pedir("voltar", { modo: MODO, perfil: PERFIL, rastreio: RASTREIO, saida: SAIDA, rotulo: `${ROTULO}-volta${v + 1}` })
    v_.enviadas = n
    v_.visibilidadeEscondida = visibilidade
    resultado.voltas.push(v_)
    console.log(`== volta ${v + 1}`, JSON.stringify(v_))
    gravar()
  }
  resultado.mediana = Object.fromEntries(["cliqueAteQuadroMs", "cliqueEsperaMs", "inpPrimeiroCliqueMs", "longaMaxMs", "longasSomaMs", "principalMaxMs", "primeiroQuadroMs"].map((k) => [k, mediana(resultado.voltas.map((x) => (x[k] === "<16" ? 15 : x[k])).filter((x) => x != null))]))
  console.log("== mediana", JSON.stringify(resultado.mediana))
  gravar()
} catch (erro) {
  console.error("O guião caiu:", erro?.stack ?? erro)
  console.error((nua ?? sec)?.registo?.slice(-30).join("\n"))
  resultado.erro = String(erro?.message ?? erro)
  gravar()
} finally {
  for (const s of sessoes) s.disconnect()
  pararEstrangulamento()
  await sec?.fechar()
  await nua?.fechar()
  if (dadosDaApp) rmSync(dadosDaApp, { recursive: true, force: true })
  casa.fechar()
  rmSync(CORRIDA, { recursive: true, force: true })
}
process.exit(resultado.erro ? 1 : 0)
