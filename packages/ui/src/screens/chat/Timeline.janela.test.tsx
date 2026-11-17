import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render as baseRender } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { LAST_READ_KEY } from "../../hooks/useUnreads.js"
import { Timeline } from "./Timeline.js"

/**
 * The timeline draws a window, not the whole conversation.
 *
 * A channel switch drew every line in memory (150 to 400) and laid them all
 * out: 150 to 370 ms on a slow laptop, in one task. Now the switch draws the
 * last lines only, and the window grows upward as the reader scrolls up. What
 * is proven here is what a person sees: the last lines at once, older lines
 * when going up, the line a search jumped to, and the unread mark when asked.
 */
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
afterEach(() => {
  cleanup()
  localStorage.clear()
})
const noop = (): void => {}
const muitas = (n: number, canal = "!sala:s"): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    channel: canal,
    seq: i + 1,
    sender: i % 2 ? "@a:s" : "@b:s",
    payload: { t: "message", id: `id-${i + 1}`, sentAt: (i + 1) * 600_000, body: `linha ${i + 1}` },
  }))
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
const linhas = (): string[] => [...document.querySelectorAll(".timeline .message")].map((el) => el.querySelector("p")?.textContent ?? "")
/** jsdom does no layout: the scroller's geometry is set by hand. */
function geometria(el: HTMLElement, g: { scrollTop: number; clientHeight: number; scrollHeight: number }): void {
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => g.clientHeight })
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => g.scrollHeight })
  el.scrollTop = g.scrollTop
}

