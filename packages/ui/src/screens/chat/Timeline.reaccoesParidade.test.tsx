import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render as baseRender, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FichaDeReaccao } from "@enclave/client-core"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { lembrarEmoji } from "../../lib/emojiFrequentes.js"
import { readPrefs } from "../../hooks/usePrefs.js"
import { Timeline } from "./Timeline.js"

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const noop = (): void => {}
const ANA = "@ana:s"
const BRUNO = "@bruno:s"
const CARLA = "@carla:s"
const DORA = "@dora:s"
const NOMES: Record<string, string> = { [ANA]: "Ana", [BRUNO]: "Bruno", [CARLA]: "Carla", [DORA]: "Dora" }

const linha = (id: string, seq: number): ChatMessage => ({
  channel: "!sala:s",
  seq,
  sender: BRUNO,
  payload: { t: "message", id, sentAt: seq * 600_000, body: `Frase ${id}` },
})
const M1 = linha("m1", 1)
const M2 = linha("m2", 2)
const M3 = linha("m3", 3)

function timeline(overrides: Partial<React.ComponentProps<typeof Timeline>>): React.JSX.Element {
  return (
    <Timeline
      channel="!sala:s"
      messages={[M1]}
      pending={[]}
      onRetry={noop}
      onDiscard={noop}
      me={ANA}
      nameFor={(sender) => NOMES[sender] ?? sender}
      directory={new Map<string, Profile>()}
      {...overrides}
    />
  )
}

const artigo = (texto: string): HTMLElement => screen.getByText(texto).closest("article") as HTMLElement

describe("as reacções rápidas da barra", () => {
  it("são três, antes de Reagir, e de fábrica 👍 ❤️ 😂", () => {
    render(timeline({ onReagir: noop, onPedirReaccao: noop }))
    const botoes = within(artigo("Frase m1").querySelector(".msg-actions") as HTMLElement).getAllByRole("button")
    expect(botoes.slice(0, 4).map((b) => b.getAttribute("aria-label"))).toEqual([
      strings.reaccoes.rapida("👍", false),
      strings.reaccoes.rapida("❤️", false),
      strings.reaccoes.rapida("😂", false),
      strings.reaccoes.reagir,
    ])
  })

  it("um toque reage e conta o uso; numa que já é minha, retira e não conta", async () => {
    const user = userEvent.setup()
    const onReagir = vi.fn()
    const fichas: FichaDeReaccao[] = [{ emoji: "👍", quem: [ANA], minha: true }]
    render(timeline({ onReagir, onPedirReaccao: noop, reaccoes: new Map([["m1", fichas]]) }))
    await user.click(screen.getByRole("button", { name: strings.reaccoes.rapida("❤️", false, true) }))
    expect(onReagir).toHaveBeenLastCalledWith(M1, "❤️")
    expect(readPrefs().emojiUsos.map((uso) => uso.e)).toEqual(["❤️"])
    const minha = screen.getByRole("button", { name: strings.reaccoes.rapida("👍", true) })
    expect(minha.getAttribute("aria-pressed")).toBe("true")
    await user.click(minha)
    expect(onReagir).toHaveBeenLastCalledWith(M1, "👍")
    expect(readPrefs().emojiUsos.map((uso) => uso.e)).toEqual(["❤️"])
  })

  it("seguem o que a pessoa usa, sem redesenhar a linha à volta", () => {
    const nameFor = vi.fn((sender: string) => NOMES[sender] ?? sender)
    const fichas: FichaDeReaccao[] = [{ emoji: "🎉", quem: [CARLA], minha: false }]
    render(timeline({ onReagir: noop, onPedirReaccao: noop, nameFor, reaccoes: new Map([["m1", fichas]]) }))
    nameFor.mockClear()
    act(() => {
      lembrarEmoji("🔥")
      lembrarEmoji("🔥")
    })
    expect(screen.getByRole("button", { name: strings.reaccoes.rapida("🔥", false) })).toBeTruthy()
    // The chips of the line call `nameFor` when the line draws: nobody did.
    expect(nameFor).not.toHaveBeenCalled()
  })

  it("não aparecem onde não se pode reagir", () => {
    render(timeline({ onReagir: noop }))
    expect(screen.queryByRole("button", { name: strings.reaccoes.rapida("👍", false) })).toBeNull()
  })
})

