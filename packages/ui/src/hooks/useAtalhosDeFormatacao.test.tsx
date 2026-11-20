import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { trocaMinima, useAtalhosDeFormatacao } from "./useAtalhosDeFormatacao.js"

afterEach(() => {
  cleanup()
  // jsdom has no `execCommand`; the tests below that need one put it there.
  delete (document as { execCommand?: unknown }).execCommand
})

/**
 * A controlled text input, like the real ones.
 *
 * Controlled on purpose: that is where all the difficulty sits. The text lives
 * above, React redraws the box with the new value, and the selection the person
 * had vanishes in that redraw. An uncontrolled box would pass this test without
 * proving anything.
 */
function Caixa({ inicial = "", area = false }: { inicial?: string; area?: boolean }): React.JSX.Element {
  const [valor, setValor] = useState(inicial)
  const aoTeclar = useAtalhosDeFormatacao(valor, setValor)
  const comuns = {
    value: valor,
    onChange: (event: { target: { value: string } }) => setValor(event.target.value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      aoTeclar(event)
    },
    "aria-label": "escrita",
  }
  return area ? <textarea {...comuns} /> : <input {...comuns} />
}

/** Mark letters in the box, like dragging the mouse over them. */
function marcar(campo: HTMLInputElement | HTMLTextAreaElement, inicio: number, fim: number): void {
  campo.focus()
  campo.setSelectionRange(inicio, fim)
}

describe("useAtalhosDeFormatacao", () => {
  it("Cmd+B envolve o que está marcado", () => {
    render(<Caixa inicial="isto é urgente" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value).toBe("isto é **urgente**")
  })

  it("e a selecção continua sobre as mesmas letras, para o gesto seguinte", () => {
    // What makes a second Cmd+B undo the first without touching the mouse. Without
    // this, the controlled box would put the cursor at the end on every shortcut.
    render(<Caixa inicial="isto é urgente" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value.slice(campo.selectionStart!, campo.selectionEnd!)).toBe("urgente")
  })

  it("carregar duas vezes desfaz, e o texto volta ao que era", () => {
    render(<Caixa inicial="isto é urgente" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value).toBe("isto é urgente")
  })

  it("os cinco atalhos escrevem os cinco marcadores", () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ key: "b", ctrlKey: true }, "**palavra**"],
      [{ key: "i", ctrlKey: true }, "*palavra*"],
      [{ key: "X", ctrlKey: true, shiftKey: true }, "~~palavra~~"],
      [{ key: "e", ctrlKey: true }, "`palavra`"],
      [{ key: "H", ctrlKey: true, shiftKey: true }, "||palavra||"],
    ]
    for (const [tecla, esperado] of casos) {
      cleanup()
      render(<Caixa inicial="palavra" />)
      const campo = screen.getByLabelText("escrita") as HTMLInputElement
      marcar(campo, 0, 7)
      fireEvent.keyDown(campo, tecla)
      expect(campo.value, JSON.stringify(tecla)).toBe(esperado)
    }
  })

  it("sem nada marcado, abre o par e põe o cursor lá dentro", () => {
    render(<Caixa inicial="olá " />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 4, 4)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value).toBe("olá ****")
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([6, 6])
  })

  it("funciona igual numa caixa de várias linhas, que é a das publicações", () => {
    render(<Caixa inicial="o fim" area />)
    const campo = screen.getByLabelText("escrita") as HTMLTextAreaElement
    marcar(campo, 2, 5)
    fireEvent.keyDown(campo, { key: "H", metaKey: true, shiftKey: true })
    expect(campo.value).toBe("o ||fim||")
  })

  it("uma tecla que não é atalho não é reclamada, e escreve-se na mesma", () => {
    // The guarantee that makes this bearable inside a box: without a modifier, the
    // keyboard belongs to whoever is typing. The hook says it did not handle it,
    // and the caller is free to handle it (that is how Enter still sends).
    render(<Caixa inicial="abc" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 0, 3)
    fireEvent.keyDown(campo, { key: "b" })
    expect(campo.value).toBe("abc")
    fireEvent.keyDown(campo, { key: "Enter" })
    expect(campo.value).toBe("abc")
  })

  it("diz a quem chama se tratou da tecla ou não", () => {
    const tratados: boolean[] = []
    function Espia(): React.JSX.Element {
      const [valor, setValor] = useState("abc")
      const aoTeclar = useAtalhosDeFormatacao(valor, setValor)
      return (
        <input
          aria-label="espia"
          value={valor}
          onChange={(event) => setValor(event.target.value)}
          onKeyDown={(event) => tratados.push(aoTeclar(event))}
        />
      )
    }
    render(<Espia />)
    const campo = screen.getByLabelText("espia") as HTMLInputElement
    marcar(campo, 0, 3)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    fireEvent.keyDown(campo, { key: "Enter" })
    expect(tratados).toEqual([true, false])
  })
})

