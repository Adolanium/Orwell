import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { bytesQueAindaCabem, caracteresDeDataUrl, FICHEIRO_MAX_BYTES } from "@enclave/client-core"
import type { ConnectionState, LinkCard, Profile } from "../../bridge.js"
import { useBridge } from "../../App.js"
import type { MessageExtras, OutgoingFile, OutgoingImage } from "../../types.js"
import { Button } from "../../components/Button.js"
import { EmojiPicker } from "../../components/EmojiPicker.js"
import { primeiroEndereco } from "../../components/RichText.js"
import { useFormatacao } from "../../hooks/useAtalhosDeFormatacao.js"
import { BarraDeFormatacao } from "./BarraDeFormatacao.js"
import { CloseIcon, EnviarIcon, PlusIcon, SmileyIcon } from "../../icons.js"
import { alturaDaCaixa } from "../../lib/alturaDaCaixa.js"
import { colarImagens } from "../../lib/colar.js"
import {
  comandosASugerir,
  corpoDoMe,
  ESTADO_MAX_CARACTERES,
  lerComando,
  type Comando,
  type ComandoLido,
} from "../../lib/comandosDaBarra.js"
import { extensaoDe, formatarBytes, lerComoDataUrl, nomeSeguro } from "../../lib/ficheiros.js"
import {
  avisoDeAnimacaoPerdida,
  compressImage,
  IMAGE_BUDGETS,
  orcamentosDaMensagem,
  resumoDaReducao,
  tipoDoDataUrl,
} from "../../lib/images.js"
import {
  aplicarMencoesComTodos,
  inserirMencao,
  sugerirMencoes,
  type MentionCandidate,
  type MentionPick,
} from "../../lib/mentions.js"
import { comResposta, type RespostaNaCaixa } from "../../lib/respostas.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"
import { strings, translateError, traduzirErro } from "../../strings.js"
import { ContextMenu } from "../overlays/ContextMenu.js"
import { BuzzButton } from "./BuzzButton.js"
import { LinkAttach } from "./LinkAttach.js"
import { VideoPreviews, withinMs } from "./videoPreviews.js"
import { youtubeIdOf } from "@enclave/protocol"
import { MentionPicker } from "./MentionPicker.js"
import { etiquetaEmCurso, sugerirEtiquetas } from "../../lib/etiquetas.js"

/**
 * How many images fit in a message, and why this number.
 *
 * The protocol accepts ten. What matters here is the other cap: the frame
 * that comes out for the thread carries base64 of the encrypted base64 of the
 * image (about 1.8× the original bytes) and the session refuses anything over
 * 11 MB. Four images at 400 KB are about 2.9 MB in the thread, plenty safe,
 * and the refusal happens during composition, not midway through a send already
 * marked complete.
 */
/**
 * The character limit for a message, and where the counter shows up.
 *
 * The requirement: "a comfortable number for users".
 * 2000 is Discord's, which is the reference for who uses this: it fits a long
 * paragraph, but not a document. The protocol can handle much more (the real
 * cap is on the encrypted payload, `PAYLOAD_MAX_CHARS`); this is a comfort
 * limit, for the writer's side. The counter only shows near the end, so
 * people writing "ok" are not staring at a character count.
 */
export const MENSAGEM_MAX_CARACTERES = 2000

/**
 * How long Enter holds a YouTube message whose preview is still on its way.
 *
 * People paste a video and press Enter at once, and the preview comes about a
 * second later. A card sent without its thumbnail stays without it forever:
 * nothing fills a message after it leaves (21/11/2026, "many YouTube
 * thumbnails are still blank"). A host that does not answer in this time
 * costs the thumbnail, never the message: it then leaves with the playable card.
 */
export const VIDEO_PREVIEW_WAIT_MS = 5000

/** The key of a held message whose send failed (1.3.26 review, note 9). Error 370. */
export const ERRO_ENVIO_RETIDO = "the message could not be sent"
const CONTADOR_A_PARTIR_DE = 1800

const IMAGENS_MAX = 4

/**
 * Room kept for what can still join the message after the images: the text at
 * its worst (every character escaped to six in JSON) and a link card (its
 * thumbnail budget is 72 KB, under 100,000 characters). Only animated GIFs are
 * measured against the frame (`orcamentosDaMensagem`), and they are the only
 * images big enough to need this.
 */
const FOLGA_DO_TEXTO_E_CARTAO = MENSAGEM_MAX_CARACTERES * 6 + 100_000

/**
 * How many files fit in a message.
 *
 * The protocol accepts ten ATTACHMENTS total, images included. Four images are
 * already accounted for, so six is what remains. But even those six rarely fit,
 * because the cap that really matters is the byte count, not the count itself:
 * see `bytesQueAindaCabem`, which is checked for each file picked and drops as
 * the message fills up.
 *
 * This number exists only for the edge case of someone dragging fifty tiny
 * files: without it, a message with thirty attachments would pass the byte cap
 * and be rejected by the schema on send.
 */
const FICHEIROS_MAX = 6

/**
 * Controlled by the per-channel draft map upstream, so switching channels
 * keeps each conversation's half-written sentence. On submit the text is
 * handed to the outbox *first* and only then cleared: a failed send lives on
 * as a failed bubble, never as vanished input.
 *
 * Images and the link card do NOT persist across channels, unlike text: an
 * attachment is a completed gesture, and rediscovering it hanging in a
 * conversation you return to half an hour later would be a cheap way to send
 * a photo to the wrong person.
 */
/**
 * The buzz is back in view.
 *
 * It was hidden for a while, with the entire
 * path live and tested underneath: the `useBuzz`, the `buzz` sound, the shake
 * `.main.buzzing` and the protocol event. It came back with a new limit, one
 * per minute per conversation (`lib/limiteDaCotovelada.ts`), which is what sets
 * it apart from a cheap way to bother someone.
 *
 * The toggle stays, to hide it again in one line if needed.
 */
const MOSTRAR_COTOVELADA = true

/**
 * Polls are hidden, as a product decision.
 *
 * Hidden, not removed: the entire path stays live and tested. The `Poll` in
 * the protocol, the count, vote rebroadcast, the card. What is gone are the
 * two entry points where someone creates one: the menu entry in the conversation
 * and the button in the feed.
 *
 * An existing poll keeps drawing and accepting votes. Hiding creation is not
 * erasing what was already said, and removing a poll from the screen that
 * someone else sees would be worse than not having the feature.
 *
 * It comes back in one line, and while it is off there is no dead code: tests
 * keep exercising everything underneath.
 */
const MOSTRAR_VOTACOES = false