describe("as fichas, como no Discord", () => {
  it("uma reacção que chega ao vivo só redesenha a linha dela", () => {
    const nameFor = vi.fn((sender: string) => NOMES[sender] ?? sender)
    const f1: FichaDeReaccao[] = [{ emoji: "👍", quem: [CARLA], minha: false }]
    const f2: FichaDeReaccao[] = [{ emoji: "👍", quem: [BRUNO], minha: false }]
    const f3: FichaDeReaccao[] = [{ emoji: "👍", quem: [DORA], minha: false }]
    const props = { messages: [M1, M2, M3], onReagir: noop, nameFor }
    const { rerender } = render(timeline({ ...props, reaccoes: new Map([["m1", f1], ["m2", f2], ["m3", f3]]) }))
    nameFor.mockClear()
    const f2depois: FichaDeReaccao[] = [{ emoji: "👍", quem: [BRUNO, ANA], minha: true }]
    rerender(timeline({ ...props, reaccoes: new Map([["m1", f1], ["m2", f2depois], ["m3", f3]]) }))
    const chamados = new Set(nameFor.mock.calls.map(([quem]) => quem))
    expect(chamados.has(ANA)).toBe(true)
    expect(chamados.has(CARLA)).toBe(false)
    expect(chamados.has(DORA)).toBe(false)
  })

  it("o botão direito numa ficha abre quem reagiu, nesse emoji, e não o menu da mensagem", () => {
    const onVerReaccoes = vi.fn()
    const onMessageMenu = vi.fn()
    const fichas: FichaDeReaccao[] = [{ emoji: "🎉", quem: [BRUNO], minha: false }]
    render(timeline({ onReagir: noop, onVerReaccoes, onMessageMenu, reaccoes: new Map([["m1", fichas]]) }))
    fireEvent.contextMenu(screen.getByRole("button", { name: strings.reaccoes.rotulo("🎉", 1, false) }))
    expect(onVerReaccoes).toHaveBeenCalledWith(M1, "🎉")
    expect(onMessageMenu).not.toHaveBeenCalled()
  })

  it("a primeira ficha de uma mensagem que já estava no ecrã também entra animada", () => {
    const { container, rerender } = render(timeline({ onReagir: noop }))
    rerender(timeline({ onReagir: noop, reaccoes: new Map([["m1", [{ emoji: "🎉", quem: [DORA], minha: false }]]]) }))
    expect(container.querySelector(".reaccao.nova .reaccao-emoji")?.textContent).toBe("🎉")
  })

  it("uma ficha nova entra animada, as que já lá estavam não; uma contagem que muda rola", () => {
    const antes: FichaDeReaccao[] = [{ emoji: "👍", quem: [BRUNO], minha: false }]
    const { container, rerender } = render(timeline({ onReagir: noop, reaccoes: new Map([["m1", antes]]) }))
    expect(container.querySelector(".reaccao.nova")).toBeNull()
    expect(container.querySelector(".reaccao-n.mudou")).toBeNull()
    const depois: FichaDeReaccao[] = [
      { emoji: "👍", quem: [BRUNO, CARLA], minha: false },
      { emoji: "🎉", quem: [DORA], minha: false },
    ]
    rerender(timeline({ onReagir: noop, reaccoes: new Map([["m1", depois]]) }))
    expect(container.querySelector(".reaccao.nova .reaccao-emoji")?.textContent).toBe("🎉")
    expect(container.querySelector(".reaccao-n.mudou")?.textContent).toBe("2")
  })
})
