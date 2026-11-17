import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render as baseRender, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { esquecerMarcasDeEntrada, writeLastRead } from "../../hooks/useUnreads.js"
import { avisarDadoPorLido } from "../../hooks/usePorLer.js"
import { Timeline } from "./Timeline.js"

/**
 * The "N unread messages" bar (12/11/2026: "it stays at the top of the
 * page forever"). Like Discord: it shows while the unread mark is ABOVE the
 * view, and leaves for this visit once the mark was seen, the bar was tapped, or
 * the channel was marked read.
 *
 * jsdom has no layout: each test says where the mark is, by `getBoundingClientRect`.
 */

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
const CANAL = "!sala:s"
const noop = (): void => {}

/** Where the mark sits against the timeline box (0 to 500). */
let topoDaMarca = -400

beforeEach(() => {
  localStorage.clear()
  esquecerMarcasDeEntrada()
  writeLastRead({ [CANAL]: 150 })
  topoDaMarca = -400
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const caixa = this.classList.contains("timeline-unread-mark")
      ? { top: topoDaMarca, bottom: topoDaMarca + 20 }
      : { top: 0, bottom: 500 }
    return { ...caixa, left: 0, right: 300, width: 300, height: caixa.bottom - caixa.top, x: 0, y: caixa.top, toJSON: () => ({}) }
  })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const msg = (seq: number, sentAt: number): ChatMessage => ({
  channel: CANAL,
  seq,
  sender: "@outro:s",
  payload: { t: "message", id: `id-${seq}`, sentAt, body: `m${seq}` },
})
const mensagens = [msg(1, 100), msg(2, 200), msg(3, 300)]

const timeline = (messages: ChatMessage[] = mensagens): React.JSX.Element => (
  <Timeline
    channel={CANAL}
    messages={messages}
    pending={[]}
    onRetry={noop}
    onDiscard={noop}
    me="@eu:s"
    nameFor={(sender) => sender}
    directory={new Map<string, Profile>()}
  />
)

const barra = (): HTMLElement | null => screen.queryByRole("button", { name: strings.chat.unreadJump(2) })
const rolar = (): void => {
  fireEvent.scroll(document.querySelector(".timeline")!)
}

describe("a barra de mensagens por ler", () => {
  it("aparece com a marca acima da vista, e sai de vez quando a marca entra na vista", () => {
    render(timeline())
    expect(barra()).not.toBeNull()
    topoDaMarca = 100
    rolar()
    expect(barra()).toBeNull()
    // Read past it, down to the bottom: the mark is above again, and the bar does NOT come back.
    topoDaMarca = -800
    rolar()
    expect(barra()).toBeNull()
  })

  it("com a marca abaixo da vista (a ler o que é antigo) não aparece", () => {
    topoDaMarca = 900
    render(timeline())
    expect(barra()).toBeNull()
  })

  it("tocar na barra salta e ela não volta", async () => {
    const user = userEvent.setup()
    render(timeline())
    await user.click(barra()!)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    rolar()
    expect(barra()).toBeNull()
  })

  it("marcar o canal como lido tira a barra e a linha", () => {
    render(timeline())
    expect(barra()).not.toBeNull()
    act(() => avisarDadoPorLido(CANAL))
    expect(barra()).toBeNull()
    expect(document.querySelector(".timeline-unread-mark")).toBeNull()
  })

  it("noutra visita, só volta se houver mensagens novas por ler", () => {
    const { unmount } = render(timeline())
    topoDaMarca = 100
    rolar()
    unmount()
    // Next visit: the stored mark advanced with the reading.
    esquecerMarcasDeEntrada()
    writeLastRead({ [CANAL]: 300 })
    topoDaMarca = -400
    render(timeline())
    expect(screen.queryByRole("button", { name: /unread|por ler|não lidas/i })).toBeNull()
  })
})
