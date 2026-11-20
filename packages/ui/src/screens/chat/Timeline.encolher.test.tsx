import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render as baseRender } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

/**
 * The conversation shrinks from below, and the reader at the bottom stays at
 * the bottom (20/11/2026).
 *
 * The bug, as reported: "the Replying to bar sits on top of the
 * conversation text". Measured live (`scripts/capturar-composer-toques.mjs`):
 * the composer is in the grid flow, and the conversation does shrink by 48 px
 * when the bar opens. But a shrinking scroller keeps its `scrollTop`, and
 * fires no `scroll` event. The last 48 px of the conversation went below the
 * new edge, so the last line looked covered by the bar. The same happens with
 * an attachment preview, the "who is typing" line, a taller text box and the
 * phone keyboard.
 *
 * jsdom has no layout: the height of the content is one hundred pixels per
 * line, the view height is a variable, and `ResizeObserver` is a fake that the
 * test fires by hand.
 */

const ALTURA_DA_LINHA = 100
let vista = 500
const topo = new WeakMap<Element, number>()
const observados: { callback: ResizeObserverCallback; alvos: Element[] }[] = []

class ObservadorFalso {
  private readonly registo: { callback: ResizeObserverCallback; alvos: Element[] }
  constructor(callback: ResizeObserverCallback) {
    this.registo = { callback, alvos: [] }
    observados.push(this.registo)
  }
  observe(alvo: Element): void {
    this.registo.alvos.push(alvo)
  }
  unobserve(): void {}
  disconnect(): void {
    this.registo.alvos = []
  }
}

/** The browser saw the scroller change size. */
function redimensionar(novaVista: number): void {
  vista = novaVista
  act(() => {
    for (const registo of observados) {
      if (registo.alvos.length > 0) registo.callback([], registo as unknown as ResizeObserver)
    }
  })
}

const originais: Record<string, PropertyDescriptor | undefined> = {}
const observadorOriginal = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = ObservadorFalso as unknown as typeof ResizeObserver
  const proto = HTMLElement.prototype
  for (const nome of ["scrollHeight", "clientHeight", "scrollTop"]) {
    originais[nome] = Object.getOwnPropertyDescriptor(Element.prototype, nome) ?? Object.getOwnPropertyDescriptor(proto, nome)
  }
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("timeline") ? this.querySelectorAll(".message").length * ALTURA_DA_LINHA : 0
    },
  })
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("timeline") ? vista : 0
    },
  })
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      const maximo = Math.max(0, this.scrollHeight - this.clientHeight)
      return Math.min(topo.get(this) ?? 0, maximo)
    },
    set(this: HTMLElement, valor: number) {
      const maximo = Math.max(0, this.scrollHeight - this.clientHeight)
      topo.set(this, Math.max(0, Math.min(valor, maximo)))
    },
  })
})

afterAll(() => {
  globalThis.ResizeObserver = observadorOriginal
  for (const [nome, descritor] of Object.entries(originais)) {
    if (descritor) Object.defineProperty(HTMLElement.prototype, nome, descritor)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[nome]
  }
})

afterEach(() => {
  cleanup()
  observados.length = 0
  vista = 500
})

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
const noop = (): void => {}

function mensagens(quantas: number): ChatMessage[] {
  return Array.from({ length: quantas }, (_, i) => ({
    channel: "!canal:s",
    seq: i + 1,
    sender: "@abc:s",
    payload: { t: "message", id: `m-${i + 1}`, sentAt: (i + 1) * 1000, body: `linha ${i + 1}` },
  }))
}

function timeline(): React.JSX.Element {
  return (
    <Timeline
      channel="!canal:s"
      conversa="!canal:s|"
      messages={mensagens(20)}
      pending={[]}
      onRetry={noop}
      onDiscard={noop}
      me={null}
      nameFor={(sender) => sender}
      directory={new Map<string, Profile>()}
    />
  )
}

const scroller = (): HTMLElement => document.querySelector<HTMLElement>(".timeline")!
const distanciaAoFundo = (): number => scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight

describe("a conversa encolhe por baixo", () => {
  it("quem estava no fundo continua no fundo quando a barra de resposta abre", () => {
    render(timeline())
    expect(distanciaAoFundo()).toBe(0)
    // The reply bar opened: the scroller lost 48 px at the bottom.
    redimensionar(452)
    expect(distanciaAoFundo()).toBe(0)
  })

  it("e continua no fundo quando a barra fecha", () => {
    render(timeline())
    redimensionar(452)
    redimensionar(500)
    expect(distanciaAoFundo()).toBe(0)
  })

  it("quem estava a ler acima fica na mesma linha", () => {
    render(timeline())
    scroller().scrollTop = 600
    fireEvent.scroll(scroller())
    redimensionar(452)
    expect(scroller().scrollTop).toBe(600)
  })
})
