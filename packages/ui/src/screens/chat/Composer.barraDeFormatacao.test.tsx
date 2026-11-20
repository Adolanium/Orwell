import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { Composer } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"

/**
 * The formatting bar over a selection in the text box (20/11/2026), as in
 * Discord. The markers and the undo are proved in `useAtalhosDeFormatacao.test`;
 * here, when the bar shows, what its buttons do, the keyboard, and the phone.
 */

const bridge = { social: { linkPreview: vi.fn().mockRejectedValue(new Error("não")) } } as unknown as EnclaveBridge
const matchMediaOriginal = window.matchMedia

afterEach(() => {
  cleanup()
  window.matchMedia = matchMediaOriginal
})

/** A finger, not a mouse: `(hover: none) and (pointer: coarse)` matches. */
function comDedo(): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("pointer: coarse"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

function Harness({ initial = "", onCancelarResposta }: { initial?: string; onCancelarResposta?: () => void }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <StrictMode>
      <BridgeContext.Provider value={bridge}>
        <Composer
          connection="online"
          value={value}
          onChange={setValue}
          onSend={vi.fn()}
          {...(onCancelarResposta
            ? {
                resposta: { id: "m1", autor: "@carla:exemplo.pt", nome: "Carla", mencionar: false },
                onCancelarResposta,
              }
            : {})}
        />
      </BridgeContext.Provider>
    </StrictMode>
  )
}

function caixa(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Escreve uma mensagem") as HTMLTextAreaElement
}

/** Select letters, as the mouse or Shift+arrows do: the box tells with `select`. */
function marcar(inicio: number, fim: number): void {
  const campo = caixa()
  act(() => {
    campo.focus()
    campo.setSelectionRange(inicio, fim)
    fireEvent.select(campo)
  })
}

const barra = (): HTMLElement | null => screen.queryByRole("toolbar", { name: "Formatação do texto" })

describe("Composer — a barra de formatação", () => {
  it("aparece com texto marcado, com os cinco botões e os nomes", () => {
    render(<Harness initial="isto é urgente" />)
    expect(barra()).toBeNull()
    marcar(7, 14)
    const aBarra = barra()
    expect(aBarra).not.toBeNull()
    const nomes = [...aBarra!.querySelectorAll("button")].map((botao) => botao.getAttribute("aria-label"))
    expect(nomes).toEqual(["Negrito", "Itálico", "Rasurado", "Código", "Texto escondido"])
  })

  it("cada botão diz a tecla na dica", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    // jsdom is not a Mac: the key is written "Ctrl+…".
    expect(screen.getByRole("button", { name: "Negrito" }).title).toBe("Negrito (Ctrl+B)")
    expect(screen.getByRole("button", { name: "Código" }).title).toBe("Código (Ctrl+E)")
    expect(screen.getByRole("button", { name: "Texto escondido" }).title).toBe("Texto escondido (Ctrl+Shift+H)")
  })

  it("não aparece sem texto marcado, e some quando a selecção acaba", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(3, 3)
    expect(barra()).toBeNull()
    marcar(7, 14)
    expect(barra()).not.toBeNull()
    marcar(14, 14)
    expect(barra()).toBeNull()
  })

  it("some quando a caixa perde o foco para fora da barra", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    act(() => {
      fireEvent.blur(caixa(), { relatedTarget: document.body })
    })
    expect(barra()).toBeNull()
  })

  it("um clique envolve o texto marcado e a selecção fica nas mesmas letras", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    fireEvent.mouseDown(screen.getByRole("button", { name: "Negrito" }))
    fireEvent.click(screen.getByRole("button", { name: "Negrito" }))
    const campo = caixa()
    expect(campo.value).toBe("isto é **urgente**")
    expect(campo.value.slice(campo.selectionStart!, campo.selectionEnd!)).toBe("urgente")
    expect(document.activeElement).toBe(campo)
  })

  it("os cinco botões escrevem os cinco marcadores", () => {
    const casos: [string, string][] = [
      ["Negrito", "**urgente**"],
      ["Itálico", "*urgente*"],
      ["Rasurado", "~~urgente~~"],
      ["Código", "`urgente`"],
      ["Texto escondido", "||urgente||"],
    ]
    for (const [nome, esperado] of casos) {
      cleanup()
      render(<Harness initial="urgente" />)
      marcar(0, 7)
      fireEvent.click(screen.getByRole("button", { name: nome }))
      expect(caixa().value, nome).toBe(esperado)
    }
  })

  it("o botão fica premido quando a selecção já tem o marcador, e outro clique tira-o", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    expect(screen.getByRole("button", { name: "Negrito" }).getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "Negrito" }))
    expect(screen.getByRole("button", { name: "Negrito" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Itálico" }).getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "Negrito" }))
    expect(caixa().value).toBe("isto é urgente")
  })

  it("o rato não tira o foco à caixa: o mousedown na barra é cancelado", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    const evento = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    screen.getByRole("button", { name: "Itálico" }).dispatchEvent(evento)
    expect(evento.defaultPrevented).toBe(true)
  })

  it("teclado: só um botão é paragem de Tab, e as setas, Home e End andam entre eles", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    const botoes = [...barra()!.querySelectorAll("button")]
    expect(botoes.map((botao) => botao.tabIndex)).toEqual([0, -1, -1, -1, -1])
    // Tab from the box: the focus goes to the bar, and the bar stays.
    act(() => {
      botoes[0]!.focus()
    })
    expect(barra()).not.toBeNull()
    fireEvent.keyDown(botoes[0]!, { key: "ArrowRight" })
    expect(document.activeElement).toBe(botoes[1])
    fireEvent.keyDown(botoes[1]!, { key: "ArrowLeft" })
    fireEvent.keyDown(botoes[0]!, { key: "ArrowLeft" })
    expect(document.activeElement).toBe(botoes[4])
    fireEvent.keyDown(botoes[4]!, { key: "Home" })
    expect(document.activeElement).toBe(botoes[0])
    fireEvent.keyDown(botoes[0]!, { key: "End" })
    expect(document.activeElement).toBe(botoes[4])
  })

  it("teclado: carregar num botão envolve e devolve o foco à caixa, sobre as mesmas letras", () => {
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    const rasurado = screen.getByRole("button", { name: "Rasurado" })
    act(() => {
      rasurado.focus()
    })
    // Enter or Space on a button is a click.
    fireEvent.click(rasurado)
    const campo = caixa()
    expect(campo.value).toBe("isto é ~~urgente~~")
    expect(document.activeElement).toBe(campo)
    expect(campo.value.slice(campo.selectionStart!, campo.selectionEnd!)).toBe("urgente")
  })

  it("Esc na barra volta à caixa sem mudar nada, e não cancela a resposta", () => {
    const cancelar = vi.fn()
    render(<Harness initial="isto é urgente" onCancelarResposta={cancelar} />)
    marcar(7, 14)
    const negrito = screen.getByRole("button", { name: "Negrito" })
    act(() => {
      negrito.focus()
    })
    fireEvent.keyDown(negrito, { key: "Escape" })
    const campo = caixa()
    expect(document.activeElement).toBe(campo)
    expect(campo.value).toBe("isto é urgente")
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([7, 14])
    expect(cancelar).not.toHaveBeenCalled()
  })

  it("no telemóvel não há barra: o sistema já tem o seu menu", () => {
    comDedo()
    render(<Harness initial="isto é urgente" />)
    marcar(7, 14)
    expect(barra()).toBeNull()
  })
})
