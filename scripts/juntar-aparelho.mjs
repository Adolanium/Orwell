/**
 * "Entrar com outro aparelho" and "Juntar um aparelho", written once (21/11/2026).
 *
 * The device with the account opens Settings › Conta e segurança › Juntar um
 * aparelho, which shows the QR code and the code (`code[data-link]`). The new
 * device pastes the code, both show the same three words, both say "Sim, juntar
 * o aparelho", and the new device ends on "Estás dentro" with the account
 * password and "Abrir o Orwell". Twenty-odd scripts paired by hand with the old
 * screens; they call this now, so the next change to these screens changes
 * this file and no other.
 */

/** On the device with the account: open the sheet and return it with the code. */
export async function abrirJuntarUmAparelho(page, { timeout = 20_000 } = {}) {
  if (!(await page.locator(".conta-e-seguranca").isVisible().catch(() => false))) {
    const config = page.getByRole("button", { name: "Configurações", exact: true }).first()
    if (await config.isVisible().catch(() => false)) await config.click()
    else {
      // The phone: Settings is under the "Tu" tab.
      await page.locator(".separadores").getByRole("button", { name: "Tu", exact: true }).click()
      await page.getByRole("button", { name: "Configurações" }).first().click()
    }
    await page.getByRole("button", { name: "Conta e segurança", exact: true }).first().click()
  }
  await page.getByRole("button", { name: "Juntar um aparelho" }).click()
  const folha = page.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  return { folha, link }
}

/** On the new device, already on "Entrar com outro aparelho": paste the code and wait for the words on both screens. */
export async function colarCodigo(page, folha, link, { timeout = 30_000 } = {}) {
  await page.getByLabel("Ou cola o código").fill(link)
  await page.getByRole("button", { name: "Continuar", exact: true }).click()
  await page.locator(".sas-palavras").waitFor({ timeout })
  if (folha) await folha.locator(".sas-palavras").waitFor({ timeout })
}

/** The three words, read from a screen. */
export async function palavrasDe(alvo) {
  return alvo.locator(".sas-palavras").getAttribute("data-palavras")
}

/**
 * "Sim, juntar o aparelho" on both, then "Estás dentro". With the account
 * password from the other device (1.3.26, one password), the field is the
 * CURRENT password and a wrong one stays with Erro 140; with no record, a new
 * one is chosen twice. `errada`: try that one first and return whether Erro 140
 * showed.
 */
export async function confirmarEAbrir(page, folha, frase, { timeout = 90_000, errada } = {}) {
  await page.getByRole("button", { name: "Sim, juntar o aparelho" }).click()
  if (folha) await folha.getByRole("button", { name: "Sim, juntar o aparelho" }).click()
  await page.getByRole("heading", { name: "Estás dentro" }).waitFor({ timeout })
  const daConta = page.locator('input[name="current-password"]')
  let recusou = null
  if (await daConta.count()) {
    if (errada) {
      await daConta.fill(errada)
      await page.getByRole("button", { name: "Abrir o Orwell" }).click()
      // The code, not the sentence: "Erro 140" is assembled from the code table.
      recusou = await page
        .locator('.gate-card [role="alert"]', { hasText: /\b140\b/ })
        .waitFor({ timeout: 30_000 })
        .then(() => true, () => false)
    }
    await daConta.fill(frase)
  } else {
    await page.locator('input[name="new-password"]').fill(frase)
    await page.locator('input[name="confirm-password"]').fill(frase)
  }
  await page.getByRole("button", { name: "Abrir o Orwell" }).click()
  /*
    The device with the account publishes the new device only when it hears
    "ready", after "Abrir o Orwell". Closing its sheet before that cancels the
    pairing, and the new device ends on Error 719 two minutes later.
  */
  if (folha) await folha.getByText("O aparelho novo já está na conta.").waitFor({ timeout })
  return { recusou }
}

/** The whole guest side, from a pasted code to the app opening. */
export async function juntarComPalavras(page, folha, link, frase, opcoes = {}) {
  await colarCodigo(page, folha, link, opcoes)
  return confirmarEAbrir(page, folha, frase, opcoes)
}
