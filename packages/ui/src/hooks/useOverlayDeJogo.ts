import { useEffect, useRef } from "react"
import type { EnclaveBridge, ResumoParaAOverlay } from "../bridge.js"
import { vemDoEndereco } from "../lib/format.js"

/**
 * The game overlay, from the shell side: what it shows, and who speaks.
 *
 * Proposal 4 from
 * `~/Downloads/Orwell-overlays-jogo/`. The overlay is another window, drawn
 * by the main process (`apps/client/src/main/overlay-janela.ts`); here we send
 * the bare minimum it needs, and only when it changes:
 *
 *  - room name and per person: name, whether speaking, whether muted;
 *  - faces, shrunk to 64 px and cropped, once per person;
 *  - preferences (on, opacity) and warning text, in the shell language.
 *
 * No keys, no messages, no addresses. In browser `ponte` does not exist and
 * this does nothing.
 *
 * Speaking identities come from the same call sampler as the in-app indicators.
 */

/** The cropped face side, in pixels. */
const LADO_DA_CARA = 64

export interface PessoaParaAOverlay {
  id: string
  nome: string
  /** The side profile face, as a data URL, or nothing. */
  cara?: string | undefined
  micCalado: boolean
}

/** The summary, assembled. Pure: order is our face first, then the room. */
export function montarResumo(opcoes: {
  sala: string
  entrada: number
  eu: { id: string; nome: string }
  outros: readonly PessoaParaAOverlay[]
  falam: ReadonlySet<string>
  micMuted: boolean
  soundOff: boolean
}): ResumoParaAOverlay {
  const euCalado = opcoes.micMuted || opcoes.soundOff
  return {
    sala: opcoes.sala,
    entrada: opcoes.entrada,
    pessoas: [
      {
        id: opcoes.eu.id,
        nome: opcoes.eu.nome,
        aFalar: !euCalado && opcoes.falam.has(opcoes.eu.id),
        micCalado: euCalado,
        somDesligado: opcoes.soundOff,
        ...(vemDoEndereco(opcoes.eu.nome, opcoes.eu.id) ? { doEndereco: true } : {}),
      },
      ...opcoes.outros
        .filter((pessoa) => pessoa.id !== opcoes.eu.id)
        .map((pessoa) => ({
          id: pessoa.id,
          nome: pessoa.nome,
          aFalar: !pessoa.micCalado && opcoes.falam.has(pessoa.id),
          micCalado: pessoa.micCalado,
          somDesligado: false,
          // The id is the address: remove if the name is theirs.
          ...(vemDoEndereco(pessoa.nome, pessoa.id) ? { doEndereco: true } : {}),
        })),
    ],
  }
}

/** The face shrunk to 64 px, or `null` when not possible (no canvas, broken image). */
export function reduzirCara(cara: string): Promise<string | null> {
  return new Promise((resolver) => {
    if (typeof Image === "undefined" || typeof document === "undefined") return resolver(null)
    const imagem = new Image()
    imagem.onload = () => {
      try {
        const tela = document.createElement("canvas")
        tela.width = LADO_DA_CARA
        tela.height = LADO_DA_CARA
        const ctx = tela.getContext("2d")
        if (!ctx) return resolver(null)
        // Cropped at the center, as the round face of the pill shows it.
        const lado = Math.min(imagem.naturalWidth, imagem.naturalHeight)
        const sx = (imagem.naturalWidth - lado) / 2
        const sy = (imagem.naturalHeight - lado) / 2
        ctx.drawImage(imagem, sx, sy, lado, lado, 0, 0, LADO_DA_CARA, LADO_DA_CARA)
        const webp = tela.toDataURL("image/webp", 0.82)
        resolver(webp.startsWith("data:image/webp") ? webp : tela.toDataURL("image/png"))
      } catch {
        resolver(null)
      }
    }
    imagem.onerror = () => resolver(null)
    imagem.src = cara
  })
}

export function useOverlayDeJogo(opcoes: {
  ponte: EnclaveBridge["overlay"]
  /** The voice room we are in, or `null` outside a call. The key tells rooms with the same name apart. */
  sala: { chave: string; nome: string } | null
  eu: { id: string; nome: string; cara?: string | undefined }
  outros: readonly PessoaParaAOverlay[]
  micMuted: boolean
  soundOff: boolean
  falam: ReadonlySet<string>
  ligada: boolean
  opacidade: number
  textos: { entrou: string; saiu: string }
  /** For tests: the face shrinking. */
  reduzir?: (cara: string) => Promise<string | null>
}): void {
  const { ponte, sala, eu, outros, ligada, falam } = opcoes
  const activo = ponte !== undefined && ligada && sala !== null

  // Preferences, whenever they change: the main process holds them and decides.
  const { opacidade } = opcoes
  const { entrou, saiu } = opcoes.textos
  useEffect(() => {
    ponte?.preferencias({ ligada, opacidade, textos: { entrou, saiu } })
  }, [ponte, ligada, opacidade, entrou, saiu])

  // A new entry for each room: the main process and shell do not notify about who was already there.
  const entradas = useRef({ chave: null as string | null, numero: 0 })
  if (sala && sala.chave !== entradas.current.chave) {
    entradas.current = { chave: sala.chave, numero: entradas.current.numero + 1 }
  } else if (!sala) {
    entradas.current = { ...entradas.current, chave: null }
  }
  const entrada = entradas.current.numero

  // The summary, only when it changes.
  const resumo = activo && sala
    ? montarResumo({ sala: sala.nome, entrada, eu, outros, falam, micMuted: opcoes.micMuted, soundOff: opcoes.soundOff })
    : null
  const texto = resumo ? JSON.stringify(resumo) : null
  const enviado = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!ponte) return
    if (texto === enviado.current) return
    // Outside a room, only once, and only if we said before we were in one.
    if (texto === null && enviado.current === undefined) return
    enviado.current = texto
    ponte.estado(texto === null ? null : (JSON.parse(texto) as ResumoParaAOverlay))
  }, [ponte, texto])

  // On unmount (closing the session mid-call), the overlay hides.
  useEffect(
    () => () => {
      if (ponte && enviado.current) ponte.estado(null)
    },
    [ponte],
  )

  // The faces: shrunk once per person and per image, and sent separately.
  const reduzir = opcoes.reduzir ?? reduzirCara
  const carasFeitas = useRef(new Map<string, string>())
  const chaveDasCaras = activo
    ? [eu, ...outros].map((pessoa) => `${pessoa.id}=${pessoa.cara?.length ?? 0}:${pessoa.cara?.slice(-24) ?? ""}`).join("|")
    : ""
  useEffect(() => {
    if (!ponte || !activo) return
    const pessoas = [eu, ...outros]
    for (const pessoa of pessoas) {
      const fonte = pessoa.cara ?? ""
      if (carasFeitas.current.get(pessoa.id) === fonte) continue
      carasFeitas.current.set(pessoa.id, fonte)
      if (!fonte) {
        ponte.caras({ [pessoa.id]: null })
        continue
      }
      void reduzir(fonte).then((reduzida) => {
        // Only if the face is still this one: a swap mid-shrink sends the new one.
        if (carasFeitas.current.get(pessoa.id) === fonte) ponte.caras({ [pessoa.id]: reduzida })
      })
    }
    // The key says when the faces changed: `eu` and `outros` are new objects each render.
  }, [ponte, activo, chaveDasCaras, reduzir])
}
