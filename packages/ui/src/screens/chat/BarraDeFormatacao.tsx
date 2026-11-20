import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { CodigoIcon, ItalicoIcon, NegritoIcon, OlhoFechadoIcon, RasuradoIcon } from "../../icons.js"
import { ATALHOS_DE_FORMATACAO, estaEnvolvido, type Marcador } from "../../lib/atalhosDeFormatacao.js"
import { formatarCombinacao, plataformaDoTeclado } from "../../lib/atalhosDeVoz.js"
import { rectanguloDaSeleccao } from "../../lib/rectanguloDaSeleccao.js"
import { strings } from "../../strings.js"

/**
 * The small bar over a selection in the text box (20/11/2026), as in Discord:
 * bold, italic, strikethrough, code and hidden text.
 *
 * **It writes the same markers as the keys**, through the same `aplicar` (see
 * `useFormatacao`), so a button and its key can never do two different things,
 * and Ctrl+Z undoes a button press as it undoes a key press.
 *
 * **When it shows:** the box (or the bar itself) has the focus, some text is
 * selected, and the mouse button is up. While the mouse drags, the bar waits,
 * so it does not jump along the selection. It goes when the selection
 * collapses, when the focus leaves both the box and the bar, or with Escape.
 *
 * **On the phone it does not exist.** The caller does not draw it with a finger
 * and no mouse (`comDedo` in `Composer`): the system draws its own menu over a
 * selection, and a second bar would cover it.
 *
 * **Keyboard.** The bar comes right after the box in the page, so Tab from the
 * box with text selected goes to the bar. Inside it, the arrow keys, Home and
 * End move between the buttons, and only one button is a Tab stop (the WAI-ARIA
 * toolbar pattern): Tab again leaves the bar. Enter or Space presses the button
 * and puts the focus back in the box, over the same letters, ready for the next
 * key. Escape goes back to the box without changing anything.
 *
 * **The mouse keeps the selection.** `mousedown` on the bar is cancelled, so a
 * click does not take the focus from the box and the selection stays drawn.
 */

interface Botao {
  marcador: Marcador
  nome: "negrito" | "italico" | "rasurado" | "codigo" | "coberto"
  Icone: (props: { size?: number }) => React.JSX.Element
}

const BOTOES: readonly Botao[] = [
  { marcador: "**", nome: "negrito", Icone: NegritoIcon },
  { marcador: "*", nome: "italico", Icone: ItalicoIcon },
  { marcador: "~~", nome: "rasurado", Icone: RasuradoIcon },
  { marcador: "`", nome: "codigo", Icone: CodigoIcon },
  { marcador: "||", nome: "coberto", Icone: OlhoFechadoIcon },
]

/** Space between the bar and the selected line, and between the bar and the window edge. */
const FOLGA = 8

export interface BarraDeFormatacaoProps {
  campo: React.RefObject<HTMLTextAreaElement | null>
  /** The text of the box. A new value moves the bar and updates the pressed buttons. */
  valor: string
  aplicar: (campo: HTMLTextAreaElement, marcador: Marcador) => void
}

