import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { formatTime } from "../../lib/format.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
afterEach(cleanup)
const noop = (): void => {}
const EDITADA_EM = Date.UTC(2026, 10, 12, 14, 5)

const timeline = (messages: ChatMessage[]): React.JSX.Element => (
  <Timeline
    channel="!c:s"
    messages={messages}
    pending={[]}
    onRetry={noop}
    onDiscard={noop}
    me={null}
    nameFor={(s) => s}
    directory={new Map<string, Profile>()}
  />
)

describe("a marca de editada", () => {
  it("fica numa linha própria, fora do parágrafo, e diz a hora ao leitor de ecrã e ao toque", async () => {
    const user = userEvent.setup()
    const { container } = render(
      timeline([{ channel: "!c:s", seq: 1, sender: "@a:s", payload: { t: "message", id: "m1", sentAt: 1, body: "olá", editedAt: EDITADA_EM } }]),
    )
    const marca = container.querySelector(".message-editada") as HTMLElement
    expect(marca).not.toBeNull()
    expect(marca.closest("p")).toBeNull()
    expect(container.querySelector(".message-body p")?.textContent).toBe("olá")
    const completa = strings.chat.editadaAs(formatTime(EDITADA_EM))
    expect(marca.getAttribute("aria-label")).toBe(completa)
    expect(marca.textContent).toBe(strings.chat.editada)
    await user.click(screen.getByRole("button", { name: completa }))
    expect(marca.textContent).toBe(completa)
  })

  it("o texto de uma mensagem que escreve (editada) continua texto, sem a marca", () => {
    const { container } = render(
      timeline([{ channel: "!c:s", seq: 1, sender: "@a:s", payload: { t: "message", id: "m1", sentAt: 1, body: `olá ${strings.chat.editedMark}` } }]),
    )
    expect(container.querySelector(".message-editada")).toBeNull()
  })
})
