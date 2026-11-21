import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AppNotification } from "../../lib/notifications.js"
import { strings } from "../../strings.js"
import { NotificationPanel } from "./NotificationPanel.js"

/**
 * "A new device joined the account" in the bell (1.3.26): the entry with the date
 * it joined, and "Remove" only while that device is still in the account. The
 * button comes from the device list (state), never from the entry (record).
 */

afterEach(cleanup)

const CHAVE = "A".repeat(43)
const ENTRADA: AppNotification = { id: `aparelho:${CHAVE}`, kind: "device-new", at: Date.UTC(2026, 10, 21, 9, 30), aparelho: CHAVE, read: false }

function montar(props: Partial<Parameters<typeof NotificationPanel>[0]> = {}): void {
  render(
    <NotificationPanel
      notifications={[ENTRADA]}
      nameFor={(a) => a}
      labelFor={(c) => c}
      directory={new Map()}
      onOpen={vi.fn()}
      onMarkAllRead={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  )
}

describe("o sino: aparelho novo na conta", () => {
  it("diz que entrou um aparelho novo, e Remover chama a revogação dessa chave", async () => {
    const remover = vi.fn()
    montar({ aparelhosNaConta: new Set([CHAVE]), onRemoverAparelho: remover })
    expect(screen.getByText(strings.notifCenter.aparelhoNovo)).toBeTruthy()
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(new Date(ENTRADA.at).toISOString())
    await userEvent.click(screen.getByRole("button", { name: strings.notifCenter.removerAparelho }))
    expect(remover).toHaveBeenCalledWith(CHAVE)
  })

  it("um aparelho que já saiu da conta: a entrada fica, o botão não", () => {
    montar({ aparelhosNaConta: new Set(), onRemoverAparelho: vi.fn() })
    expect(screen.getByText(strings.notifCenter.aparelhoNovo)).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.notifCenter.removerAparelho })).toBeNull()
  })

  it("enquanto remove, o botão fica parado", () => {
    montar({ aparelhosNaConta: new Set([CHAVE]), onRemoverAparelho: vi.fn(), aparelhoARemover: CHAVE })
    expect((screen.getByRole("button", { name: strings.notifCenter.removerAparelho }) as HTMLButtonElement).disabled).toBe(true)
  })
})
