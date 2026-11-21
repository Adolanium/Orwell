/**
 * Create an account through the interface, in one place.
 *
 * The creation screen stopped being a form with everything in view and started
 * asking one question at a time: the name, the password, the confirmation.
 * Thirty-five scripts brought the same five-line block written by hand, fill in
 * the name, fill in both passwords that were both on screen, click "Create
 * account", and none of them survive a screen where the two passwords no longer
 * coexist.
 *
 * It could have been fixed thirty-five times. It stays here once: the next step
 * added to the screen (or removed from it) changes this file and no other. The
 * rule this knows is the only one the screen promises: intermediate pages have a
 * "Continue" button, the last one has "Create account".
 *
 * The SERVER is out of the normal path, it comes prefilled from the address
 * where the page was served. Whoever needs another passes it here, and this opens
 * advanced options to set it. There's also `?servidor=` in the address, for
 * anyone who'd rather not click anything.
 */
import { FRASE } from "./ambiente.mjs"

/**
 * `memorizar`: remember the session (session memory F1). Since 21/11/2026 the
 * create screen has no box: `memorizar: true` turns on the switch in Settings
 * right after (`memorizarSessao`). Off by default, so a new tab asks for the
 * password, as the scripts expect.
 */
/**
 * `canalOficial`: the "Join the official Orwell channel" checkbox on the last step.
 * It comes UNCHECKED on screen since 12/11/2026 (opt-in). Here it is ticked by
 * default, because the scripts written before that count on the account being in
 * the common room; pass `false` to untick, or `null` to leave it as the screen
 * puts it.
 */
/**
 * `ficheiro`: the account-file step that comes right after creating (16/11/2026).
 * By default this downloads the file, ticks the box and continues, so scripts
 * written before it end where they always did. Pass `false` to stop on the step.
 */
/**
 * The display name limit, as the app counts it: 12 graphemes, trimmed (see
 * `nomeDeApresentacao.ts` in the core). The field cuts a longer name without
 * an error, so a script that typed one would go on with a name it did not
 * choose and fail later, far from the cause. It fails here instead.
 */
export const NOME_MAX = 12

export function confirmarNome(nome) {
  const limpo = String(nome ?? "").trim()
  const grafemas = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(limpo)].length
  if (limpo === "" || grafemas > NOME_MAX) {
    throw new Error(`display name must be 1 to ${NOME_MAX} characters, got ${grafemas}: ${JSON.stringify(nome)}`)
  }
  return nome
}

export async function criarConta(
  page,
  { nome, frase = FRASE, servidor, timeout = 60_000, memorizar = false, canalOficial = true, ficheiro = true, convite = null } = {},
) {
  // The gate (21/11/2026): "Bem-vindo ao Orwell" and three ways in, or the form already open.
  const entrada = page.getByRole("heading", { name: "Bem-vindo ao Orwell" })
  const campoNome = page.locator('.gate input[autocomplete="nickname"]')
  await entrada.or(campoNome).first().waitFor({ timeout })
  if (!(await campoNome.count())) await page.getByRole("button", { name: "Criar conta", exact: true }).click()
  await campoNome.waitFor({ timeout })
  await campoNome.fill(confirmarNome(nome))

  if (servidor) {
    await page.getByRole("button", { name: "Opções avançadas" }).click()
    const campo = page.getByLabel("Servidor")
    await campo.fill(servidor)
    // The server is asked when the field loses focus.
    await campo.blur()
  }

  await page.locator('input[name="new-password"]').fill(frase)
  await page.locator('input[name="confirm-password"]').fill(frase)

  if (convite !== null) {
    const campo = page.locator('input[name="convite-de-registo"]')
    if (!(await campo.count())) await page.getByRole("button", { name: "Tenho um código de convite" }).click()
    await campo.fill(convite)
  }

  if (canalOficial !== null) {
    const caixaDoCanal = page.locator('input[name="canal-oficial"]')
    if (await caixaDoCanal.count()) await caixaDoCanal.setChecked(canalOficial)
  }

  const criar = page.locator(".gate form").getByRole("button", { name: "Criar conta", exact: true })
  await criar.and(page.locator(":enabled")).waitFor({ timeout })
  await criar.click()
  if (ficheiro) await passarOFicheiroDaConta(page, { timeout })
  // "Manter sessão iniciada" is no longer on the create screen (21/11/2026): the same switch is in Settings.
  if (memorizar) await memorizarSessao(page, { timeout })
}

