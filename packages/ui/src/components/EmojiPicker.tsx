import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Modal } from "./Modal.js"
import { EMOJI_CATEGORY_TABS } from "./emoji-categorias.js"
import type { Emoji } from "./emoji.js"
import { useEmojiRecents } from "../lib/emojiFrequentes.js"
import { readPrefs, writePrefs } from "../hooks/usePrefs.js"
import { strings } from "../strings.js"

/**
 * Number of grid columns.
 *
 * Fixed, not `auto-fill`, because arrow keys need to know how many cells fit
 * in a row to move down, and the virtual list needs to know how many rows a
 * section has before anything is drawn. Must match the `repeat(8, 1fr)` in
 * `.emoji-linha`.
 */
const COLUMNS = 8

/** Heights the virtual list counts with. Must match `.emoji-linha` and `.emoji-cabecalho`. */
const ALTURA_DA_LINHA = 40
const ALTURA_DO_CABECALHO = 28

/** Rows drawn above and below the visible part, so a fast scroll does not show holes. */
const MARGEM_PX = 160

/**
 * The visible height before the list is measured (and in jsdom, where nothing
 * has a size). About the real height of the card's list on a desktop.
 */
const ALTURA_INICIAL = 320

type Catalog = typeof import("./emoji.js")

let loaded: Catalog | undefined
let loading: Promise<Catalog> | undefined

/**
 * Loads the emoji catalog once. It is a separate chunk (~38 KB gzip) so that
 * app start does not pay for it; the first opening of the picker does.
 */
export function loadEmojiCatalog(): Promise<Catalog> {
  loading ??= import("./emoji.js").then((module) => (loaded = module))
  return loading
}

/** The id of the "Frequently used" section. It only exists when there is something in it. */
const RECENTS_ID = "recentes"
const RESULTS_ID = "resultados"

interface Seccao {
  id: string
  rotulo: string
  emojis: Emoji[]
}

/** One drawn row of the virtual list: a section header, or up to `COLUMNS` emojis. */
type Linha =
  | { tipo: "cabecalho"; seccao: number; topo: number }
  | { tipo: "emojis"; seccao: number; topo: number; inicio: number; fim: number }

interface Disposicao {
  linhas: Linha[]
  /** Flat emoji index -> its row in `linhas`. */
  linhaDe: Int32Array
  /** Section -> its header's row. */
  cabecalhoDe: number[]
  todos: Emoji[]
  altura: number
}

/** Lay out the sections: one header, then rows of eight. Pure arithmetic, no DOM. */
function dispor(seccoes: readonly Seccao[], comCabecalhos: boolean): Disposicao {
  const linhas: Linha[] = []
  const todos: Emoji[] = []
  const cabecalhoDe: number[] = []
  let topo = 0
  seccoes.forEach((seccao, indice) => {
    cabecalhoDe.push(linhas.length)
    if (comCabecalhos) {
      linhas.push({ tipo: "cabecalho", seccao: indice, topo })
      topo += ALTURA_DO_CABECALHO
    }
    for (let i = 0; i < seccao.emojis.length; i += COLUMNS) {
      const inicio = todos.length + i
      linhas.push({ tipo: "emojis", seccao: indice, topo, inicio, fim: Math.min(inicio + COLUMNS, todos.length + seccao.emojis.length) })
      topo += ALTURA_DA_LINHA
    }
    todos.push(...seccao.emojis)
  })
  const linhaDe = new Int32Array(todos.length)
  linhas.forEach((linha, indice) => {
    if (linha.tipo === "emojis") for (let i = linha.inicio; i < linha.fim; i++) linhaDe[i] = indice
  })
  return { linhas, linhaDe, cabecalhoDe, todos, altura: topo }
}

