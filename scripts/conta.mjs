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
 * `memorizar`: the "Remember session" checkbox (session memory F1). It comes
 * on on the screen, by design; here it comes OFF by default, so
 * scripts written before it keep proving what they proved (a new tab asks for
 * the password). Whoever wants memory passes `memorizar: true`.
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
export async function criarConta(page, { nome, frase = FRASE, servidor, timeout = 60_000, memorizar = false, canalOficial = true, ficheiro = true } = {}) {
  const campoNome = page.getByPlaceholder("Como queres aparecer")
  // Since phase 8.1 Setup can open with "Do you use Orwell on another device?".
  // A new account answers "No". We wait for whichever comes first: the question,
  // or the name (an unpaired host doesn't ask).
  const naoCriar = page.getByRole("button", { name: "Não, criar conta" })
  await campoNome.or(naoCriar).first().waitFor({ timeout })
  if (await naoCriar.count()) {
    await naoCriar.click()
    await campoNome.waitFor({ timeout })
  }
  await campoNome.fill(nome)

  if (servidor) {
    await page.getByRole("button", { name: "Opções avançadas" }).click()
    await page.getByLabel("Servidor").fill(servidor)
  }

  const frases = () => page.locator('.gate-card input[type="password"]')
  /*
    By buttons, not by page titles, which change wording (questions became
    direct titles). "Next" or "Continue" to move on, "Skip" for what can be
    skipped (the photo), "Create" or "Create account" at the end.
    */
  const continuar = () => page.getByRole("button", { name: /^(Continuar|Seguinte)$/ })
  const saltar = () => page.getByRole("button", { name: "Saltar", exact: true })
  const criar = () => page.getByRole("button", { name: /^Criar( conta)?$/ })

  // Move forward to the page asking for the password, skipping what can be
  // skipped. The cap of eight loops is for a screen that gains steps without
  // telling this file: better to fail fast than loop forever.
  for (let volta = 0; volta < 8; volta++) {
    if (await frases().count()) break
    if (await saltar().count()) {
      await saltar().click()
      // The next page draws after the click: without the pause, the loop would still
      // see the page we left.
      await page.waitForTimeout(200)
      continue
    }
    if (!(await continuar().count())) break
    await continuar().click()
    await page.waitForTimeout(200)
  }

  // On a host that stores the key in the system (Electron) there's no password
  // to type, and the page we stopped at is already the last one.
  if (await frases().count()) {
    await frases().first().fill(frase)
    const caixa = page.locator('input[name="memorizar"]')
    if (await caixa.count()) await caixa.setChecked(memorizar)
    if (await continuar().count()) {
      await continuar().click()
      // The confirmation is a new page, with a new field: wait for it by the button
      // only it has, not by the field that looks like the other one.
      await criar().waitFor({ timeout })
      await frases().first().fill(frase)
    }
  }

  if (canalOficial !== null) {
    const caixaDoCanal = page.locator('input[name="canal-oficial"]')
    if (await caixaDoCanal.count()) await caixaDoCanal.setChecked(canalOficial)
  }

  await criar().click()
  if (ficheiro) await passarOFicheiroDaConta(page, { timeout })
}

/**
 * The account-file step: download, tick "Guardei o ficheiro num sítio seguro.",
 * "Continuar". Returns the download, for whoever wants to look at the file.
 */
export async function passarOFicheiroDaConta(page, { timeout = 90_000 } = {}) {
  const passo = page.getByRole("heading", { name: "Guarda o ficheiro da conta" })
  // A build from before the step (the old web in `e2e-cliente-antigo`) opens the app straight away.
  const app = page.getByRole("button", { name: "Configurações", exact: true }).first()
  await passo.or(app).first().waitFor({ timeout })
  if (!(await passo.count())) return null
  const botao = page.getByRole("button", { name: "Descarregar o ficheiro da conta" })
  await botao.and(page.locator(":enabled")).waitFor({ timeout })
  const [descarga] = await Promise.all([page.waitForEvent("download", { timeout }), botao.click()])
  await page.getByRole("checkbox", { name: "Guardei o ficheiro num sítio seguro." }).check()
  await page.getByRole("button", { name: "Continuar", exact: true }).click()
  return descarga
}

/**
 * The same, plus waiting for the application to be open.
 *
 * It's what almost all scripts do next, and writing the `waitFor` by hand
 * thirty times is how we got here. The Settings button only exists after the
 * account is created, connected, and has a profile.
 */
export async function criarContaEEntrar(page, opcoes = {}) {
  await criarConta(page, opcoes)
  await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: opcoes.entrada ?? 90_000 })
}