/**
 * A stand-in for the browser's `execCommand`, enough to prove the path: it
 * writes into the focused field over its selection and fires `input`, which is
 * what Chrome, Firefox and Safari do. The real undo history is proved in a real
 * browser (`scripts/verificar-formatacao-desfazer.mjs`).
 */
function comandoDeEdicao(): ReturnType<typeof vi.fn> {
  const comando = vi.fn((nome: string, _ui?: boolean, texto?: string): boolean => {
    const campo = document.activeElement as HTMLTextAreaElement | HTMLInputElement
    const inicio = campo.selectionStart ?? 0
    const fim = campo.selectionEnd ?? inicio
    campo.setRangeText(nome === "delete" ? "" : (texto ?? ""), inicio, fim, "end")
    campo.dispatchEvent(new Event("input", { bubbles: true }))
    return true
  })
  ;(document as { execCommand?: unknown }).execCommand = comando
  return comando
}

describe("useAtalhosDeFormatacao — o Ctrl+Z continua a desfazer", () => {
  it("o atalho escreve pelo comando de edição do browser, que guarda o desfazer", () => {
    const comando = comandoDeEdicao()
    const seleccoes: [number | null, number | null][] = []
    comando.mockImplementationOnce((nome: string, _ui?: boolean, texto?: string): boolean => {
      const campo = document.activeElement as HTMLTextAreaElement
      seleccoes.push([campo.selectionStart, campo.selectionEnd])
      campo.setRangeText(nome === "delete" ? "" : (texto ?? ""), campo.selectionStart, campo.selectionEnd, "end")
      campo.dispatchEvent(new Event("input", { bubbles: true }))
      return true
    })
    render(<Caixa inicial="isto é urgente" area />)
    const campo = screen.getByLabelText("escrita") as HTMLTextAreaElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", ctrlKey: true })
    // Only the changed part is replaced, so one Ctrl+Z puts back exactly this.
    expect(comando).toHaveBeenCalledWith("insertText", false, "**urgente**")
    expect(seleccoes).toEqual([[7, 14]])
    expect(campo.value).toBe("isto é **urgente**")
    expect(campo.value.slice(campo.selectionStart!, campo.selectionEnd!)).toBe("urgente")
  })

  it("tirar os marcadores passa pelo mesmo caminho, e o texto volta ao que era", () => {
    const comando = comandoDeEdicao()
    render(<Caixa inicial="isto é urgente" area />)
    const campo = screen.getByLabelText("escrita") as HTMLTextAreaElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", ctrlKey: true })
    fireEvent.keyDown(campo, { key: "b", ctrlKey: true })
    expect(comando).toHaveBeenCalledTimes(2)
    expect(campo.value).toBe("isto é urgente")
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([7, 14])
  })

  it("sem selecção, abre o par pelo comando e deixa o cursor no meio", () => {
    const comando = comandoDeEdicao()
    render(<Caixa inicial="olá " area />)
    const campo = screen.getByLabelText("escrita") as HTMLTextAreaElement
    marcar(campo, 4, 4)
    fireEvent.keyDown(campo, { key: "e", metaKey: true })
    expect(comando).toHaveBeenCalledWith("insertText", false, "``")
    expect(campo.value).toBe("olá ``")
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([5, 5])
  })

  it("se o browser recusar o comando, o texto muda na mesma", () => {
    ;(document as { execCommand?: unknown }).execCommand = vi.fn(() => false)
    render(<Caixa inicial="isto é urgente" area />)
    const campo = screen.getByLabelText("escrita") as HTMLTextAreaElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", ctrlKey: true })
    expect(campo.value).toBe("isto é **urgente**")
    expect(campo.value.slice(campo.selectionStart!, campo.selectionEnd!)).toBe("urgente")
  })
})

describe("trocaMinima", () => {
  it("só o meio muda: o princípio e o fim comuns ficam", () => {
    expect(trocaMinima("isto é urgente", "isto é **urgente**")).toEqual({ inicio: 7, fim: 14, texto: "**urgente**" })
    expect(trocaMinima("a **b** c", "a b c")).toEqual({ inicio: 2, fim: 7, texto: "b" })
    expect(trocaMinima("olá ", "olá ****")).toEqual({ inicio: 4, fim: 4, texto: "****" })
  })

  it("uma troca que só apaga devolve texto vazio", () => {
    expect(trocaMinima("****", "")).toEqual({ inicio: 0, fim: 4, texto: "" })
  })
})