/** The first row whose bottom is below `y`. Binary search: the list has ~250 rows. */
function primeiraLinha(linhas: readonly Linha[], y: number): number {
  let baixo = 0
  let alto = linhas.length - 1
  while (baixo < alto) {
    const meio = (baixo + alto) >> 1
    const linha = linhas[meio] as Linha
    const fundo = linha.topo + (linha.tipo === "cabecalho" ? ALTURA_DO_CABECALHO : ALTURA_DA_LINHA)
    if (fundo <= y) baixo = meio + 1
    else alto = meio
  }
  return baixo
}

/** The five skin tones and the default, as the tone selector shows them. */
const MAO = "✋"

/**
 * The emoji picker, like Discord's: one long list with every Unicode category,
 * "Frequently used" first, search by name in Portuguese and English, skin tone,
 * and the keyboard.
 *
 * **Virtual.** The catalog has 1,870 emojis. Only the rows in view (and a
 * margin) are in the DOM, about a hundred buttons: the picker opens in one frame
 * even on a slow machine, and scrolling the whole catalog never builds it all.
 *
 * Lives inside the `Modal` on purpose: Escape, focus on open, Tab trapped
 * inside, and focus returned to the opener are already solved and tested in
 * that file. What belongs here is the arrow keys, because a grid is not
 * traversed like a list, and Tab would have to pass through hundreds of buttons
 * to exit.
 *
 * So the grid uses roving tabindex: only one button is reachable by Tab, the
 * others respond to arrows. The row of that button is always drawn, even when
 * scrolled away, so Tab never lands on nothing. The "Close" button in the
 * footer is the last focusable element in the card, and closes the Tab cycle.
 */
