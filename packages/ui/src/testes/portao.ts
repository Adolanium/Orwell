import { fireEvent, screen, waitFor } from "@testing-library/react"
import type userEvent from "@testing-library/user-event"
import { expect } from "vitest"
import { strings } from "../strings.js"

/**
 * The new way in (21/11/2026), for the tests that go through it: the first
 * screen's "Criar conta", the one form, and the account-file step left for
 * later. One place, so the next change to the gate changes this file only.
 */
type Utilizador = ReturnType<typeof userEvent.setup>

export const FRASE_DE_TESTE = "uma frase comprida"

/** The first screen: "Criar conta" opens the form. */
export async function abrirCriarConta(user: Utilizador): Promise<void> {
  await user.click(await screen.findByRole("button", { name: strings.entrada.criarConta }))
  await screen.findByRole("form", { name: strings.entrada.criarConta })
}

/** Fill the form. The password fields by name, as the password manager sees them. */
export async function preencherCriarConta(
  user: Utilizador,
  { nome = "Vera", frase = FRASE_DE_TESTE, outraVez = frase }: { nome?: string; frase?: string; outraVez?: string } = {},
): Promise<void> {
  await user.type(screen.getByLabelText(strings.entrada.nome), nome)
  await user.type(document.querySelector('input[name="new-password"]') as HTMLInputElement, frase)
  await user.type(document.querySelector('input[name="confirm-password"]') as HTMLInputElement, outraVez)
}

/** The submit of the form, by the form: the button can be disabled while the server is asked. */
export function enviarCriarConta(): void {
  fireEvent.submit(screen.getByRole("form", { name: strings.entrada.criarConta }))
}

/** All of it: open, fill, send. */
export async function criarContaNoPortao(user: Utilizador, opcoes: { nome?: string; frase?: string } = {}): Promise<void> {
  await abrirCriarConta(user)
  await preencherCriarConta(user, opcoes)
  const botao = screen.getByRole("button", { name: strings.entrada.criarConta, hidden: false })
  await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false))
  enviarCriarConta()
}

/** "Guarda o ficheiro da conta" → "Fazer mais tarde". */
export async function adiarOFicheiro(user: Utilizador): Promise<void> {
  await user.click(await screen.findByRole("button", { name: strings.entrada.maisTarde }, { timeout: 3000 }))
}
