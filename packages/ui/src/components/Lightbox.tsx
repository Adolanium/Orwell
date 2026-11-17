import { useContext, useId } from "react"
import type { MediaItem } from "../types.js"
import { Modal } from "./Modal.js"
import { BridgeContext } from "../App.js"
import { MediaLazy } from "./MediaLazy.js"
import { ToastContext } from "./Toast.js"
import { CopyIcon, DownloadIcon, LinkIcon } from "../icons.js"
import { nomeSeguro } from "../lib/ficheiros.js"
import { copiarImagemComAviso, guardarMediaComAviso } from "../lib/copiarMedia.js"
import { copiarTexto } from "../lib/copiar.js"
import { strings } from "../strings.js"

/**
 * A large image over everything else.
 *
 * It was written by hand inside `Social`, and the conversation did not have it, chat
 * images just drew themselves because `PostImages` only makes them a button when given an
 * `onOpen` and `Timeline` called it without one. Extracted here instead of copied there:
 * two identical sheets diverged at the first fix, and the next fix only landed in one.
 *
 * The bytes come from inside the encrypted message and are the same ones that were already
 * on the grid. Nothing here fetches anything from anywhere else, and that includes the three
 * buttons below the picture: copy, download, and the link of the message (which is built, not fetched).
 */
export function Lightbox({
  item,
  onClose,
  ligacao,
}: {
  item: MediaItem
  onClose: () => void
  /** The link of the message this image came from, when the host can build one. */
  ligacao?: string | null | undefined
}): React.JSX.Element {
  const titulo = useId()
  // The direct context, not `useToast`: the feed sheet has no provider and still opens.
  const aviso = useContext(ToastContext)
  // An item kept by reference has its bytes in this device's media store, not in the message.
  const ler = useContext(BridgeContext)?.media?.bytes
  // The name is from the sender. It serves as a label here, but goes through the same
  // treatment as everything else, a name with direction marks would reorder the screen
  // reader line just as it reorders the chat one.
  const nome = item.name ? nomeSeguro(item.name) : strings.social.imageFallbackName
  return (
    <Modal className="lightbox" labelledBy={titulo} onClose={onClose}>
      <h2 id={titulo} className="sr-only">
        {nome}
      </h2>
      {/* In the media store: the original, asked for now, with the thumbnail and "Fetch" if it is missing. */}
      {item.ref ? <MediaLazy item={{ ...item, name: item.name ? nome : "" }} eager /> : <img src={item.inline ?? item.url} alt={item.name ? nome : ""} />}
      <button
        type="button"
        className="lightbox-close"
        title={strings.common.close}
        aria-label={strings.common.close}
        onClick={onClose}
      >
        ×
      </button>
      {/* Below the picture, never over it: the image is what the person came to see. */}
      <div className="lightbox-accoes">
        <button type="button" onClick={() => void copiarImagemComAviso(item, aviso, ler)}>
          <CopyIcon size={15} />
          {strings.media.copiarImagem}
        </button>
        <button type="button" onClick={() => void guardarMediaComAviso(item, aviso, ler)}>
          <DownloadIcon size={15} />
          {strings.media.descarregar}
        </button>
        {ligacao && (
          <button
            type="button"
            onClick={() =>
              void copiarTexto(ligacao)
                .then(() => aviso?.(strings.media.ligacaoCopiada))
                .catch(() => aviso?.(strings.common.copyFailed, "error"))
            }
          >
            <LinkIcon size={15} />
            {strings.media.copiarLigacao}
          </button>
        )}
      </div>
    </Modal>
  )
}
