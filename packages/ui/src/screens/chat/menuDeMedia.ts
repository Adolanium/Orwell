import type { ChatMessage, MediaItem } from "../../types.js"
import { eImagem, nomeSeguro } from "../../lib/ficheiros.js"
import { copiarImagemComAviso, guardarMediaComAviso, temBytes, type LerDoArmazem } from "../../lib/copiarMedia.js"
import { copiarTexto } from "../../lib/copiar.js"
import { strings } from "../../strings.js"
import type { MenuItem } from "../overlays/ContextMenu.js"

/**
 * The media entries of a message menu: copy image, download, copy message link.
 *
 * Pure and apart from the screen, like the other menus: what the message cannot
 * do does not appear. A picture or file whose bytes were evicted from the vault
 * has no entry (a button that saves nothing is worse than none), and a video
 * (which lives in parts, not in one set of bytes) has none either.
 *
 * Labels are short when there is one thing to act on ("Download") and name the
 * thing when there are several ("Download image 2", "Download plan.pdf").
 */
export function itensDeMedia(ctx: {
  message: ChatMessage
  /** The link of this message, or `null` when the host cannot build one. */
  ligacao: string | null
  aviso: ((texto: string, nivel?: "info" | "error") => void) | null
  /** True when the menu already has an entry above (the text copy), so a separator opens this block. */
  haItensAntes: boolean
  /** The media store, for items kept by reference. Without it, only inline bytes count. */
  ler?: LerDoArmazem | undefined
}): MenuItem[] {
  const { ler } = ctx
  const anexos = (ctx.message.payload.attachments ?? []).filter((item) => temBytes(item, ler))
  const imagens = anexos.filter((item) => eImagem(item) && !item.partes)
  const ficheiros = anexos.filter((item) => !eImagem(item) && !item.partes)
  if (imagens.length + ficheiros.length === 0) return []

  const itens: MenuItem[] = []
  const acrescentar = (item: Omit<MenuItem, "separatorBefore">): void => {
    itens.push(itens.length === 0 && ctx.haItensAntes ? { ...item, separatorBefore: true } : item)
  }

  imagens.forEach((imagem: MediaItem, indice) => {
    acrescentar({
      label: imagens.length === 1 ? strings.media.copiarImagem : strings.media.copiarImagemN(indice + 1),
      onSelect: () => void copiarImagemComAviso(imagem, ctx.aviso, ler),
    })
  })
  const total = imagens.length + ficheiros.length
  imagens.forEach((imagem, indice) => {
    acrescentar({
      label: total === 1 ? strings.media.descarregar : strings.media.descarregarN(indice + 1),
      onSelect: () => void guardarMediaComAviso(imagem, ctx.aviso, ler),
    })
  })
  for (const ficheiro of ficheiros) {
    acrescentar({
      label: total === 1 ? strings.media.descarregar : strings.media.descarregarFicheiro(nomeSeguro(ficheiro.name)),
      onSelect: () => void guardarMediaComAviso(ficheiro, ctx.aviso, ler),
    })
  }
  const { ligacao } = ctx
  if (ligacao) {
    acrescentar({
      label: strings.media.copiarLigacao,
      onSelect: () =>
        void copiarTexto(ligacao)
          .then(() => ctx.aviso?.(strings.media.ligacaoCopiada))
          .catch(() => ctx.aviso?.(strings.common.copyFailed, "error")),
    })
  }
  return itens
}

/** Does this message carry anything the media entries can act on? Part of "does this message have a menu". */
export function temMedia(message: ChatMessage, ler?: LerDoArmazem): boolean {
  return (message.payload.attachments ?? []).some((item) => temBytes(item, ler) && !item.partes)
}
