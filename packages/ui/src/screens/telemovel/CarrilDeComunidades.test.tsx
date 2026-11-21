import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { CarrilDeComunidades } from "./CarrilDeComunidades.js"
import { ponteiro } from "../../testes/ponteiro.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const SALA_COMUM = "!comum:casa.pt"
const XADREZ = "!xadrez:casa.pt"
const LEITORES = "!leitores:casa.pt"
const NOMES: Record<string, string> = { [SALA_COMUM]: "Sala comum", [XADREZ]: "Xadrez", [LEITORES]: "Leitores" }

function carril(over: Partial<React.ComponentProps<typeof CarrilDeComunidades>> = {}): React.JSX.Element {
  return (
    <CarrilDeComunidades
      comunidades={[SALA_COMUM, LEITORES, XADREZ]}
      activa={SALA_COMUM}
      labelFor={(canal) => NOMES[canal] ?? canal}
      avisosDe={(canal) => ({
        quantas: canal === XADREZ ? 5 : 0,
        porLer: canal === LEITORES,
        chamada: false,
      })}
      onEscolher={() => {}}
      onMenu={() => {}}
      onNova={() => {}}
      {...over}
    />
  )
}

describe("CarrilDeComunidades", () => {
  it("one face per community, and the open one is marked", () => {
    render(carril())
    expect(screen.getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "Sala comum",
      "Leitores",
      "Xadrez",
      "Criar canal",
    ])
    const aberta = screen.getByRole("button", { name: "Sala comum" })
    expect(aberta.className).toContain("active")
    expect(aberta.getAttribute("aria-current")).toBe("true")
  })

  it("pill for unread, pastille with the number for mentions", () => {
    render(carril())
    expect(screen.getByRole("button", { name: "Leitores" }).querySelector(".rail-pill")).not.toBeNull()
    const xadrez = screen.getByRole("button", { name: "Xadrez" })
    expect(xadrez.querySelector(".rail-count")?.textContent).toBe("5")
    expect(document.getElementById(xadrez.getAttribute("aria-describedby") ?? "")?.textContent).toBe("5 por atender")
  })

  it("tapping a face chooses the community; the + opens the Create channel sheet", () => {
    const onEscolher = vi.fn()
    const onNova = vi.fn()
    render(carril({ onEscolher, onNova }))
    fireEvent.click(screen.getByRole("button", { name: "Xadrez" }))
    fireEvent.click(screen.getByRole("button", { name: "Criar canal" }))
    expect(onEscolher).toHaveBeenCalledWith(XADREZ)
    expect(onNova).toHaveBeenCalledOnce()
  })

  it("no onNova (the account cannot create a channel now): no +", () => {
    render(carril({ onNova: undefined }))
    expect(screen.queryByRole("button", { name: "Criar canal" })).toBeNull()
    expect(screen.getAllByRole("button")).toHaveLength(3)
  })

  it("right click and long press open the community menu", () => {
    vi.useFakeTimers()
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta.includes("pointer: coarse"),
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const onMenu = vi.fn()
    render(carril({ onMenu }))
    fireEvent.contextMenu(screen.getByRole("button", { name: "Leitores" }), { clientX: 30, clientY: 90 })
    expect(onMenu).toHaveBeenLastCalledWith(LEITORES, { x: 30, y: 90 })
    ponteiro(screen.getByRole("button", { name: "Xadrez" }), "pointerdown", { clientX: 36, clientY: 160 })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onMenu).toHaveBeenLastCalledWith(XADREZ, { x: 36, y: 160 })
  })
})