/**
 * Settings › Account › "Manter sessão iniciada neste aparelho", on, then back to
 * Communities. On a computer width (the rail has "Configurações").
 */
export async function memorizarSessao(page, { timeout = 90_000 } = {}) {
  const config = page.getByRole("button", { name: "Configurações", exact: true }).first()
  await config.waitFor({ timeout })
  await config.click()
  const interruptor = page.getByRole("switch", { name: "Manter sessão iniciada neste aparelho" })
  await interruptor.waitFor({ timeout })
  if ((await interruptor.getAttribute("aria-checked")) !== "true") await interruptor.click()
  await page.waitForFunction(
    () => document.querySelector('[role="switch"][aria-checked="true"]') !== null,
    null,
    { timeout },
  )
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
}

/**
 * The account-file step: "Guardar o ficheiro" (a download), or "Fazer mais
 * tarde" with `{ guardar: false }`. Returns the download, for whoever wants to
 * look at the file.
 */
export async function passarOFicheiroDaConta(page, { timeout = 90_000, guardar = true } = {}) {
  const passo = page.getByRole("heading", { name: "Guarda o ficheiro da conta" })
  const app = page.getByRole("button", { name: "Configurações", exact: true }).first().or(page.locator(".separadores"))
  await passo.or(app).first().waitFor({ timeout })
  if (!(await passo.count())) return null
  if (!guardar) {
    await page.getByRole("button", { name: "Fazer mais tarde" }).click()
    return null
  }
  const botao = page.getByRole("button", { name: "Guardar o ficheiro" })
  await botao.and(page.locator(":enabled")).waitFor({ timeout })
  /*
    Where the browser can share files (WebKit), the button opens the share sheet
    and nothing downloads: the file then comes from Settings, which downloads.
  */
  const [descarga] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }).catch(() => null), botao.click()])
  if (descarga) return descarga
  await page.getByRole("button", { name: "Fazer mais tarde" }).click({ timeout: 5_000 }).catch(() => {})
  return guardarPelasConfiguracoes(page, { timeout })
}

/** Settings › Conta e segurança › Guardar o ficheiro da conta › Guardar o ficheiro, on a computer width. Returns the download. */
export async function guardarPelasConfiguracoes(page, { timeout = 90_000 } = {}) {
  const config = page.getByRole("button", { name: "Configurações", exact: true }).first()
  await config.waitFor({ timeout })
  await config.click()
  await page.getByRole("button", { name: "Conta e segurança", exact: true }).first().click()
  await page.getByRole("button", { name: "Guardar o ficheiro da conta" }).click()
  const [descarga] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(".sheet").getByRole("button", { name: "Guardar o ficheiro", exact: true }).click(),
  ])
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  return descarga
}

/**
 * The same, plus waiting for the application to be open.
 *
 * It's what almost all scripts do next, and writing the `waitFor` by hand
 * thirty times is how we got here. The Settings button only exists after the
 * account is created, connected, and has a profile.
 *
 * At 840 px and less (the phone layout, option B, 20/11/2026) the rail is not
 * drawn: the bar of tabs at the bottom is the same sign that the app is open.
 */
export async function criarContaEEntrar(page, opcoes = {}) {
  await criarConta(page, opcoes)
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .or(page.locator(".separadores"))
    .first()
    .waitFor({ timeout: opcoes.entrada ?? 90_000 })
}