export function EmojiPicker({
  onPick,
  onClose,
  titulo,
  contar = true,
}: {
  onPick: (char: string) => void
  onClose: () => void
  /** The card's title. "Emoji" by default; "React" for a reaction. */
  titulo?: string
  /** Count the pick in "Frequently used". Off where picking is not using (Settings). */
  contar?: boolean
}): React.JSX.Element {
  const { recents, remember } = useEmojiRecents()
  const [catalog, setCatalog] = useState<Catalog | undefined>(loaded)
  const [query, setQuery] = useState("")
  const [tom, setTom] = useState(() => readPrefs().tomDePele)
  const [escolherTom, setEscolherTom] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [hint, setHint] = useState<Emoji | null>(null)
  const [topo, setTopo] = useState(0)
  const [altura, setAltura] = useState(ALTURA_INICIAL)
  const lista = useRef<HTMLDivElement>(null)
  /** The cursor moved by keyboard: focus follows it after the next draw. */
  const focarDepois = useRef(false)
  /** Forces that draw when the cursor does not change (the down arrow from the search box to cell 0). */
  const [, setPedidosDeFoco] = useState(0)

  useEffect(() => {
    if (catalog) return
    let alive = true
    void loadEmojiCatalog().then((module) => {
      if (alive) setCatalog(module)
    })
    return () => {
      alive = false
    }
  }, [catalog])

  // The real height of the list, once it is on screen, and again if the card changes size.
  useLayoutEffect(() => {
    const el = lista.current
    if (!el) return
    const medir = (): void => {
      if (el.clientHeight > 0) setAltura(el.clientHeight)
    }
    medir()
    if (typeof ResizeObserver === "undefined") return
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  const searching = query.trim().length > 0

  const seccoes = useMemo((): Seccao[] => {
    const comTom = (emoji: Emoji): Emoji => {
      const char = catalog ? catalog.withTone(emoji.char, tom) : emoji.char
      return char === emoji.char ? emoji : { ...emoji, char }
    }
    if (searching) return [{ id: RESULTS_ID, rotulo: strings.emoji.results, emojis: (catalog?.searchEmoji(query) ?? []).map(comTom) }]
    // A frequent emoji no longer known to the catalog still appears, by its glyph:
    // better than making it vanish from someone's list because of an edit here.
    const frequentes: Emoji[] = recents.map((char) => {
      const conhecido = catalog?.findEmoji(char)
      return conhecido ? { ...conhecido, char } : { char, name: char, haystack: "" }
    })
    const categorias: Seccao[] = (catalog?.CATEGORIES ?? []).map((categoria) => ({
      id: categoria.id,
      rotulo: strings.emoji.categorias[categoria.id],
      emojis: categoria.emojis.map(comTom),
    }))
    return frequentes.length > 0 ? [{ id: RECENTS_ID, rotulo: strings.emoji.recents, emojis: frequentes }, ...categorias] : categorias
  }, [catalog, query, searching, recents, tom])

  const disposicao = useMemo(() => dispor(seccoes, !searching), [seccoes, searching])
  const { linhas, linhaDe, cabecalhoDe, todos } = disposicao

  /** Scroll the list to `y`, in the DOM and in the state the drawing reads. */
  const rolarPara = (y: number, total = disposicao.altura): void => {
    const alvo = Math.max(0, Math.min(y, Math.max(0, total - altura)))
    setTopo(alvo)
    if (lista.current) lista.current.scrollTop = alvo
  }

  /** The first emoji of a section, and the top of its header. */
  const inicioDaSeccao = (seccao: number, d: Disposicao = disposicao): { indice: number; y: number } => {
    const cabecalho = d.cabecalhoDe[seccao] ?? 0
    const primeira = d.linhas[cabecalho + (searching ? 0 : 1)]
    return {
      indice: primeira?.tipo === "emojis" ? primeira.inicio : 0,
      y: d.linhas[cabecalho]?.topo ?? 0,
    }
  }

  /** A new search: cursor and scroll back at the start, or Tab would enter at a button that is gone. */
  const procurar = (texto: string): void => {
    setQuery(texto)
    setCursor(0)
    rolarPara(0)
  }

  /**
   * A tab pressed during a search: the search clears first, and the jump to the
   * section waits for the full list to be laid out.
   */
  const abaPendente = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = abaPendente.current
    if (id === null || searching) return
    abaPendente.current = null
    const seccao = seccoes.findIndex((entrada) => entrada.id === id)
    if (seccao < 0) return
    const { indice, y } = inicioDaSeccao(seccao)
    rolarPara(y)
    setCursor(indice)
  })

  /** The section in view: the one whose header is at or above the top of the list. */
  const seccaoVisivel = useMemo(() => {
    if (searching || linhas.length === 0) return -1
    const linha = linhas[primeiraLinha(linhas, topo + 1)]
    return linha?.seccao ?? 0
  }, [linhas, topo, searching])

  const seccaoDoCursor = linhas[linhaDe[cursor] ?? 0]?.seccao ?? 0
  const groupLabel = searching ? strings.emoji.results : (seccoes[seccaoDoCursor]?.rotulo ?? titulo ?? strings.emoji.title)

  const focusAt = (index: number): void => {
    if (todos.length === 0) return
    const alvo = Math.max(0, Math.min(index, todos.length - 1))
    const linha = linhas[linhaDe[alvo] ?? 0]
    if (linha) {
      // The least scroll that shows the row, like `scrollIntoView({ block: "nearest" })`.
      // The first row of a section brings its header along: the name says where you are.
      const primeiraDaSeccao = !searching && linhaDe[alvo] === (cabecalhoDe[linha.seccao] ?? -2) + 1
      const cima = primeiraDaSeccao ? linha.topo - ALTURA_DO_CABECALHO : linha.topo
      if (cima < topo) rolarPara(cima)
      else if (linha.topo + ALTURA_DA_LINHA > topo + altura) rolarPara(linha.topo + ALTURA_DA_LINHA - altura)
    }
    focarDepois.current = true
    setCursor(alvo)
    setPedidosDeFoco((n) => n + 1)
  }

  useLayoutEffect(() => {
    if (!focarDepois.current) return
    focarDepois.current = false
    lista.current?.querySelector<HTMLButtonElement>(`button[data-i="${cursor}"]`)?.focus({ preventScroll: true })
  })

  /** One row up or down, in the same column, across section borders. */
  const mudarDeLinha = (delta: 1 | -1): number => {
    const aqui = linhaDe[cursor] ?? 0
    const linha = linhas[aqui]
    if (!linha || linha.tipo !== "emojis") return cursor
    const coluna = cursor - linha.inicio
    for (let i = aqui + delta; i >= 0 && i < linhas.length; i += delta) {
      const outra = linhas[i] as Linha
      if (outra.tipo === "emojis") return Math.min(outra.inicio + coluna, outra.fim - 1)
    }
    return cursor
  }

  const choose = (char: string): void => {
    if (contar) remember(char)
    onPick(char)
    onClose()
  }

  const mudarTom = (novo: number): void => {
    setTom(novo)
    setEscolherTom(false)
    writePrefs({ ...readPrefs(), tomDePele: novo })
  }

  // Only the rows in view, plus the cursor's row, always: it holds the one Tab stop.
  const desenhadas = useMemo(() => {
    if (linhas.length === 0) return []
    const inicio = primeiraLinha(linhas, Math.max(0, topo - MARGEM_PX))
    const fim = topo + altura + MARGEM_PX
    const visiveis: number[] = []
    for (let i = inicio; i < linhas.length && (linhas[i] as Linha).topo < fim; i++) visiveis.push(i)
    const doCursor = linhaDe[cursor]
    if (doCursor !== undefined && todos.length > 0 && !visiveis.includes(doCursor)) visiveis.push(doCursor)
    return visiveis
  }, [linhas, linhaDe, topo, altura, cursor, todos.length])

  const exemploDoTom = catalog ? catalog.withTone(MAO, tom) : MAO

  return (
    <Modal className="emoji-panel" labelledBy="emoji-title" onClose={onClose}>
      <h2 id="emoji-title" className="emoji-title">
        {titulo ?? strings.emoji.title}
      </h2>

      <div className="emoji-procura">
        <input
          className="emoji-search"
          value={query}
          aria-label={strings.emoji.searchLabel}
          placeholder={strings.emoji.searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => procurar(event.target.value)}
          onKeyDown={(event) => {
            // Type and press Enter is the shortest path for someone who already knows the
            // emoji name; the down arrow hands the grid to the keyboard.
            if (event.key === "Enter") {
              event.preventDefault()
              const first = todos[0]
              if (first) choose(first.char)
            }
            if (event.key === "ArrowDown") {
              event.preventDefault()
              focusAt(0)
            }
          }}
        />
        <button
          type="button"
          className="emoji-tom"
          aria-label={strings.emoji.tom(strings.emoji.tons[tom] ?? "")}
          aria-expanded={escolherTom}
          data-tip={strings.emoji.tom(strings.emoji.tons[tom] ?? "")}
          onClick={() => setEscolherTom((antes) => !antes)}
        >
          {exemploDoTom}
        </button>
      </div>

      {escolherTom && (
        <div className="emoji-tons" role="radiogroup" aria-label={strings.emoji.tomTitulo}>
          {strings.emoji.tons.map((nome, indice) => (
            <button
              key={nome}
              type="button"
              role="radio"
              aria-checked={indice === tom}
              aria-label={nome}
              className={indice === tom ? "emoji-tom-opcao on" : "emoji-tom-opcao"}
              onClick={() => mudarTom(indice)}
            >
              {catalog ? catalog.withTone(MAO, indice) : MAO}
            </button>
          ))}
        </div>
      )}

      <div className="emoji-tabs">
        {recents.length > 0 && (
          <button
            type="button"
            className={seccaoVisivel === 0 ? "emoji-tab on" : "emoji-tab"}
            aria-pressed={seccaoVisivel === 0}
            title={strings.emoji.recents}
            aria-label={strings.emoji.recents}
            onClick={() => {
              if (searching) {
                abaPendente.current = RECENTS_ID
                procurar("")
                return
              }
              rolarPara(0)
              setCursor(0)
            }}
          >
            🕐
          </button>
        )}
        {EMOJI_CATEGORY_TABS.map((entry) => {
          const indice = searching ? -1 : seccoes.findIndex((seccao) => seccao.id === entry.id)
          const ligada = indice >= 0 && seccaoVisivel === indice
          return (
            <button
              key={entry.id}
              type="button"
              className={ligada ? "emoji-tab on" : "emoji-tab"}
              aria-pressed={ligada}
              title={strings.emoji.categorias[entry.id]}
              aria-label={strings.emoji.categorias[entry.id]}
              // A category during a search clears the search and jumps there: both use the
              // same list and cannot contradict each other.
              onClick={() => {
                if (searching || indice < 0) {
                  abaPendente.current = entry.id
                  procurar("")
                  return
                }
                const { indice: primeiro, y } = inicioDaSeccao(indice)
                rolarPara(y)
                setCursor(primeiro)
              }}
            >
              {entry.symbol}
            </button>
          )
        })}
      </div>

      <div
        ref={lista}
        className="emoji-grid"
        role="group"
        aria-label={groupLabel}
        onScroll={(event) => setTopo(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (todos.length === 0) return
          const moves: Record<string, (() => number) | undefined> = {
            // At the edges the cursor stops instead of wrapping: in a grid, jumping from
            // the end to the start makes you lose your place while reading.
            ArrowRight: () => Math.min(cursor + 1, todos.length - 1),
            ArrowLeft: () => Math.max(cursor - 1, 0),
            ArrowDown: () => mudarDeLinha(1),
            ArrowUp: () => mudarDeLinha(-1),
            Home: () => 0,
            End: () => todos.length - 1,
          }
          const move = moves[event.key]
          if (!move) return
          event.preventDefault()
          focusAt(move())
        }}
        onMouseLeave={() => setHint(null)}
      >
        <div className="emoji-lista" style={{ height: disposicao.altura }}>
          {desenhadas.map((indice) => {
            const linha = linhas[indice] as Linha
            if (linha.tipo === "cabecalho") {
              return (
                <p key={`c${linha.seccao}`} className="emoji-cabecalho" style={{ top: linha.topo }} aria-hidden="true">
                  {seccoes[linha.seccao]?.rotulo}
                </p>
              )
            }
            const celulas: React.JSX.Element[] = []
            for (let i = linha.inicio; i < linha.fim; i++) {
              const emoji = todos[i] as Emoji
              celulas.push(
                <button
                  key={i}
                  type="button"
                  className="emoji-cell"
                  data-i={i}
                  // Only one button per grid is reachable by Tab. See the header comment.
                  tabIndex={i === cursor ? 0 : -1}
                  aria-label={emoji.name}
                  onFocus={() => {
                    setCursor(i)
                    setHint(emoji)
                  }}
                  onMouseEnter={() => setHint(emoji)}
                  onClick={() => choose(emoji.char)}
                >
                  {emoji.char}
                </button>,
              )
            }
            return (
              <div key={`l${linha.inicio}`} className="emoji-linha" style={{ top: linha.topo }}>
                {celulas}
              </div>
            )
          })}
        </div>
        {catalog && todos.length === 0 && <p className="emoji-empty">{strings.emoji.noResults}</p>}
      </div>

      <footer className="emoji-foot">
        <span className="emoji-hint">
          {hint && (
            <>
              <span className="emoji-hint-glifo" aria-hidden="true">
                {hint.char}
              </span>
              {hint.name}
            </>
          )}
        </span>
        <button type="button" className="emoji-close" onClick={onClose}>
          {strings.emoji.close}
        </button>
      </footer>
    </Modal>
  )
}
