/**
 * "Enviar registo" (send log) with the signed request, live, in three engines.
 *
 *   npm run build && node scripts/e2e-enviar-registo.mjs
 *   ORWELL_DIST_ANTIGO=<apps/web/dist of 1.3.14 or older> node scripts/e2e-enviar-registo.mjs
 *
 * From 1.3.15 the route `/_enclave/relato` takes only a request signed by a
 * device of the account. In Chromium, Firefox and WebKit, a new account opens
 * Settings > Help and diagnostics, presses "Enviar registo", sees the thank-you
 * toast, and the server has the log under that account's address. With
 * `ORWELL_DIST_ANTIGO`, an old app (which sends the log unsigned) gets the clean
 * refusal toast, the app keeps working, and nothing is written.
 *
 * Local and throwaway server, never production.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { dentro, espera, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const { check, resumo } = verificador()
const ANTIGA = process.env.ORWELL_DIST_ANTIGO ?? null

const relatos = (dados) => {
  const pasta = join(dados, "relatos")
  return existsSync(pasta) ? readdirSync(pasta).map((nome) => readFileSync(join(pasta, nome), "utf8")).join("\n") : ""
}

async function enviarRegisto(motor, app, servidor) {
  const browser = await motor.launch()
  try {
    const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (erro) => erros.push(String(erro)))
    await page.goto(app, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome: `Ana ${motor.name()}`, servidor })
    await dentro(page)
    await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await espera(800)
    await page.getByText("Ajuda e diagnóstico", { exact: true }).first().click()
    await espera(500)
    await page.getByRole("button", { name: "Enviar registo" }).click()
    const aviso = page.getByText(/registo enviado, obrigado|O servidor não aceitou o registo/).first()
    await aviso.waitFor({ timeout: 15_000 })
    const texto = (await aviso.textContent()) ?? ""
    // Still alive after the answer: the settings screen still works.
    await page.getByRole("button", { name: "Enviar registo" }).waitFor({ timeout: 5_000 })
    return { texto, erros }
  } finally {
    await browser.close()
  }
}

let porta = 8711
for (const motor of [chromium, firefox, webkit]) {
  const srv = await levantarServidor({ frente: porta, servidor: porta + 1, etiqueta: `enviar-registo-${motor.name()}` })
  porta += 2
  try {
    const { texto, erros } = await enviarRegisto(motor, srv.APP, srv.NOME)
    const guardado = relatos(srv.dados)
    check(`${motor.name()}: o aviso é o de enviado`, /registo enviado, obrigado/.test(texto), texto)
    check(
      `${motor.name()}: o servidor guardou o registo com o endereço e a versão`,
      new RegExp(`· @[^ ]+:${srv.NOME.replace(".", "\\.")} · versão \\d+\\.\\d+\\.\\d+`).test(guardado),
      guardado.split("\n")[0] ?? "(vazio)",
    )
    check(`${motor.name()}: sem erros na página`, erros.length === 0, erros.join(" | "))
  } finally {
    srv.fechar()
  }
}

if (ANTIGA) {
  const srv = await levantarServidor({ frente: porta, servidor: porta + 1, dist: ANTIGA, etiqueta: "enviar-registo-antigo" })
  try {
    const { texto, erros } = await enviarRegisto(chromium, srv.APP, srv.NOME)
    check("cliente antigo: recusa limpa, com a frase do erro", /O servidor não aceitou o registo/.test(texto), texto)
    check("cliente antigo: nada foi guardado", relatos(srv.dados) === "", relatos(srv.dados).slice(0, 120))
    check("cliente antigo: sem erros na página", erros.length === 0, erros.join(" | "))
  } finally {
    srv.fechar()
  }
}

process.exitCode = resumo() ? 0 : 1
