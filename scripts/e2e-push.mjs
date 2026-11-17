/**
 * "Notifications when the app is closed" (Web Push) in three browsers, on a
 * disposable server, with a fake PushManager.
 *
 *   npm run build && node scripts/e2e-push.mjs
 *
 *  - Ana in Chromium and Bruno in Firefox: Settings > Notifications, "System
 *    notifications" on, then "Notifications when the app is closed" on. The
 *    fake PushManager hands out a real P-256 key (WebCrypto), so the server
 *    takes the subscription; `push.subscribe` must leave on the socket, the row
 *    must be in the database, and a reload must send it again (the renewal).
 *    Turning it off must send `push.unsubscribe` and delete the row.
 *  - Carla in WebKit: without PushManager the toggle is hidden.
 *  - Dora in Chromium, with the fake PushManager, on a second server left with
 *    the default (no `ENCLAVE_PUSH`, so push is off): the server does not
 *    announce the capability, the toggle is hidden and no `push.*` frame leaves.
 *
 * NOTHING leaves the machine. The fake PushManager never talks to a push
 * service, the endpoints are `https://push.invalid/...` (a name that never
 * resolves), and no message is sent, so the server never POSTs anything.
 * Screenshots (390 px) in `.verify-data/prova-push/<hora>/`.
 */
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { ate, consultar, dentro, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CAPTURAS = join(RAIZ, ".verify-data/prova-push", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

// The push service list of this server: only a name that never resolves.
process.env.ENCLAVE_PUSH = "on"
process.env.ENCLAVE_PUSH_SERVICOS = "push.invalid"

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8560, servidor: 8561, etiqueta: "push" })
let srvSemPush = null
const browsers = []
const paginas = []

/**
 * In the page, before any app code: notification permission granted, and a
 * PushManager that subscribes without a push service. `semPushManager` takes
 * it away, as on a browser that has none.
 */
function falsoPushManager(semPushManager) {
  const permissao = { valor: "granted" }
  if (typeof Notification !== "undefined") {
    Object.defineProperty(Notification, "permission", { get: () => permissao.valor, configurable: true })
    Notification.requestPermission = async () => permissao.valor
  }
  if (semPushManager) {
    delete window.PushManager
    if (typeof ServiceWorkerRegistration !== "undefined") delete ServiceWorkerRegistration.prototype.pushManager
    return
  }
  let actual = null
  const gerar = async (chave) => {
    const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])
    const p256dh = await crypto.subtle.exportKey("raw", par.publicKey)
    const auth = crypto.getRandomValues(new Uint8Array(16)).buffer
    const id = Math.random().toString(36).slice(2)
    return {
      endpoint: `https://push.invalid/e2e/${id}`,
      expirationTime: null,
      options: { applicationServerKey: new Uint8Array(chave).buffer, userVisibleOnly: true },
      getKey: (nome) => (nome === "p256dh" ? p256dh : auth),
      unsubscribe: async () => {
        actual = null
        return true
      },
    }
  }
  const gestor = {
    getSubscription: async () => actual,
    subscribe: async (opcoes) => (actual = await gerar(opcoes.applicationServerKey)),
  }
  window.PushManager = window.PushManager ?? function PushManager() {}
  if (typeof ServiceWorkerRegistration !== "undefined") {
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { get: () => gestor, configurable: true })
  }
}

async function abrir(motor, nome, { semPushManager = false, app = srv.APP } = {}) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 390, height: 844 }, isMobile: motor !== firefox, hasTouch: true })
  await ctx.addInitScript(falsoPushManager, semPushManager)
  const page = await ctx.newPage()
  const tramas = []
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload === "string" && payload.includes('"t":"push.')) tramas.push(JSON.parse(payload).t)
    })
  })
  await page.goto(app, { waitUntil: "domcontentloaded" })
  paginas.push({ nome, page })
  return { nome, ctx, page, tramas }
}

