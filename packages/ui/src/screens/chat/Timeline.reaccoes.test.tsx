import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FichaDeReaccao } from "@enclave/client-core"
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
const NOMES: Record<string, string> = { [ANA]: "Ana", [BRUNO]: "Bruno" }

const mensagem: ChatMessage = {
  channel: "!sala:s",
  seq: 1,
  sender: BRUNO,
  payload: { t: "message", id: "m1", sentAt: 1, body: "Quem vem amanhã?" },
}

function timeline(overrides: Partial<React.ComponentProps<typeof Timeline>>): React.JSX.Element {
  return (
    <Timeline
      channel="!sala:s"
      messages={[mensagem]}
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

const fichas: FichaDeReaccao[] = [
  { emoji: "👍", quem: [ANA, BRUNO], minha: true },
  { emoji: "🎉", quem: [BRUNO], minha: false },
]

describe("reacções na conversa", () => {
  it("desenha uma ficha por emoji com a contagem, e a minha marcada", () => {
    render(timeline({ reaccoes: new Map([["m1", fichas]]), onReagir: noop }))
    const minha = screen.getByRole("button", { name: strings.reaccoes.rotulo("👍", 2, true) })
    const outra = screen.getByRole("button", { name: strings.reaccoes.rotulo("🎉", 1, false, true) })
    expect(minha.getAttribute("aria-pressed")).toBe("true")
    expect(outra.getAttribute("aria-pressed")).toBe("false")
    expect(minha.textContent).toContain("2")
    // Who reacted, on hover, by current name.
    expect(minha.getAttribute("data-tip")).toBe(strings.reaccoes.quem(["Ana", "Bruno"], "👍"))
  })

  it("tocar na ficha junta ou retira a minha", async () => {
    const user = userEvent.setup()
    const onReagir = vi.fn()
    render(timeline({ reaccoes: new Map([["m1", fichas]]), onReagir }))
    await user.click(screen.getByRole("button", { name: strings.reaccoes.rotulo("🎉", 1, false, true) }))
    expect(onReagir).toHaveBeenCalledWith(mensagem, "🎉")
  })

  it("o botão Reagir, ao passar o rato, pede o selector para esta mensagem", async () => {
    const user = userEvent.setup()
    const onPedirReaccao = vi.fn()
    render(timeline({ onReagir: noop, onPedirReaccao }))
    await user.click(screen.getByRole("button", { name: strings.reaccoes.reagir }))
    expect(onPedirReaccao).toHaveBeenCalledWith(mensagem)
  })

  it("sem quem envie (anfitrião antigo), as fichas lêem-se mas não se tocam, e não há botão", () => {
    render(timeline({ reaccoes: new Map([["m1", fichas]]) }))
    expect(screen.getByRole("button", { name: strings.reaccoes.rotulo("👍", 2, true) })).toHaveProperty("disabled", true)
    expect(screen.queryByRole("button", { name: strings.reaccoes.reagir })).toBeNull()
  })
})

describe("uma mensagem que me menciona", () => {
  it("fica destacada, e as outras não", () => {
    const comigo: ChatMessage = { ...mensagem, payload: { ...mensagem.payload, mentions: ["&porteiro", ANA] } }
    const { container, rerender } = render(timeline({ messages: [comigo] }))
    expect(container.querySelector(".message.menciona-me")).not.toBeNull()
    rerender(<ToastProvider>{timeline({ messages: [mensagem] })}</ToastProvider>)
    expect(container.querySelector(".message.menciona-me")).toBeNull()
  })
})
