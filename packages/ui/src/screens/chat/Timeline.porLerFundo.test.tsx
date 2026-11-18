import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render as baseRender } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { esquecerMarcasDeEntrada, writeLastRead } from "../../hooks/useUnreads.js"
import { Timeline } from "./Timeline.js"

/**
 * The "N unread messages" bar stays after reading (17/11/2026, the owner:
 * "it keeps showing the unread badge at the top; it does not go away after
 * reading").
 *
 * Two causes, both in `reavaliarSalto`:
 * - when the unread mark is ABOVE the drawn window (more unread than the window
 *   draws, or the window slid at the bottom and dropped it), the bar showed by
 *   that alone, ignoring that it was already done with in this visit;
 * - reaching the bottom by scrolling did not end it. Like Discord, reading down
 *   to the end with the window in front does.
 *
 * jsdom has no layout: each test sets the geometry by hand.
 */

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
const CANAL = "!sala:s"
const noop = (): void => {}

let topoDaMarca = -400

beforeEach(() => {
  localStorage.clear()
  esquecerMarcasDeEntrada()
  topoDaMarca = -400
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const caixa = this.classList.contains("timeline-unread-mark")
      ? { top: topoDaMarca, bottom: topoDaMarca + 20 }
      : { top: 0, bottom: 500 }
    return { ...caixa, left: 0, right: 300, width: 300, height: caixa.bottom - caixa.top, x: 0, y: caixa.top, toJSON: () => ({}) }
  })
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const muitas = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    channel: CANAL,
    seq: i + 1,
    sender: "@outro:s",
    payload: { t: "message", id: `id-${i + 1}`, sentAt: (i + 1) * 100, body: `linha ${i + 1}` },
  }))

const timeline = (messages: ChatMessage[]): React.JSX.Element => (
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

const barra = (): Element | null => document.querySelector(".timeline-unread-jump")
const scroller = (): HTMLElement => document.querySelector(".timeline") as HTMLElement
function geometria(g: { scrollTop: number; clientHeight: number; scrollHeight: number }): void {
  const el = scroller()
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => g.clientHeight })
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => g.scrollHeight })
  el.scrollTop = g.scrollTop
}

describe("a barra de mensagens por ler sai depois de lido", () => {
  it("com a marca acima da janela, descer até ao fim tira a barra", () => {
    // 200 unread, more than the window draws: the mark is not drawn.
    writeLastRead({ [CANAL]: 100 * 100 })
    render(timeline(muitas(300)))
    expect(barra()).not.toBeNull()
    // The reader went up a bit to read, then down to the end.
    act(() => {
      geometria({ scrollTop: 5000, clientHeight: 800, scrollHeight: 10_000 })
      fireEvent.scroll(scroller())
    })
    expect(barra()).not.toBeNull()
    act(() => {
      geometria({ scrollTop: 9200, clientHeight: 800, scrollHeight: 10_000 })
      fireEvent.scroll(scroller())
    })
    expect(barra()).toBeNull()
  })

  it("chegar ao fim com a janela tapada não conta como lido", () => {
    writeLastRead({ [CANAL]: 100 * 100 })
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    render(timeline(muitas(300)))
    act(() => {
      geometria({ scrollTop: 5000, clientHeight: 800, scrollHeight: 10_000 })
      fireEvent.scroll(scroller())
    })
    act(() => {
      geometria({ scrollTop: 9200, clientHeight: 800, scrollHeight: 10_000 })
      fireEvent.scroll(scroller())
    })
    expect(barra()).not.toBeNull()
  })

  it("a marca já vista não faz voltar a barra quando a janela desliza e a deixa de fora", () => {
    writeLastRead({ [CANAL]: 150 })
    const { rerender } = render(timeline(muitas(3)))
    expect(barra()).not.toBeNull()
    // The mark comes into view: done with for this visit.
    topoDaMarca = 100
    act(() => {
      fireEvent.scroll(scroller())
    })
    expect(barra()).toBeNull()
    // 100 lines arrive with the reader at the bottom: the window slides and drops the mark.
    rerender(timeline(muitas(103)))
    expect(document.querySelector(".timeline-unread-mark")).toBeNull()
    expect(barra()).toBeNull()
  })

  it("Esc tira a barra", () => {
    writeLastRead({ [CANAL]: 100 * 100 })
    render(timeline(muitas(300)))
    expect(barra()).not.toBeNull()
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" })
    })
    expect(barra()).toBeNull()
  })
})