/** A finger and no mouse: the phone's virtual keyboard. See `enviarComEnter`. */
function comDedo(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches
}

/**
 * The conversation area around this composer: the scroller plus the composer.
 * Without a scroller (a sheet, a test), the visible height of the window.
 */
function areaDaConversa(form: HTMLFormElement | null): number {
  const rolo = form?.parentElement?.querySelector<HTMLElement>(":scope > .timeline, :scope .timeline")
  if (form && rolo) return rolo.clientHeight + form.offsetHeight
  if (typeof window === "undefined") return 0
  return window.visualViewport?.height ?? window.innerHeight
}

export function Composer({
  connection,
  value,
  onChange,
  onSend,
  onTyping,
  mentionable = [],
  podeMencionarTodos = false,
  cargos = [],
  salas = [],
  directory,
  presenceFor,
  emChamada,
  onBuzz,
  buzzCooldown = 0,
  onVotacao,
  meuNome,
  onSaveStatus,
  eu = null,
  resposta = null,
  onAlternarMencao,
  onCancelarResposta,
  faixa,
  rodape,
  avisoDeContaNova,
}: {
  connection: ConnectionState
  value: string
  onChange: (text: string) => void
  onSend: (body: string, extras?: MessageExtras) => void
  /**
   * A key was pressed. The signal rate is decided in `useTyping`, not here:
   * this box calls this for each keystroke and the vast majority of calls send
   * nothing.
   */
  onTyping?: (() => void) | undefined
  /**
   * A strip drawn at the top of the form, above the box: "who is typing"
   * (`QuemEscreve`). Inside the form so it scrolls with nothing and its
   * height is part of the composer's, reserved.
   */
  faixa?: React.ReactNode
  /**
   * A line drawn at the bottom of the form, under the box: "Catching up on this
   * conversation…" (`AvisoAPorEmDia`, 1.3.26). Inside the form for the same
   * reasons as `faixa`, and so on the phone it stays above the keyboard.
   */
  rodape?: React.ReactNode
  /**
   * The account is in its first 24 hours and this is the common room (1.3.26):
   * the sentence that says so, above the box, and no images, files or link
   * cards from here. The server refuses large messages there anyway; this says
   * why before anything is chosen. Absent: as always.
   */
  avisoDeContaNova?: string | undefined
  /**
   * Who can be mentioned here, with their name already resolved.
   *
   * It comes from above and is not looked up here, because the conversation
   * screen knows who is in this room. It always comes from this device's
   * directory: there is no global account search in this product, and asking
   * the server who matches a prefix was leaking the social graph one letter
   * at a time.
   */
  mentionable?: readonly MentionCandidate[]
  /**
   * Whether the writer can mention everyone in this room. With it, the list
   * offers `@all` and sending includes a mention for everyone. Without it,
   * `@all` typed by hand comes through as plain text. Missing means "cannot".
   */
  podeMencionarTodos?: boolean | undefined
  /**
   * The roles `@` offers after people (12/11/2026), already filtered to the ones
   * this writer may mention. See `lib/etiquetas.ts`.
   */
  cargos?: readonly MentionCandidate[] | undefined
  /** The rooms `#` offers: only the ones this account sees. */
  salas?: readonly MentionCandidate[] | undefined
  /** Just to show each person's photo next to their name in suggestions. */
  directory?: Map<string, Profile> | undefined
  /** The ring of photos in suggestions. See `MentionPicker`. */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  emChamada?: ((address: string) => boolean) | undefined
  /**
   * Send a buzz, if this conversation allows it.
   *
   * Missing is missing: without this there is no button. The `useBuzz` decides
   * if the conversation allows it. Only in direct chats, because a buzz to
   * thirty people is an alarm. This box does not repeat the rule, just obeys
   * whoever gives it to them or not.
   */
  onBuzz?: (() => void) | undefined
  /** Seconds left before another buzz can be sent. Zero means free. */
  buzzCooldown?: number
  /**
   * Create a poll in this conversation.
   *
   * Opens the sheet, which lives in the shell: this box does not mount or send
   * the poll, just says someone asked for one. Missing is missing: without it
   * there is no menu entry. A host that does not know about polls stays without
   * them instead of offering them and failing.
   */
  onVotacao?: (() => void) | undefined
  /**
   * The name of the writer, so `/me` comes out as "Ana waves". Missing, `/me`
   * comes out with just the action in italics, like Discord: the conversation
   * already shows who wrote it. See `lib/comandosDaBarra.ts`.
   */
  meuNome?: string | undefined
  /**
   * Set the status message via `/away` and `/estado`. It's the SAME gesture as
   * the account card (`onSaveStatus` from `CartaoDaConta`), not a separate
   * path. When unavailable, both commands say where to change it instead of
   * pretending.
   */
  onSaveStatus?: ((statusText: string) => void) | undefined
  /** The writer's account: do not mention yourself. */
  eu?: string | null | undefined
  /**
   * The reply being written, if any. It lives above, per room, like a draft:
   * switching rooms and coming back finds it where it was.
   */
  resposta?: RespostaNaCaixa | null | undefined
  /** The "@ Mencionar" toggle. */
  onAlternarMencao?: (() => void) | undefined
  /** The X on the bar, and Esc in the box. */
  onCancelarResposta?: (() => void) | undefined
}): React.JSX.Element {
  /*
    No connection, you can still write.

    The box was blank offline, and the thought someone had in their head on the
    train would be lost. Now the message goes into the outbox as "waiting for
    connection", shows in the conversation with that mark, and sends itself when
    the connection comes back. See `useOutbox`.

    Images and files still need connection: they are megabytes in memory waiting
    for a network that might not return in this session, and a large send
    mid-reconnect is the case that fails most. The `+` says why when you tap it,
    instead of being blank with no explanation.
  */
  const offline = connection !== "online"
  /*
    A vault that no longer writes (old version, or another vault got the
    storage) will not reconnect, not even via the button. There, writing to the
    outbox was a promise for a send that never leaves: the box closes and says
    why. A bridge with the prompt writes, as always.
  */
  const bridge = useBridge()
  // Read on every draw, no memory: stopping the write closes the session, and
  // the `connection` change that brings is the draw that reads it again.
  const parado = bridge.session?.escreve?.() === false
  /** The person tapped `+` with no connection: show the reason. */
  const [pediuAnexoOffline, setPediuAnexoOffline] = useState(false)
  useEffect(() => {
    if (!offline) setPediuAnexoOffline(false)
  }, [offline])

  const [picking, setPicking] = useState(false)
  const [images, setImages] = useState<OutgoingImage[]>([])
  const [files, setFiles] = useState<OutgoingFile[]>([])
  const [aLer, setALer] = useState(false)
  const [card, setCard] = useState<LinkCard | null>(null)
  /** The video previews of this box, shared by the card and by Enter: one request per video. */
  const videoPreviews = useRef<VideoPreviews | null>(null)
  videoPreviews.current ??= new VideoPreviews((alvo) => bridge.social.linkPreview(alvo))
  /**
   * The messages that wait for a video preview, in order. A message written
   * after one of them goes behind it, never in front: the order on screen is
   * the order of Enter.
   */
  const filaDeEnvio = useRef<{ fim: Promise<void>; aEsperar: number }>({ fim: Promise.resolve(), aEsperar: 0 })
  /**
   * The held messages not sent yet, in Enter order (1.3.26 review, note 9). On
   * `pagehide` each leaves at once with the card it has: a reload, a closed
   * tab or the iOS back-forward cache in those seconds used to lose it.
   */
  const retidas = useRef<{ feito: boolean; sairJa: () => void }[]>([])
  useEffect(() => {
    const largarRetidas = (): void => {
      for (const retida of retidas.current.splice(0)) {
        if (retida.feito) continue
        retida.feito = true
        retida.sairJa()
      }
    }
    window.addEventListener("pagehide", largarRetidas)
    return () => window.removeEventListener("pagehide", largarRetidas)
  }, [])
  /** The box's text now, for a held message that fails: it comes back only into an empty box. */
  const valorActual = useRef(value)
  valorActual.current = value
  /** An address whose preview the person dismissed. The link still goes through. */
  const [dispensado, setDispensado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  /**
   * What compression did to the image, in bytes.
   *
   * Separate from `warning` because it is not a warning: nothing went wrong,
   * and drawing it in red next to the refusals would teach people to ignore
   * both. A photo that comes in at twelve megabytes and leaves at three hundred
   * kilobytes changed, and whoever sends it has the right to know without
   * discovering it on the other end.
   */
  const [reducao, setReducao] = useState<string | null>(null)
  /** A GIF that went still: not an error, the image is there, it just does not move. */
  const [avisoDoGif, setAvisoDoGif] = useState<string | null>(null)
  const [aComprimir, setAComprimir] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  /**
   * Starting a reply puts the focus in the box: someone who tapped "Reply"
   * wants to write next. By ID, not by object: changing the mention does not
   * start a new reply.
   */
  const respostaId = resposta?.id ?? null
  useEffect(() => {
    if (respostaId !== null) field.current?.focus()
  }, [respostaId])
  /** The two file fields, hidden and opened by the `+` menu. */
  const campoImagens = useRef<HTMLInputElement>(null)
  const campoFicheiros = useRef<HTMLInputElement>(null)
  const botaoMais = useRef<HTMLButtonElement>(null)
  /** Where the `+` menu is open, or null if it is not. */
  const [maisAberto, setMaisAberto] = useState<{ x: number; y: number } | null>(null)
  const caret = useRef<number | null>(null)
  /** Cmd/Ctrl+B and friends, on whatever is selected, and the same for the bar's buttons. See the hook. */
  const { aoTeclar: formatar, aplicar: aplicarFormatacao } = useFormatacao(value, onChange)

  // The cursor goes back after the emoji lands. The text is controlled above,
  // so the box only exists with the new value after this render. Before that
  // there is nowhere to put the cursor.
  useEffect(() => {
    const at = caret.current
    if (at === null) return
    caret.current = null
    const node = field.current
    if (!node) return
    node.focus()
    node.setSelectionRange(at, at)
  }, [value])

  /**
   * The box grows with the text, line by line, up to half of the conversation
   * area, and then scrolls inside (20/11/2026). See `lib/alturaDaCaixa.ts`.
   * Measured before paint, so a new line never flashes a scroll bar. After
   * sending, the value is empty and the box goes back to one line.
   */
  /** More than one line: the buttons go to the bottom of the line (`caixaDeEscrita.css`). */
  const [variasLinhas, setVariasLinhas] = useState(false)
  const ajustarAltura = useCallback(() => {
    const caixa = field.current
    if (!caixa) return
    caixa.style.height = "auto"
    // Empty, the box is one line: the placeholder can wrap on a narrow screen,
    // and its height is not text. No layout (a test DOM): one line too.
    if (caixa.value === "" || caixa.scrollHeight === 0) {
      caixa.style.height = ""
      caixa.style.overflowY = ""
      setVariasLinhas(false)
      return
    }
    const umaLinha = caixa.offsetHeight
    const conteudo = caixa.scrollHeight + (caixa.offsetHeight - caixa.clientHeight)
    const { altura, rola } = alturaDaCaixa({ conteudo, area: areaDaConversa(caixa.form), minima: umaLinha })
    caixa.style.height = `${altura}px`
    caixa.style.overflowY = rola ? "auto" : "hidden"
    setVariasLinhas(altura > umaLinha)
  }, [])
  useLayoutEffect(ajustarAltura, [value, ajustarAltura])
  // The area changes with the window and, on the phone, with the keyboard.
  useEffect(() => {
    if (typeof window === "undefined") return
    window.addEventListener("resize", ajustarAltura)
    window.visualViewport?.addEventListener("resize", ajustarAltura)
    return () => {
      window.removeEventListener("resize", ajustarAltura)
      window.visualViewport?.removeEventListener("resize", ajustarAltura)
    }
  }, [ajustarAltura])

  // ------------------------------------------------------------- mentions
  //
  // The people picked in this sentence. Held until send, where the names are
  // swapped for addresses. See `aplicarMencoes`. Anyone picked and then deleted
  // by hand does not survive the swap, and that is how it should be: a mention
  // that is no longer written is not a mention.
  const [picks, setPicks] = useState<MentionPick[]>([])
  /** Where the @ starts being typed, and what already follows it. */
  const [mencao, setMencao] = useState<{ inicio: number; procura: string; sinal: "@" | "#" } | null>(null)
  const [escolhido, setEscolhido] = useState(0)
  /** An @ that the person closed with Escape. Does not reopen until they touch it. */
  const [dispensada, setDispensada] = useState<number | null>(null)

  const sugestoes = useMemo(
    () =>
      !mencao || mencao.inicio === dispensada
        ? []
        : mencao.sinal === "#"
          ? sugerirMencoes(salas, mencao.procura)
          : sugerirEtiquetas(mentionable, cargos, mencao.procura, podeMencionarTodos, salas),
    [mencao, dispensada, mentionable, podeMencionarTodos, cargos, salas],
  )
  const aSugerir = sugestoes.length > 0

  // ------------------------------------------------- slash commands
  //
  // The list when typing `/`, like the mention list and with the same keyboard.
  // Mentions win if both show: an @ in the middle of a command is the person
  // picking someone, and that is the list they are reading.
  const [comandoEscolhido, setComandoEscolhido] = useState(0)
  /** The list was closed with Escape. It comes back when the text stops starting with `/`. */
  const [comandosDispensados, setComandosDispensados] = useState(false)
  const comandos = useMemo(
    () => (comandosDispensados ? [] : comandosASugerir(value)),
    [value, comandosDispensados],
  )
  const aSugerirComando = !aSugerir && comandos.length > 0
  /** What a command did, stated without the red of a warning: nothing went wrong. */
  const [nota, setNota] = useState<string | null>(null)

  const escolherComando = (comando: Comando): void => {
    const texto = `/${comando.nome} `
    onChange(texto)
    caret.current = texto.length
    setComandoEscolhido(0)
  }

  /**
   * Execute the command that was read. Returns the body to send (only `/me` sends), or
   * `null` when the command ends here: handled, or rejected with the reason.
   *
   * A rejected command leaves the text in the box so the user can fix it without
   * retyping. A completed command clears it, like a sent message.
   */
  const fazerComando = ({ nome, argumento }: ComandoLido): string | null => {
    switch (nome) {
      case "me":
        if (argumento.length === 0) {
          setAviso(strings.barra.meVazio)
          return null
        }
        return corpoDoMe(argumento, meuNome)
      case "away":
      case "estado":
        if (!onSaveStatus) {
          setAviso(strings.barra.estadoIndisponivel)
          return null
        }
        if (argumento.length > ESTADO_MAX_CARACTERES) {
          setAviso(strings.barra.estadoLongo(ESTADO_MAX_CARACTERES))
          return null
        }
        // No text clears the box, like `/away` in IRC: it means "I'm back".
        onSaveStatus(argumento)
        onChange("")
        setPicks([])
        setMencao(null)
        setAviso(null)
        setNota(argumento.length > 0 ? strings.barra.estadoPosto : strings.barra.estadoApagado)
        return null
      case "nick":
      case "topic":
      case "kick":
        // These depend on the backend (account name, channel topic, kick via
        // slash). Until then, the server reports them, and does not send the command as text: a
        // `/kick ana` in the chat would be worse than nothing.
        setAviso(strings.barra.naProximaVersao(`/${nome}`))
        return null
    }
  }

  /** Re-evaluate the mention at each keystroke, starting from the cursor position. */
  const reavaliarMencao = (texto: string, cursor: number): void => {
    const encontrada = etiquetaEmCurso(texto, cursor)
    setMencao(encontrada)
    setEscolhido(0)
    // Moved to a different mention: the one that was dismissed no longer counts.
    if (encontrada === null || encontrada.inicio !== dispensada) setDispensada(null)
  }

  const escolherMencao = (candidato: MentionCandidate): void => {
    if (!mencao) return
    const node = field.current
    const cursor = node?.selectionStart ?? value.length
    const { texto, cursor: novoCursor, pick } = inserirMencao(value, mencao.inicio, cursor, candidato)
    onChange(texto)
    caret.current = novoCursor
    // The same person chosen twice counts once: the token is the same, and
    // two identical entries would run the swap twice over itself.
    setPicks((atuais) =>
      atuais.some((p) => p.token === pick.token && p.address === pick.address) ? atuais : [...atuais, pick],
    )
    setMencao(null)
    setDispensada(null)
  }

  const endereco = useMemo(() => primeiroEndereco(value), [value])

  // The card describes ONE address. If the address changes, the old card becomes
  // a wrong label stuck to a new link, which is worse than having none.
  useEffect(() => {
    setCard((atual) => (atual && atual.url === endereco ? atual : null))
  }, [endereco])

  /**
   * Insert the emoji where the cursor was, not at the end.
   *
   * If someone writes "thanks " and moves back to add an emoji in the middle of the sentence,
   * they don't want to see it land after the period. With no known selection,
   * a box that has not been touched yet assumes the end of the text is correct.
   */
  /**
   * The box was never focused. An `<input>` keeps its cursor at the end of a
   * value it was given; a text area keeps it at 0. An emoji picked before
   * anyone touched the box goes at the end, as it did with the `<input>`.
   */
  const tocada = useRef(false)
  const insert = (char: string): void => {
    const node = field.current
    const intocada = !tocada.current && node !== null && node.selectionStart === 0 && node.selectionEnd === 0
    const start = intocada ? value.length : (node?.selectionStart ?? value.length)
    const end = intocada ? start : (node?.selectionEnd ?? start)
    onChange(value.slice(0, start) + char + value.slice(end))
    caret.current = start + char.length
  }

  /**
   * Choose images.
   *
   * ALL of them go through the compressor before being encrypted, and it must be in this
   * order: encrypted, an image is noise that no one can shrink, not this
   * device, not the server, which is the point. See `lib/images.ts` for the
   * budgets and the reason for each one.
   */
  const escolherImagens = (escolhidasTodas: File[]): void => {
    if (escolhidasTodas.length === 0) return
    // A first-day account in the common room (1.3.26): pasted or dropped images stop here too.
    if (avisoDeContaNova !== undefined) {
      setAviso(avisoDeContaNova)
      return
    }
    const espaço = IMAGENS_MAX - images.length
    if (espaço <= 0) {
      setAviso(strings.chat.imagesFull(IMAGENS_MAX))
      return
    }
    setAviso(null)
    setReducao(null)
    setAvisoDoGif(null)
    setAComprimir(true)
    const escolhidas = escolhidasTodas.slice(0, espaço)
    // An animated GIF can weigh five photos: each one keeps its cap only if it
    // still fits in the message. See `orcamentosDaMensagem`.
    const orcamentos = orcamentosDaMensagem(escolhidas, ocupado + FOLGA_DO_TEXTO_E_CARTAO, IMAGE_BUDGETS.chat)
    void Promise.all(
      escolhidas.map(async (file, indice) => {
        const orcamento = orcamentos[indice] ?? IMAGE_BUDGETS.chat
        const imagem = await compressImage(file, orcamento)
        // The type of the bytes that go out, read from the data URL: a GIF
        // recoded to WebP is no longer a GIF. A file with no type passes intact
        // as `application/octet-stream`, which is not a type to send an image
        // with: then the old rule (what the picker or `lib/colar.ts` said).
        const tipo = tipoDoDataUrl(imagem.dataUrl)
        const novaImagem: OutgoingImage = {
          dataUrl: imagem.dataUrl,
          name: file.name || "imagem",
          mediaType: tipo.startsWith("image/") ? tipo : file.type || "image/jpeg",
          bytes: imagem.bytes,
        }
        return { novaImagem, aviso: avisoDeAnimacaoPerdida(file, imagem, orcamento, "mensagem") }
      }),
    )
      .then((resultados) => {
        const novas = resultados.map((resultado) => resultado.novaImagem)
        setImages((atuais) => [...atuais, ...novas].slice(0, IMAGENS_MAX))
        setReducao(resumoDaReducao(escolhidas, novas))
        setAvisoDoGif(resultados.find((resultado) => resultado.aviso)?.aviso ?? null)
      })
      // An image that does not fit is an error to show here, not a message that
      // the other side discards entirely and silently. It goes through translation to
      // carry the code ("Error 501") and the phrase in the interface language.
      .catch((erro: Error) => setAviso(traduzirErro(erro)))
      .finally(() => setAComprimir(false))
  }

  /**
   * Handle a `paste` in the text box.
   *
   * The entire policy, text wins, bytes decide the type, either everything enters or
   * nothing enters, lives in `lib/colar.ts` and is shared with the feed text box. Here
   * is only the destination: confirmed images enter through the
   * SAME path as the button, with the same compressor, the same limits and the
   * same rejections. A second path for the same attachment is what gets left behind
   * the day we add a check to one of them.
   */
  const colar = (event: React.ClipboardEvent): void => {
    const tomou = colarImagens(event.clipboardData, {
      aceitar: escolherImagens,
      recusar: () => setAviso(strings.common.pasteNotImage),
    })
    // The browser only locks up if there are images to process: a
    // `preventDefault` on text pasting would swallow the user's sentence, which is
    // a much worse trade than not having this feature.
    if (tomou) event.preventDefault()
  }

  /**
   * The payload characters this message has already used.
   *
   * Measured, not estimated: `JSON.stringify` of the text counts escapes for real
   * (an emoji takes more than one character after escaping), and data URLs
   * count by their actual length. This number is what gets deducted from the limit
   * before accepting another file, because a fixed limit would lie the second time
   * something attaches to the message.
   */
  const ocupado = useMemo(() => {
    let total = JSON.stringify(value).length + (card ? JSON.stringify(card).length : 0)
    for (const imagem of images) total += imagem.dataUrl.length
    for (const ficheiro of files) total += ficheiro.dataUrl.length
    return total
  }, [value, card, images, files])

  /**
   * Choose files that are not images.
   *
   * **They do not go through any compressor, and that is intentional.** A photograph
   * shrinks because it has redundancy to lose; a PDF already comes compressed inside
   * and recompressing it gets BIGGER, the second pass only adds
   * headers to bytes that have no pattern left to exploit. Instead of compression
   * we have an honest rejection, and that is why it has to be good.
   *
   * **The check happens before reading the file.** `file.size` is known
   * without touching the bytes, so a half-gigabyte file chosen by mistake
   * is rejected without costing half a gigabyte of memory. It is only read after it fits.
   *
   * **And it is sequential on purpose.** Each file accepted changes the budget for
   * the next one; if chosen in parallel, two two-megabyte files would both pass
   * on an empty message budget and together bust the frame.
   */
  const escolherFicheiros = async (escolhidos: File[]): Promise<void> => {
    if (avisoDeContaNova !== undefined) {
      setAviso(avisoDeContaNova)
      return
    }
    const espaço = FICHEIROS_MAX - files.length
    if (espaço <= 0) {
      setAviso(strings.chat.filesFull(FICHEIROS_MAX))
      return
    }
    setAviso(null)
    setALer(true)
    try {
      let gasto = ocupado
      const novos: OutgoingFile[] = []
      for (const file of escolhidos.slice(0, espaço)) {
        const mediaType = file.type || "application/octet-stream"
        const cabe = bytesQueAindaCabem(gasto, mediaType)
        if (cabe <= 0) {
          setAviso(strings.chat.fileNoRoom)
          break
        }
        if (file.size > cabe) {
          // The number reported is what fits NOW, not the absolute limit: it is the
          // only answer to the question the user just asked. The absolute limit
          // stays on the button label for whoever wants to know ahead of time.
          setAviso(strings.chat.fileTooBig(nomeSeguro(file.name), formatarBytes(cabe)))
          break
        }
        const dataUrl = await lerComoDataUrl(file)
        gasto += caracteresDeDataUrl(file.size, mediaType)
        novos.push({ dataUrl, name: file.name, mediaType, bytes: file.size })
      }
      if (novos.length > 0) setFiles((atuais) => [...atuais, ...novos].slice(0, FICHEIROS_MAX))
    } catch {
      setAviso(strings.chat.fileUnreadable)
    } finally {
      setALer(false)
    }
  }

  const limpar = (): void => {
    setImages([])
    setFiles([])
    setCard(null)
    setDispensado(null)
    setAviso(null)
    setReducao(null)
    setAvisoDoGif(null)
    setPicks([])
    setMencao(null)
    setDispensada(null)
    setNota(null)
  }

  const vazio = value.trim().length === 0 && images.length === 0 && files.length === 0
  /** Attachments chosen with a connection, and the connection dropped before sending. */
  const anexosSemLigacao = offline && (images.length > 0 || files.length > 0)
  const notaOffline = offline && (pediuAnexoOffline || anexosSemLigacao)
  /** Nothing goes out while bytes are still coming in: see `aComprimir` and `aLer`. */
  const ocupada = aComprimir || aLer

  /**
   * The keys of the text box that the suggestion menus and the reply bar use.
   * Enter that none of them took goes on to `enviarComEnter`.
   */
  const teclarNaCaixa = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Formatting first, and only it needs to come first: it always takes Cmd/Ctrl,
    // so it never fights a key with the suggestions menu, which uses arrows, Enter, Tab and Escape.
    if (formatar(event)) return
    /*
      The list of commands, with the mentions menu keyboard: arrow keys to
      navigate, Enter or Tab to select, Escape to close without changing
      the text. Only when the mentions menu is not open.
    */
    if (aSugerirComando) {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setComandosDispensados(true)
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setComandoEscolhido((atual) => (atual + 1) % comandos.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setComandoEscolhido((atual) => (atual - 1 + comandos.length) % comandos.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const comando = comandos[comandoEscolhido]
        if (!comando) return
        event.preventDefault()
        escolherComando(comando)
      }
      return
    }
    if (!aSugerir) {
      // Without the list open, Esc cancels the reply, like in Discord.
      // With the list open, Esc belongs to it (closes it), and the reply stays.
      if (event.key === "Escape" && resposta && onCancelarResposta) {
        event.preventDefault()
        event.stopPropagation()
        onCancelarResposta()
      }
      return
    }
    /**
     * With the menu open, the keyboard is its own. Only the keys it uses.
     *
     * Escape CLOSES THE MENU AND DELETES NOTHING: it is the key you press
     * when the menu is in the way, and an Escape that cleared the
     * text below it would be the worst trade-off in the entire app.
     * So we store which mention was dismissed instead of changing the text.
     */
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setDispensada(mencao?.inicio ?? null)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setEscolhido((atual) => (atual + 1) % sugestoes.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setEscolhido((atual) => (atual - 1 + sugestoes.length) % sugestoes.length)
      return
    }
    // Enter and Tab select. Without `preventDefault`, Enter would reach
    // the form and send the message while naming someone.
    if (event.key === "Enter" || event.key === "Tab") {
      const candidato = sugestoes[escolhido]
      if (!candidato) return
      event.preventDefault()
      escolherMencao(candidato)
    }
  }

  /**
   * Enter sends; Shift+Enter starts a new line (20/11/2026).
   *
   * The box is a text area, and a text area does not submit its form on
   * Enter: here is where it does. Enter that a menu already took
   * (`defaultPrevented`) does not send. Neither does Enter in the middle of an
   * IME composition: that Enter picks the characters.
   *
   * With a finger, Enter starts a new line and the send button sends, like
   * Discord on the phone. A virtual keyboard has no Shift+Enter that anyone
   * finds. Read at each key: the same laptop can have a touch screen.
   */
  const enviarComEnter = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.defaultPrevented) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (comDedo()) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (parado) return
          // With the suggestions menu open, Enter picks a person instead of
          // sending. The `form` gets the submit anyway when the field has focus,
          // so the guard has to be here and not just in `keydown`.
          if (aSugerir) return
          const escrito = value.trim()
          // An image or file alone is a valid message; empty text with nothing attached is not.
          if (!escrito && images.length === 0 && files.length === 0) return
          if (anexosSemLigacao) return
          // A command with a slash decides here whether there is a message. Only `/me` sends,
          // and sends text: the protocol does not know a command happened.
          const comando = lerComando(escrito)
          const body = comando ? fazerComando(comando) : escrito
          if (body === null) return
          if (body.length > MENSAGEM_MAX_CARACTERES) {
            setAviso(strings.chat.messageTooLong(MENSAGEM_MAX_CARACTERES))
            return
          }
          // Names become addresses here: the screen showed the name while
          // typing, and what goes out to the group is the address, the only one
          // that does not age and the only one the notification can route.
          const { corpo, mentions } = aplicarMencoesComTodos(body, picks, podeMencionarTodos)
          // The card of the address in the text. A YouTube video does not depend
          // on the card in the box having been born yet: paste and Enter can land
          // before it (it is set from an effect, a render after the text), and the
          // video then left as plain text. Any other site still waits for the tap.
          const cartaoActual = card && card.url === endereco ? card : null
          const mostraCartao = endereco !== null && endereco !== dispensado && avisoDeContaNova === undefined
          const cartaoDoEnvio: LinkCard | null =
            cartaoActual ?? (mostraCartao && youtubeIdOf(endereco) ? { url: endereco, kind: "video" } : null)
          // The reply goes in here: the `replyTo` and, with "@ Mention" on, the
          // author of the original in the mentions. See `lib/respostas.ts`.
          const extras: MessageExtras = comResposta(
            {
              ...(images.length > 0 ? { images } : {}),
              ...(files.length > 0 ? { files } : {}),
              ...(cartaoDoEnvio ? { links: [cartaoDoEnvio] } : {}),
              ...(mentions.length > 0 ? { mentions } : {}),
            },
            resposta,
            eu,
          )
          // Without attachments, it is called with one argument: the same
          // call as always, and nothing downstream has to learn a new form.
          // `onSend` as it is now: a message held for its preview still goes
          // to the channel and room of this Enter.
          const enviar = onSend
          // What the person typed, as typed: a held send that fails puts it back.
          const escritoNaCaixa = value
          const sair = (prontos: MessageExtras): void => {
            if (prontos.images || prontos.files || prontos.links || prontos.mentions || prontos.replyTo) enviar(corpo, prontos)
            else enviar(corpo)
          }
          /*
            A held message leaves after the box emptied, so a failure there was
            swallowed with the text gone (1.3.26 review, note 9). Now it is said
            (Error 370), and the text comes back if the box is still empty.
          */
          const sairRetida = (prontos: MessageExtras): void => {
            try {
              sair(prontos)
            } catch {
              setAviso(translateError(ERRO_ENVIO_RETIDO))
              if (valorActual.current === "") onChange(escritoNaCaixa)
            }
          }
          // A YouTube card still without its thumbnail waits for the preview
          // (see `VIDEO_PREVIEW_WAIT_MS`). The box empties now all the same.
          const previa =
            cartaoDoEnvio && cartaoDoEnvio.thumbnail === undefined ? videoPreviews.current?.of(cartaoDoEnvio.url) ?? null : null
          const fila = filaDeEnvio.current
          if (!previa && fila.aEsperar === 0) {
            sair(extras)
          } else {
            const cartao = cartaoDoEnvio
            const retida = { feito: false, sairJa: () => sairRetida(extras) }
            retidas.current.push(retida)
            fila.aEsperar++
            fila.fim = fila.fim
              .then(async () => {
                if (retida.feito) return
                const campos = previa ? await withinMs(previa, VIDEO_PREVIEW_WAIT_MS) : null
                // Sent already on `pagehide` while it waited.
                if (retida.feito) return
                retida.feito = true
                // What the card already had wins: only what is missing is filled.
                const completo = cartao && campos ? { ...soDefinidos(campos), ...soDefinidos(cartao) } : cartao
                sairRetida(completo ? { ...extras, links: [completo as LinkCard] } : extras)
              })
              .catch(() => {
                // Only the preview's wait can land here (`sairRetida` catches its own): send what there is.
                if (!retida.feito) {
                  retida.feito = true
                  sairRetida(extras)
                }
              })
              .finally(() => {
                fila.aEsperar--
                retidas.current = retidas.current.filter((cada) => cada !== retida)
              })
          }
          onChange("")
          limpar()
        }}
      >
        {faixa}
        {avisoDeContaNova && (
          <p className="field-note composer-conta-nova" role="status">
            {avisoDeContaNova}
          </p>
        )}
        {/* The reply announcement, always built: a live region that starts
            with text is not read by all screen readers. Polished: it says who
            is being replied to and how to cancel, once. */}
        <span className="sr-only composer-resposta-anuncio" aria-live="polite">
          {resposta ? strings.respostas.anuncio(resposta.nome) : ""}
        </span>
        {/* The reply bar, stuck on top of everything, like in Discord. */}
        {resposta && (
          <div className="composer-resposta">
            <span className="composer-resposta-quem">
              {strings.respostas.aResponderA}{" "}
              <strong>
                <NomeDePessoa nome={resposta.nome} endereco={resposta.autor} />
              </strong>
            </span>
            {resposta.autor !== eu && onAlternarMencao && (
              <button
                type="button"
                className="composer-resposta-mencao"
                aria-pressed={resposta.mencionar}
                title={resposta.mencionar ? strings.respostas.mencionarLigado : strings.respostas.mencionarDesligado}
                onClick={() => {
                  onAlternarMencao()
                  field.current?.focus()
                }}
              >
                {strings.respostas.mencionar}
              </button>
            )}
            {onCancelarResposta && (
              <button
                type="button"
                className="composer-resposta-cancelar"
                aria-label={strings.respostas.cancelar}
                title={strings.respostas.cancelar}
                onClick={() => {
                  onCancelarResposta()
                  field.current?.focus()
                }}
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>
        )}
        {/* Everything that goes with the text lives above the text line, so the
            box does not shrink and the message can still be read in one go. */}
        {(images.length > 0 ||
          files.length > 0 ||
          ocupada ||
          parado ||
          notaOffline ||
          aviso ||
          nota ||
          reducao ||
          avisoDoGif ||
          (endereco && endereco !== dispensado)) && (
          <div className="composer-extras">
            {images.length > 0 && (
              <ul className="composer-images">
                {images.map((image, index) => (
                  <li key={index}>
                    <img src={image.dataUrl} alt={image.name} />
                    <button
                      type="button"
                      title={strings.common.remove}
                      aria-label={strings.chat.imageDrop(image.name)}
                      onClick={() => {
                        setImages((atuais) => atuais.filter((_, i) => i !== index))
                        setAvisoDoGif(null)
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {/* The files, in cards with what you need to know before
                sending: what it is (the extension), the name, and how big it is. No
                thumbnail, a PDF does not have one, and making up a generic
                page icon just wastes space saying "this is a file", which the
                whole line already says. */}
            {files.length > 0 && (
              <ul className="composer-files">
                {files.map((file, index) => {
                  const nome = nomeSeguro(file.name)
                  return (
                    <li key={index}>
                      <span className="file-mark" aria-hidden="true">
                        {extensaoDe(nome) || "?"}
                      </span>
                      <span className="file-text">
                        <bdi className="file-name">{nome}</bdi>
                        <span className="file-meta">{formatarBytes(file.bytes)}</span>
                      </span>
                      <button
                        type="button"
                        title={strings.common.remove}
                        aria-label={strings.chat.fileDrop(nome)}
                        onClick={() => setFiles((atuais) => atuais.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {aComprimir && <p className="field-note">{strings.chat.imageCompressing}</p>}
            {aLer && <p className="field-note">{strings.chat.fileReading}</p>}
            {/* No `warn`: shrinking a photo is not a problem. */}
            {reducao && <p className="field-note">{reducao}</p>}
            {avisoDoGif && (
              <p className="field-note" role="status">
                {avisoDoGif}
              </p>
            )}
            {/* In full and not just in the box text: at 375px the box shows
                about fifteen characters, and this sentence is what tells the user what to do. */}
            {parado && <p className="field-note warn">{strings.connection.separadorParado}</p>}
            {notaOffline && !parado && <p className="field-note">{strings.connection.anexosOffline}</p>}
            {nota && (
              <p className="field-note" role="status">
                {nota}
              </p>
            )}
            {aviso && (
              <p className="field-note warn">
                <TextoDeErro texto={aviso} />
              </p>
            )}
            {endereco && endereco !== dispensado && avisoDeContaNova === undefined && (
              <LinkAttach
                url={endereco}
                card={card}
                previews={videoPreviews.current}
                onChange={setCard}
                onDismiss={() => {
                  setCard(null)
                  setDispensado(endereco)
                }}
              />
            )}
          </div>
        )}

        <div className={variasLinhas ? "composer-line varias-linhas" : "composer-line"}>
          {/* Grows up from the text line, which sits at the bottom:
              a list that dropped from here would be off screen. */}
          {aSugerir && (
            <MentionPicker
              candidatos={sugestoes}
              escolhido={escolhido}
              directory={directory}
              presenceFor={presenceFor}
              emChamada={emChamada}
              onEscolher={escolherMencao}
              onApontar={setEscolhido}
            />
          )}
          {/* The commands, on the same card as mentions and with the same classes:
              the same list, with something else inside it. */}
          {aSugerirComando && (
            <ul className="mention-picker comandos-da-barra" role="listbox" aria-label={strings.barra.lista}>
              {comandos.map((comando, indice) => (
                <li key={comando.nome}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={indice === comandoEscolhido}
                    className={indice === comandoEscolhido ? "mention-option escolhido" : "mention-option"}
                    // `mousedown` not `click`: `click` comes after the
                    // box loses focus, and the cursor would land outside it.
                    onMouseDown={(event) => {
                      event.preventDefault()
                      escolherComando(comando)
                    }}
                    onMouseEnter={() => setComandoEscolhido(indice)}
                  >
                    <span className="mention-name">/{comando.nome}</span>
                    <span className="mention-name field-note">{strings.barra.descricao[comando.nome]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* An icon instead of words: the text box is narrow, and the
              accessible label says what the drawing cannot fit in.
              IT IS THE SAME ICON AS THE FEED, at the same size. Adding an
              image is the same gesture on both sides of the app; two
              nearly identical drawings for the same gesture make the user stop and compare them,
              hunting for a difference that does not exist. */}
          {/*
            The two file input fields, hidden and triggered by reference.

            They used to be inside visible `<label>` tags, which is the simplest way to
            open them. They no longer fit: at 390px the line had four buttons
            plus the text box and busted. Now the `+` menu opens them, and a menu
            item cannot be a `<label>`, so we use `.click()`
            on the reference, which does exactly what clicking the label does.

            They stay in the form and not inside the menu on purpose: a menu that
            dismounts when closed would take the field with it, and `change`
            would arrive at an element that no longer exists.
          */}
          <input
            ref={campoImagens}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            hidden
            disabled={offline || ocupada || avisoDeContaNova !== undefined}
            onChange={(event) => {
              escolherImagens([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />
          {/* The attachment button, next to the photo icon, and in the right order:
              the image is the everyday gesture and goes first.

              NO `accept`: any file works, and a list of types here
              only hid legitimate formats behind an "all files"
              the user had to discover. What decides is not the type, it is the
              size, and that is checked properly in `escolherFicheiros`.

              The label shows the absolute limit. With the message already carrying things
              the real number is smaller, and rejection is what says it, but someone
              who hovers here before choosing deserves to know the
              order of magnitude without having to try. */}
          <input
            ref={campoFicheiros}
            type="file"
            multiple
            hidden
            disabled={offline || ocupada || avisoDeContaNova !== undefined}
            onChange={(event) => {
              void escolherFicheiros([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />

          {/*
            The `+`, which brings together the three gestures that are not typing.

            At 390px the line had emoji, image, attachment, send and the box,
            and it busted. Of the three layouts tested, this one was chosen:
            the box stays wide and the two buttons used
            all the time stay out, and what is rarer moves to a click away.

            The menu is the standard `ContextMenu`, not a new design: it brings
            positioning, `Escape`, close on capture and arrow keys. Anchored
            to the top of the button, which is where `ContextMenu` counts from,
            see what that already cost on the account card.
          */}
          <button
            ref={botaoMais}
            type="button"
            className="composer-attach"
            disabled={ocupada}
            title={offline ? strings.connection.anexosOffline : strings.chat.moreActions}
            aria-label={strings.chat.moreActions}
            aria-expanded={maisAberto !== null}
            onClick={() => {
              if (offline) {
                setPediuAnexoOffline(true)
                return
              }
              const caixa = botaoMais.current?.getBoundingClientRect()
              if (!caixa) return
              setMaisAberto({ x: caixa.left, y: caixa.top })
            }}
          >
            <PlusIcon size={17} />
          </button>
          <textarea
            ref={field}
            rows={1}
            value={value}
            disabled={parado}
            placeholder={
              parado
                ? strings.connection.separadorParado
                : offline
                  ? strings.connection.composerEspera
                  : strings.chat.composerPlaceholder
            }
            role={aSugerir || aSugerirComando ? "combobox" : undefined}
            aria-expanded={aSugerir || aSugerirComando}
            aria-autocomplete="list"
            onChange={(event) => {
              onChange(event.target.value)
              reavaliarMencao(event.target.value, event.target.selectionStart ?? event.target.value.length)
              setComandoEscolhido(0)
              setNota(null)
              // Outside a command, the dismissed list can come back next time.
              if (!event.target.value.startsWith("/")) setComandosDispensados(false)
              // Never offline: a signal that cannot go out is not worth the error.
              if (!offline) onTyping?.()
            }}
            // The cursor moved with arrows or mouse also changes which mention
            // is current: without this, moving back to fix a name already
            // typed would not reopen any suggestion.
            onSelect={(event) => {
              const node = event.currentTarget
              if (!aSugerir) reavaliarMencao(node.value, node.selectionStart ?? node.value.length)
            }}
            onPaste={colar}
            onFocus={() => {
              tocada.current = true
            }}
            onKeyDown={(event) => {
              teclarNaCaixa(event)
              enviarComEnter(event)
            }}
            autoComplete="off"
          />
          {/* The formatting bar over a selection, right after the box so Tab
              reaches it. Not with a finger: the system has its own menu there. */}
          {!comDedo() && <BarraDeFormatacao campo={field} valor={value} aplicar={aplicarFormatacao} />}
          {/* A drawn face, not a `🙂`. See `SmileyIcon`: the emoji came
              from the system font, with its own metrics and color, and that is why
              it was misaligned next to the others in this row. */}
          <button
            type="button"
            className="composer-emoji"
            title={strings.emoji.open}
            aria-label={strings.emoji.open}
            aria-expanded={picking}
            onClick={() => setPicking(true)}
          >
            <SmileyIcon size={17} />
          </button>
          {/*
            The nudge with its own button and icon (12/11/2026: "an
            icon of its own for the nudge, only for private messages"). Only where
            `onBuzz` arrives, and it only arrives in a direct conversation. On a
            narrow screen the button hides (`screens.css`): the 390 px line is the
            choice of 12/08/2026. Since 20/11/2026 the "+" menu has no nudge.
          */}
          {onBuzz && MOSTRAR_COTOVELADA && <BuzzButton onBuzz={onBuzz} cooldown={buzzCooldown} />}
          {/* The counter, only near the limit: from 1800 it shows how many are left,
              and turns red when it goes over. See `MENSAGEM_MAX_CARACTERES`. */}
          {value.length >= CONTADOR_A_PARTIR_DE && (
            <span
              className={value.length > MENSAGEM_MAX_CARACTERES ? "composer-contador passou" : "composer-contador"}
              aria-live="polite"
            >
              {MENSAGEM_MAX_CARACTERES - value.length}
            </span>
          )}
          {/* On the phone the button drops its word and keeps the plane, so the
              text box gets the room (1.3.6). The word stays in the DOM, the
              `.sr-only` way: it is the button's name. See `.composer-enviar`. */}
          <Button
            type="submit"
            variant="primary"
            className="composer-enviar"
            disabled={parado || vazio || ocupada || anexosSemLigacao || value.trim().length > MENSAGEM_MAX_CARACTERES}
          >
            <EnviarIcon size={18} />
            <span className="composer-enviar-texto">{strings.chat.send}</span>
          </Button>
        </div>
        {rodape}
      </form>

      {/*
        Outside the <form>, like the emoji picker and for the same reason: the menu is
        made of buttons, and a button inside a form submits it.
      */}
      {maisAberto && (
        <ContextMenu
          at={maisAberto}
          onClose={() => setMaisAberto(null)}
          items={[
            { label: strings.chat.imageAdd, onSelect: () => campoImagens.current?.click() },
            {
              label: `${strings.chat.fileAdd} ${strings.common.maximo(formatarBytes(FICHEIRO_MAX_BYTES))}`,
              onSelect: () => campoFicheiros.current?.click(),
            },
            // The poll, next to the other two actions that are not writing.
            // It follows `onVotacao` by the same rule as the nudge: if the caller
            // does not provide it, the input does not appear.
            ...(onVotacao && MOSTRAR_VOTACOES ? [{ label: strings.votacao.criar, onSelect: onVotacao }] : []),
            // No nudge here (20/11/2026): it lives on the line only,
            // with its own button. See `BuzzButton`.
          ]}
        />
      )}
      {/* Outside the <form>: the picker is made of buttons, and a button inside a
          form submits it. There is no way to get it wrong here. */}
      {picking && <EmojiPicker onPick={insert} onClose={() => setPicking(false)} />}
    </>
  )
}

/** The fields with a value: an `undefined` never covers a value from the other side. */
function soDefinidos<T extends object>(objecto: T): Partial<T> {
  return Object.fromEntries(Object.entries(objecto).filter(([, valor]) => valor !== undefined)) as Partial<T>
}
