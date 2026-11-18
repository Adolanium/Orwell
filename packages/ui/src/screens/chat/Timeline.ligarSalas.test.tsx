/**
 * Room links in the conversation (17/11/2026): what a reader sees and what a
 * click does. See `lib/etiquetas.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })

afterEach(cleanup)

const noop = (): void => {}
const ANA = "@ana:s"
const BRUNO = "@bruno:s"

const ligacao: ChatMessage = {
  channel: "!espaco:s",
  seq: 1,
  sender: BRUNO,
  payload: { t: "message", id: "m1", sentAt: 1, body: "vejam <#forum-alfa-beta> e <#forum-secreta-sala>" },
}

function timeline(onSala = vi.fn()): React.JSX.Element {
  return (
    <Timeline
      channel="!espaco:s"
      messages={[ligacao]}
      pending={[]}
      onRetry={noop}
      onDiscard={noop}
      me={ANA}
      nameFor={(sender) => (sender === BRUNO ? "Bruno" : sender)}
      directory={new Map<string, Profile>()}
      etiquetas={{
        salaDe: (room) => (room === "forum-alfa-beta" ? { nome: "anúncios" } : null),
        onSala,
      }}
    />
  )
}

describe("uma ligação a uma sala na conversa", () => {
  it("mostra o nome de agora, e tocar abre a sala", async () => {
    const onSala = vi.fn()
    const user = userEvent.setup()
    render(timeline(onSala))
    await user.click(screen.getByRole("button", { name: strings.etiquetas.irParaSala("anúncios") }))
    expect(onSala).toHaveBeenCalledWith("forum-alfa-beta")
  })

  it("uma sala sem acesso é uma pílula neutra, sem nome, e não é botão", () => {
    const { container } = render(timeline())
    const neutra = container.querySelector(".mention-sala-privada")
    expect(neutra?.textContent).toBe(`#${strings.etiquetas.semAcesso}`)
    expect(neutra?.tagName).toBe("SPAN")
    expect(container.innerHTML).not.toContain("secreta")
  })

  it("ligar uma sala não acende a mensagem como menção", () => {
    const { container } = render(timeline())
    expect(container.querySelector(".mention-sala")).not.toBeNull()
    expect(container.querySelector(".message.menciona-me")).toBeNull()
  })
})
