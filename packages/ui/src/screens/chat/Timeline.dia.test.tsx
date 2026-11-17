import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { definirLingua } from "../../strings.js"
import { formatarDataEHora, formatarDia } from "../../lib/format.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
afterEach(() => {
  cleanup()
  definirLingua("pt")
})
const noop = (): void => {}
const local = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime()
const msg = (seq: number, at: number, sender = "@a:s"): ChatMessage => ({
  channel: "!c:s",
  seq,
  sender,
  payload: { t: "message", id: `m${seq}`, sentAt: at, body: `linha ${seq}` },
})
const timeline = (messages: ChatMessage[]): React.JSX.Element => (
  <Timeline channel="!c:s" messages={messages} pending={[]} onRetry={noop} onDiscard={noop} me={null} nameFor={(s) => s} directory={new Map<string, Profile>()} />
)

describe("o separador do dia", () => {
  it("um cabeçalho antes da primeira mensagem de cada dia local, certo à meia-noite", () => {
    render(timeline([msg(1, local(11, 23, 59)), msg(2, local(12, 0, 0)), msg(3, local(12, 9))]))
    const dias = screen.getAllByRole("heading", { level: 2 })
    expect(dias.map((d) => d.textContent)).toEqual(["11 de novembro de 2026", "12 de novembro de 2026"])
  })

  it("em inglês, November 12, 2026", () => {
    definirLingua("en")
    expect(formatarDia(local(12, 9))).toBe("November 12, 2026")
  })

  it("com mais história carregada à frente, não repete", () => {
    const { rerender } = render(timeline([msg(3, local(12, 9)), msg(4, local(12, 10))]))
    rerender(<ToastProvider>{timeline([msg(1, local(12, 7)), msg(2, local(12, 8)), msg(3, local(12, 9)), msg(4, local(12, 10))])}</ToastProvider>)
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1)
  })

  it("fica fora da cópia, e a hora mostra data e hora completas ao passar o rato", () => {
    const { container } = render(timeline([msg(1, local(12, 9))]))
    expect(container.querySelector(".timeline-dia")).not.toBeNull()
    expect(container.querySelector(".message time")?.getAttribute("title")).toBe(formatarDataEHora(local(12, 9)))
  })
})