export function BarraDeFormatacao({ campo, valor, aplicar }: BarraDeFormatacaoProps): React.JSX.Element | null {
  const barra = useRef<HTMLDivElement>(null)
  const [seleccao, setSeleccao] = useState<{ inicio: number; fim: number } | null>(null)
  const [activo, setActivo] = useState(0)
  const aArrastar = useRef(false)

  /**
   * Read the box again and decide. `focoNovo` is where the focus goes, when a
   * `focusout` says it: during that event `document.activeElement` is still the
   * page, and without it a Tab into the bar would close the bar on its way in.
   */
  const reavaliar = useCallback(
    (focoNovo?: Element | null) => {
      const caixa = campo.current
      const foco = focoNovo === undefined ? document.activeElement : focoNovo
      const comFoco = caixa !== null && (foco === caixa || (foco !== null && barra.current?.contains(foco) === true))
      const inicio = caixa?.selectionStart ?? 0
      const fim = caixa?.selectionEnd ?? 0
      if (!caixa || caixa.disabled || !comFoco || inicio === fim || aArrastar.current) {
        setSeleccao(null)
        return
      }
      setSeleccao((antes) =>
        antes && antes.inicio === Math.min(inicio, fim) && antes.fim === Math.max(inicio, fim)
          ? antes
          : { inicio: Math.min(inicio, fim), fim: Math.max(inicio, fim) },
      )
    },
    [campo],
  )

  useEffect(() => {
    const caixa = campo.current
    if (!caixa) return
    const agora = (): void => reavaliar()
    const aoSair = (event: FocusEvent): void => reavaliar(event.relatedTarget as Element | null)
    const aoCarregar = (): void => {
      aArrastar.current = true
      setSeleccao(null)
    }
    const aoLargar = (): void => {
      if (!aArrastar.current) return
      aArrastar.current = false
      reavaliar()
    }
    caixa.addEventListener("select", agora)
    caixa.addEventListener("keyup", agora)
    caixa.addEventListener("focus", agora)
    caixa.addEventListener("scroll", agora)
    caixa.addEventListener("focusout", aoSair)
    caixa.addEventListener("mousedown", aoCarregar)
    document.addEventListener("mouseup", aoLargar)
    document.addEventListener("selectionchange", agora)
    window.addEventListener("resize", agora)
    return () => {
      caixa.removeEventListener("select", agora)
      caixa.removeEventListener("keyup", agora)
      caixa.removeEventListener("focus", agora)
      caixa.removeEventListener("scroll", agora)
      caixa.removeEventListener("focusout", aoSair)
      caixa.removeEventListener("mousedown", aoCarregar)
      document.removeEventListener("mouseup", aoLargar)
      document.removeEventListener("selectionchange", agora)
      window.removeEventListener("resize", agora)
    }
  }, [campo, reavaliar])

  // A new value (a key, a button, the emoji picker) can move or end the selection.
  useEffect(() => {
    reavaliar()
  }, [valor, reavaliar])

  // Placed before paint, over the first selected line, centred on it. No room
  // above: under the last line. Never out of the window.
  useLayoutEffect(() => {
    const caixa = campo.current
    const no = barra.current
    if (!seleccao || !caixa || !no) return
    const fora = caixa.getBoundingClientRect()
    const linha = rectanguloDaSeleccao(caixa) ?? { topo: fora.top, fundo: fora.top, centro: fora.left + fora.width / 2 }
    // A line scrolled out of the box points at the edge of the box.
    const topo = Math.min(Math.max(linha.topo, fora.top), fora.bottom)
    const fundo = Math.min(Math.max(linha.fundo, fora.top), fora.bottom)
    const largura = no.offsetWidth
    const altura = no.offsetHeight
    let y = topo - altura - FOLGA
    if (y < FOLGA) y = fundo + FOLGA
    const x = Math.min(Math.max(linha.centro - largura / 2, FOLGA), Math.max(FOLGA, window.innerWidth - largura - FOLGA))
    no.style.left = `${Math.round(x)}px`
    no.style.top = `${Math.round(y)}px`
  }, [seleccao, valor, campo])

  if (!seleccao) return null

  const plataforma = plataformaDoTeclado()
  const texto = campo.current?.value ?? valor

  const focar = (indice: number): void => {
    const total = BOTOES.length
    const seguinte = ((indice % total) + total) % total
    setActivo(seguinte)
    barra.current?.querySelectorAll<HTMLButtonElement>("button")[seguinte]?.focus()
  }

  const voltarACaixa = (): void => {
    const caixa = campo.current
    if (!caixa) return
    const { inicio, fim } = seleccao
    caixa.focus()
    caixa.setSelectionRange(inicio, fim)
  }

  return (
    <div
      ref={barra}
      className="barra-de-formatacao"
      role="toolbar"
      aria-label={strings.formatacao.barra}
      onMouseDown={(event) => event.preventDefault()}
      onBlur={(event) => reavaliar(event.relatedTarget as Element | null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
          event.preventDefault()
          if (event.key === "Home") focar(0)
          else if (event.key === "End") focar(BOTOES.length - 1)
          else focar(activo + (event.key === "ArrowRight" ? 1 : -1))
          return
        }
        if (event.key === "Escape") {
          // Esc here belongs to the bar: it must not also cancel the reply.
          event.preventDefault()
          event.stopPropagation()
          voltarACaixa()
        }
      }}
    >
      {BOTOES.map(({ marcador, nome, Icone }, indice) => {
        const rotulo = strings.formatacao[nome]
        return (
          <button
            key={marcador}
            type="button"
            tabIndex={indice === activo ? 0 : -1}
            aria-label={rotulo}
            aria-pressed={estaEnvolvido(texto, seleccao.inicio, seleccao.fim, marcador)}
            title={strings.formatacao.dica(rotulo, formatarCombinacao(ATALHOS_DE_FORMATACAO[marcador], plataforma))}
            onFocus={() => setActivo(indice)}
            onClick={() => {
              const caixa = campo.current
              if (!caixa) return
              // The selection the bar shows, also after a Tab took the focus away.
              if (document.activeElement !== caixa) voltarACaixa()
              aplicar(caixa, marcador)
            }}
          >
            <Icone size={16} />
          </button>
        )
      })}
    </div>
  )
}