const foto = async (page, nome) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`) }).catch(() => {})
}

const linhas = (address) => consultar(srv.base, "SELECT endpoint, lingua FROM push_subscriptions WHERE address = ?", address)

/** Settings > Notifications, on a phone-sized screen (the list of sections comes first). */
async function irParaAvisos(page) {
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await page.getByRole("button", { name: "Notificações", exact: true }).first().click()
}

const interruptor = (page, nome) => page.getByRole("switch", { name: nome })

async function ligarAvisos(conta) {
  const { page } = conta
  await irParaAvisos(page)
  await page.getByRole("heading", { name: "Notificações", exact: true }).waitFor({ timeout: 20_000 })
  const fechada = interruptor(page, "Avisos com a app fechada")
  const sistema = interruptor(page, "Notificações do sistema")
  // A browser without `Notification` (Playwright's WebKit) has no system toggle at all.
  if (!(await sistema.waitFor({ timeout: 5_000 }).then(() => true, () => false))) {
    return { fechada, apareceu: await fechada.isVisible().catch(() => false), semSistema: true }
  }
  if ((await sistema.getAttribute("aria-checked")) !== "true") await sistema.click()
  const apareceu = await fechada.waitFor({ timeout: 20_000 }).then(() => true, () => false)
  return { fechada, apareceu, semSistema: false }
}

try {
  const contas = []
  for (const [motor, nome] of [[chromium, "Ana"], [firefox, "Bruno"]]) {
    const conta = await abrir(motor, nome)
    await criarConta(conta.page, { nome, frase: FRASE, servidor: srv.NOME })
    await dentro(conta.page)
    contas.push(conta)
  }
  const enderecos = consultar(srv.base, "SELECT address FROM accounts ORDER BY rowid ASC").map((l) => l.address)

  for (const [i, conta] of contas.entries()) {
    const address = enderecos[i]
    const { page, tramas, nome } = conta
    const { fechada, apareceu } = await ligarAvisos(conta)
    check(`${nome}: o interruptor aparece por baixo de "Notificações do sistema"`, apareceu)
    await foto(page, `${nome}-1-desligado`)
    await fechada.click()
    const ligou = await ate(async () => (await fechada.getAttribute("aria-checked")) === "true", 20_000, 300).then(() => true, () => false)
    check(`${nome}: fica ligado`, ligou)
    check(`${nome}: push.key.get e push.subscribe saíram no socket`, tramas.includes("push.key.get") && tramas.includes("push.subscribe"), tramas.join(","))
    const guardadas = await ate(async () => linhas(address).length === 1, 10_000, 300).then(() => linhas(address), () => linhas(address))
    check(`${nome}: a linha está no servidor, com https://push.invalid e a língua pt`, guardadas.length === 1 && guardadas[0].endpoint.startsWith("https://push.invalid/") && guardadas[0].lingua === "pt", JSON.stringify(guardadas))
    await foto(page, `${nome}-2-ligado`)

    // The renewal: reload the page, unlock again, and the subscription goes out again.
    const antes = tramas.filter((t) => t === "push.subscribe").length
    await page.reload({ waitUntil: "domcontentloaded" })
    const campo = page.locator('.gate-card input[type="password"]').first()
    await campo.or(page.getByRole("button", { name: "Configurações", exact: true }).first()).first().waitFor({ timeout: 60_000 })
    if (await campo.isVisible().catch(() => false)) {
      await campo.fill(FRASE)
      await page.getByRole("button", { name: "Entrar", exact: true }).click()
    }
    await dentro(page)
    const renovou = await ate(async () => tramas.filter((t) => t === "push.subscribe").length > antes, 30_000, 300).then(() => true, () => false)
    check(`${nome}: depois de recarregar, a subscrição renova-se sozinha`, renovou, tramas.join(","))

    // Off: push.unsubscribe, and the row goes.
    await irParaAvisos(page)
    const deNovo = interruptor(page, "Avisos com a app fechada")
    await deNovo.waitFor({ timeout: 20_000 })
    await deNovo.click()
    const apagou = await ate(async () => linhas(address).length === 0, 10_000, 300).then(() => true, () => false)
    check(`${nome}: desligar manda push.unsubscribe e apaga a linha`, apagou && tramas.includes("push.unsubscribe"), tramas.join(","))
  }

  const carla = await abrir(webkit, "Carla", { semPushManager: true })
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const { apareceu: naCarla, semSistema } = await ligarAvisos(carla)
  // Wait for the push state to settle before saying the toggle is not there.
  await carla.page.waitForTimeout(1500)
  check("Carla (WebKit sem PushManager): o interruptor não aparece", !naCarla && !(await interruptor(carla.page, "Avisos com a app fechada").isVisible()), semSistema ? "e este WebKit nem tem Notification" : "")
  check("Carla: nenhuma trama push.* saiu", carla.tramas.length === 0, carla.tramas.join(","))
  await foto(carla.page, "Carla-sem-push")

  // A server left with the default: push is off unless the operator writes ENCLAVE_PUSH=on.
  delete process.env.ENCLAVE_PUSH
  delete process.env.ENCLAVE_PUSH_SERVICOS
  srvSemPush = await levantarServidor({ frente: 8562, servidor: 8563, etiqueta: "push-omissao" })
  const dora = await abrir(chromium, "Dora", { app: srvSemPush.APP })
  await criarConta(dora.page, { nome: "Dora", frase: FRASE, servidor: srvSemPush.NOME })
  await dentro(dora.page)
  const { apareceu: naDora, semSistema: doraSemSistema } = await ligarAvisos(dora)
  await dora.page.waitForTimeout(1500)
  check("Dora (servidor por omissão, sem ENCLAVE_PUSH): \"Notificações do sistema\" existe", !doraSemSistema)
  check("Dora: sem a capacidade do servidor, o interruptor não aparece", !naDora && !(await interruptor(dora.page, "Avisos com a app fechada").isVisible()))
  check("Dora: nenhuma trama push.* saiu", dora.tramas.length === 0, dora.tramas.join(","))
  check("Dora: o servidor não criou push.key.json", !existsSync(join(srvSemPush.dados, "push.key.json")))
  await foto(dora.page, "Dora-servidor-sem-push")
} catch (erro) {
  check("o guião correu até ao fim", false, String(erro?.stack ?? erro).slice(0, 600))
  for (const { nome, page } of paginas) await foto(page, `falha-${nome}`)
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  srv.fechar()
  srvSemPush?.fechar()
}
console.log(`capturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
