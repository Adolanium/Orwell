import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

/**
 * "Load older" in the timeline (1.3.25): the button shows only when there is
 * something to load, in an empty room too.
 */
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
afterEach(cleanup)
const noop = (): void => {}
const props = (over: Partial<React.ComponentProps<typeof Timeline>>): React.ComponentProps<typeof Timeline> => ({
  channel: "!sala:s",
  messages: [],
  pending: [],
  onRetry: noop,
  onDiscard: noop,
  me: "@eu:s",
  nameFor: (s) => s,
  directory: new Map<string, Profile>(),
  ...over,
})

describe("o botão 'Carregar mais antigas' numa sala vazia", () => {
  it("aparece enquanto há mais para carregar, e sai quando já não há", () => {
    const onLoadOlder = vi.fn()
    const { rerender } = render(<Timeline {...props({ hasStoredHistory: true, canLoadOlder: true, onLoadOlder })} />)
    expect(screen.getAllByText(strings.chat.loadOlder)).toHaveLength(1)
    // The last click reached the start of what this device holds.
    rerender(<Timeline {...props({ hasStoredHistory: true, canLoadOlder: false, onLoadOlder })} />)
    expect(screen.queryByText(strings.chat.loadOlder)).toBeNull()
  })

  it("numa sala nova, sem nada guardado, não aparece", () => {
    render(<Timeline {...props({ canLoadOlder: false, onLoadOlder: noop })} />)
    expect(screen.queryByText(strings.chat.loadOlder)).toBeNull()
  })
})

/**
 * Where the reader is, after the click (from 1.3.25, like
 * Discord). The older lines come in ABOVE, and the conversation stays on the
 * line the reader was looking at. Before, at `scrollTop` 0 the browser does not
 * anchor, and the reader was thrown to the oldest line that came in.
 */
describe("depois de 'Carregar mais antigas', quem lê fica na mesma linha", () => {
  const linhas = (from: number, to: number): ChatMessage[] =>
    Array.from({ length: to - from + 1 }, (_, i) => ({
      channel: "!sala:s",
      seq: from + i,
      sender: "@a:s",
      payload: { t: "message", id: `id-${from + i}`, sentAt: (from + i) * 600_000, body: `linha ${from + i}` },
    }))
  /** jsdom does no layout: every line is 50 px tall, laid out from the scroller's top. */
  function geometria(el: HTMLElement): void {
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 800 })
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => el.querySelectorAll(".message").length * 50 + 40 })
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const indice = [...el.querySelectorAll(".message")].indexOf(this)
      const top = this === el || indice < 0 ? 0 : 40 + indice * 50 - el.scrollTop
      return { top, bottom: top + 50, left: 0, right: 0, width: 0, height: 50, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
  }
  afterEach(() => vi.restoreAllMocks())

  it("cem linhas entram por cima, e a linha que estava no topo continua no mesmo sítio do ecrã", async () => {
    const { rerender } = render(<Timeline {...props({ messages: linhas(101, 120), hasStoredHistory: true, canLoadOlder: true, onLoadOlder: noop })} />)
    const el = document.querySelector(".timeline") as HTMLElement
    geometria(el)
    el.scrollTop = 0
    screen.getByText(strings.chat.loadOlder).click()
    rerender(<Timeline {...props({ messages: linhas(1, 120), hasStoredHistory: true, canLoadOlder: true, onLoadOlder: noop })} />)
    // "linha 101" was at 40 px from the top; 100 lines of 50 px came in above it.
    expect(el.scrollTop).toBe(5000)
    const linha101 = [...el.querySelectorAll(".message")].find((m) => m.getAttribute("data-mensagem") === "id-101") as Element
    expect(linha101.getBoundingClientRect().top).toBe(40)
  })

  it("se quem lê desceu enquanto a página chegava, fica na linha onde está agora", () => {
    const { rerender } = render(<Timeline {...props({ messages: linhas(101, 120), hasStoredHistory: true, canLoadOlder: true, onLoadOlder: noop })} />)
    const el = document.querySelector(".timeline") as HTMLElement
    geometria(el)
    el.scrollTop = 0
    screen.getByText(strings.chat.loadOlder).click()
    el.scrollTop = 120
    el.dispatchEvent(new Event("scroll"))
    rerender(<Timeline {...props({ messages: linhas(1, 120), hasStoredHistory: true, canLoadOlder: true, onLoadOlder: noop })} />)
    expect(el.scrollTop).toBe(5120)
  })

  /*
    Seen in Chromium (e2e-carregar-antigas, Aurora): the line at the top was the first
    of its group, with the name and the hour above the text. The older lines that came
    in are from the same person, so it joined their group and lost the name: its box
    is shorter at the TOP. Held by the top of its box, the text went up by the height
    of the name. The bottom of a line is where its text ends, and does not move.
  */
  it("a linha do topo perde o nome ao juntar-se ao grupo das que entram, e o texto não se mexe", () => {
    const juntas = (from: number, to: number): ChatMessage[] =>
      linhas(from, to).map((m) => ({ ...m, payload: { ...m.payload, sentAt: m.seq * 1_000 } }) as ChatMessage)
    const { rerender } = render(<Timeline {...props({ messages: juntas(101, 120), hasStoredHistory: true, canLoadOlder: true, onLoadOlder: noop })} />)
    const el = document.querySelector(".timeline") as HTMLElement
    // A line with the name is 90 px tall, a grouped line 50 px.
    const altura = (m: Element): number => (m.classList.contains("grouped") ? 50 : 90)
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 800 })
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => [...el.querySelectorAll(".message")].reduce((n, m) => n + altura(m), 40) })
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const todas = [...el.querySelectorAll(".message")]
      const indice = todas.indexOf(this)
      const top = this === el || indice < 0 ? 0 : todas.slice(0, indice).reduce((n, m) => n + altura(m), 40) - el.scrollTop
      const height = indice < 0 ? 0 : altura(this)
      return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
    const linha101 = (): Element => [...el.querySelectorAll(".message")].find((m) => m.getAttribute("data-mensagem") === "id-101") as Element
    expect(linha101().classList.contains("grouped")).toBe(false)
    el.scrollTop = 0
    const fimDoTexto = linha101().getBoundingClientRect().bottom
    screen.getByText(strings.chat.loadOlder).click()
    rerender(<Timeline {...props({ messages: juntas(1, 120), hasStoredHistory: true, canLoadOlder: true, onLoadOlder: noop })} />)
    expect(linha101().classList.contains("grouped")).toBe(true)
    expect(linha101().getBoundingClientRect().bottom).toBe(fimDoTexto)
  })

  it("trocar de sala não é carregar antigas: a sala nova não herda a âncora", () => {
    const { rerender } = render(<Timeline {...props({ messages: linhas(101, 120), hasStoredHistory: true, canLoadOlder: true, onLoadOlder: noop })} />)
    const el = document.querySelector(".timeline") as HTMLElement
    geometria(el)
    el.scrollTop = 0
    screen.getByText(strings.chat.loadOlder).click()
    const outra = linhas(1, 20).map((m) => ({ ...m, channel: "!outra:s" }))
    rerender(<Timeline {...props({ channel: "!outra:s", messages: outra })} />)
    // A switch opens at the bottom, as always.
    expect(el.scrollTop).toBe(el.scrollHeight)
  })
})