describe("a conversa desenha uma janela, e não as linhas todas", () => {
  it("com 300 linhas, desenha as últimas, e a última está lá", () => {
    render(<Timeline {...props({ messages: muitas(300) })} />)
    const vistas = linhas()
    expect(vistas.length).toBeLessThanOrEqual(60)
    expect(vistas.length).toBeGreaterThanOrEqual(30)
    expect(vistas.at(-1)).toBe("linha 300")
  })

  it("com poucas linhas, desenha todas", () => {
    render(<Timeline {...props({ messages: muitas(12) })} />)
    expect(linhas()).toHaveLength(12)
  })

  it("subir até perto do topo desenha as anteriores, e quem lê fica na mesma linha", () => {
    render(<Timeline {...props({ messages: muitas(300) })} />)
    const antes = linhas().length
    const el = document.querySelector(".timeline") as HTMLElement
    geometria(el, { scrollTop: 100, clientHeight: 800, scrollHeight: 4000 })
    act(() => {
      // The window grows, the content above grows by 2000 px: the reader must stay on the same line.
      Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => (linhas().length > antes ? 6000 : 4000) })
      fireEvent.scroll(el)
    })
    expect(linhas().length).toBeGreaterThan(antes)
    expect(el.scrollTop).toBe(2100)
  })

  it("chegar a uma linha nova no fundo não tira linhas de cima", () => {
    const mensagens = muitas(300)
    const { rerender } = render(<Timeline {...props({ messages: mensagens })} />)
    const primeira = linhas()[0]
    rerender(<Timeline {...props({ messages: [...mensagens, ...muitas(301).slice(300)] })} />)
    expect(linhas()[0]).toBe(primeira)
    expect(linhas().at(-1)).toBe("linha 301")
  })

  it("com quem lê preso ao fundo, o que chega desliza a janela: cem linhas novas não ficam todas desenhadas", () => {
    /*
      A window that only grows drew one more line per message: a window hidden
      for 15 minutes with a message a second came back with ~750 new lines to
      lay out, and a channel switch then deleted them all. At the bottom, the
      top lines are out of view, and dropping them moves nothing the reader sees.
    */
    const mensagens = muitas(300)
    const { rerender } = render(<Timeline {...props({ messages: mensagens })} />)
    let agora = mensagens
    for (let lote = 0; lote < 10; lote++) {
      agora = muitas(300 + (lote + 1) * 10)
      rerender(<Timeline {...props({ messages: agora })} />)
    }
    expect(linhas().at(-1)).toBe("linha 400")
    expect(linhas().length).toBeLessThanOrEqual(70)
  })

  it("com quem lê lá em cima, o que chega não tira linhas de cima", () => {
    const mensagens = muitas(300)
    const { rerender } = render(<Timeline {...props({ messages: mensagens })} />)
    const el = document.querySelector(".timeline") as HTMLElement
    const primeira = linhas()[0]
    // Scrolled up, away from the bottom.
    geometria(el, { scrollTop: 900, clientHeight: 800, scrollHeight: 4000 })
    act(() => fireEvent.scroll(el))
    geometria(el, { scrollTop: 800, clientHeight: 800, scrollHeight: 4000 })
    act(() => fireEvent.scroll(el))
    rerender(<Timeline {...props({ messages: muitas(400) })} />)
    expect(linhas()[0]).toBe(primeira)
    expect(linhas().at(-1)).toBe("linha 400")
  })

  it("a linha para onde a procura saltou aparece, mesmo sendo antiga", () => {
    Element.prototype.scrollIntoView = function () {}
    const { rerender } = render(<Timeline {...props({ messages: muitas(300) })} />)
    expect(linhas()).not.toContain("linha 10")
    rerender(<Timeline {...props({ messages: muitas(300), destacada: "id-10" })} />)
    expect(linhas()).toContain("linha 10")
  })

  it("com mais por ler do que cabe na janela, o salto para o por ler leva à marca", () => {
    Element.prototype.scrollIntoView = function () {}
    // Read up to line 100 (sentAt 100 * 600000): 200 unread, more than the window.
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!sala:s": 100 * 600_000 }))
    render(<Timeline {...props({ messages: muitas(300) })} />)
    expect(document.querySelector(".timeline-unread-mark")).toBeNull()
    const salto = document.querySelector(".timeline-unread-jump") as HTMLButtonElement
    expect(salto).toBeTruthy()
    act(() => salto.click())
    const marca = document.querySelector(".timeline-unread-mark")
    expect(marca?.nextElementSibling?.querySelector("p")?.textContent).toBe("linha 101")
  })

  it("'Carregar mais antigas' só aparece quando a janela já chegou ao princípio", () => {
    render(<Timeline {...props({ messages: muitas(300), canLoadOlder: true, onLoadOlder: noop })} />)
    expect(document.querySelector(".timeline-load-older")).toBeNull()
    cleanup()
    render(<Timeline {...props({ messages: muitas(12), canLoadOlder: true, onLoadOlder: noop })} />)
    expect(document.querySelector(".timeline-load-older")).toBeTruthy()
  })

  it("mudar de conversa desenha as últimas da conversa nova", () => {
    const { rerender } = render(<Timeline {...props({ messages: muitas(300) })} />)
    rerender(<Timeline {...props({ channel: "!outra:s", messages: muitas(250, "!outra:s") })} />)
    expect(linhas().at(-1)).toBe("linha 250")
    expect(linhas().length).toBeLessThanOrEqual(60)
  })

  /*
    A tall screen: the last `JANELA` lines fit in the scroller, there is no
    scrollbar, no `scroll` ever fires, and the window never grew. The reader saw
    30 lines and had no way up. The window now grows until the drawn lines are
    at least two scroller heights tall. jsdom does no layout: each drawn line is
    `ALTURA` px, measured from the DOM on every read.
  */
  describe("num ecrã alto, a janela cresce até haver por onde subir", () => {
    const ALTURA = 40
    const original = {
      clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
      scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
    }
    function ecra(altura: number): void {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("timeline") ? altura : 0
        },
      })
      Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true,
        get(this: Element) {
          return this.classList.contains("timeline") ? this.querySelectorAll(".message").length * ALTURA : 0
        },
      })
    }
    afterEach(() => {
      for (const [nome, descritor] of Object.entries(original)) {
        const alvo = nome === "clientHeight" ? HTMLElement.prototype : Element.prototype
        if (descritor) Object.defineProperty(alvo, nome, descritor)
        else delete (alvo as unknown as Record<string, unknown>)[nome]
      }
    })

    for (const [nome, altura] of [
      ["1440p", 1300],
      ["4K", 2050],
    ] as const) {
      it(`a ${nome}: as linhas desenhadas passam de duas alturas, sem barra nem scroll`, () => {
        ecra(altura)
        render(<Timeline {...props({ messages: muitas(300) })} />)
        expect(linhas().length * ALTURA).toBeGreaterThanOrEqual(2 * altura)
        expect(linhas().at(-1)).toBe("linha 300")
      })

      it(`a ${nome}: preso ao fundo, o que chega não apara e volta a crescer a cada mensagem`, () => {
        ecra(altura)
        const { rerender } = render(<Timeline {...props({ messages: muitas(300) })} />)
        const desenhadas: number[] = []
        for (let n = 301; n <= 340; n++) {
          rerender(<Timeline {...props({ messages: muitas(n) })} />)
          desenhadas.push(linhas().length)
        }
        expect(linhas().at(-1)).toBe("linha 340")
        // Always tall enough to scroll up, and bounded: it slides, it does not pile up.
        expect(Math.min(...desenhadas) * ALTURA).toBeGreaterThanOrEqual(2 * altura)
        expect(Math.max(...desenhadas) * ALTURA).toBeLessThan(2 * altura + 2 * 40 * ALTURA)
      })
    }

    it("com poucas linhas num ecrã alto, desenha todas e mostra 'Carregar mais antigas'", () => {
      ecra(2050)
      render(<Timeline {...props({ messages: muitas(60), canLoadOlder: true, onLoadOlder: noop })} />)
      expect(linhas()).toHaveLength(60)
      expect(document.querySelector(".timeline-load-older")).toBeTruthy()
    })
  })
})
