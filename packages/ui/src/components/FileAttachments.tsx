import { useContext, useEffect, useState } from "react"
import { BridgeContext } from "../App.js"
import type { MediaItem } from "../types.js"
import { DownloadIcon } from "../icons.js"
import { descarregar, descarregarBytes, eImagem, extensaoDe, formatarBytes, nomeSeguro, pesoDeDataUrl } from "../lib/ficheiros.js"
import { strings } from "../strings.js"
import { ToastContext } from "./Toast.js"
import { FicheiroAPedido } from "./AnexoAPedido.js"
import { BotaoTrazer } from "./MediaLazy.js"
import { eVideo } from "./VideoDaPublicacao.js"

/**
 * Attachments that are NOT images: PDFs, zips, anything.
 *
 * **Nothing here opens anything.** No embedded PDF reader, no preview, no
 * `iframe`. One line with the name, what it is, and how much it weighs, plus
 * a button that saves the bytes to disk. A file that opened by itself inside
 * an encrypted product would be the gate that everything else in the product
 * spends its time closing, and what decided to open it was `mediaType`, a
 * string the sender writes by hand.
 *
 * **Say what it is before you tap**, which is the other half of the same rule:
 * the reader decides with the name, extension, and size in front of their eyes,
 * not after the file is already on disk.
 */
export function FileAttachments({ files }: { files: MediaItem[] }): React.JSX.Element | null {
  /**
   * The direct context, not `useToast`, which throws when there is no provider.
   *
   * This list renders inside `PostBody`, which is used in places without a
   * notification provider, the profile sheet, for example. A sheet component
   * cannot require context just to draw a line of text: the notification is
   * extra, and where it does not exist the download happens anyway, silently,
   * which is the normal browser behavior.
   */
  const toast = useContext(ToastContext)
  if (files.length === 0) return null

  return (
    <ul className="file-attachments">
      {files.map((item, index) => {
        // The name is from the sender, treated as such: no path, no marks that reverse
        // text direction, cut to length. See `nomeSeguro`.
        const nome = nomeSeguro(item.name)
        const extensao = extensaoDe(nome)
        // In the media store (Task 10): the bytes are asked for when the button is pressed.
        if (item.ref && !item.evicted) return <FicheiroDoArmazem key={index} item={item} nome={nome} extensao={extensao} />
        const bytesUrl = item.inline ?? item.url ?? ""

        /**
         * The bytes we have here, not the ones the sender claimed to send.
         *
         * The attachment's `byteLength` is metadata like the name: it travels encrypted and
         * is still just a claim. What we hold is a fact, and that fact matters to whoever
         * saves the file.
         */
        const bytes = pesoDeDataUrl(bytesUrl)

        /**
         * Dumped from the vault: the name and type survived, the bytes did not.
         *
         * The `evicted` marker comes from an old sibling or from a version 2
         * vault (the version 3 vault no longer evicts: see `EvictedMedia`). A
         * document like that degrades with the whole row saying what it was
         * and a status instead of a button. A button that downloaded nothing
         * would be worse than no button.
         */
        if (item.evicted || bytesUrl === "") {
          return (
            <li key={index} className="file-attachment gone">
              <span className="file-mark" aria-hidden="true">
                {extensao || "?"}
              </span>
              <span className="file-text">
                {/* `<bdi>` isolates the name: a name in Arabic or Hebrew cannot reorder what
                    surrounds it on this line. Explicit direction marks already left in
                    `nomeSeguro`; this handles the IMPLICIT direction of the letters,
                    which cannot be erased. */}
                <bdi className="file-name">{nome}</bdi>
                <span className="file-meta">{strings.media.ficheiroNoutroAparelho}</span>
              </span>
              {/* Fetch the bytes from other members (S5), if this list knows which message they belong to. */}
              {item.evicted && <FicheiroAPedido item={item} nome={nome} />}
            </li>
          )
        }

        return (
          <li key={index} className="file-attachment">
            <span className="file-mark" aria-hidden="true">
              {extensao || "?"}
            </span>
            <span className="file-text">
              <bdi className="file-name">{nome}</bdi>
              <span className="file-meta">{formatarBytes(bytes)}</span>
            </span>
            <button
              type="button"
              className="file-get"
              title={strings.chat.fileDownload}
              aria-label={strings.chat.fileDownloadOf(nome)}
              onClick={() => {
                try {
                  descarregar(bytesUrl, nome)
                } catch {
                  // Unreadable bytes are a broken attachment, not an app failure.
                  // Saying so is better than a button that does nothing.
                  toast?.(strings.chat.fileBroken, "error")
                }
              }}
            >
              <DownloadIcon size={15} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A file whose bytes are in the media store (Task 10). The row says the name
 * and the weight from the reference; the button asks for the bytes and saves
 * them. If the store does not have them (they left through the ceiling, or
 * never arrived), the row says "Ficheiro guardado noutro aparelho." and offers
 * "Fetch".
 */
function FicheiroDoArmazem({ item, nome, extensao }: { item: MediaItem; nome: string; extensao: string }): React.JSX.Element {
  const bridge = useContext(BridgeContext)
  const toast = useContext(ToastContext)
  const [emFalta, setEmFalta] = useState(item.falta === true || !bridge?.media)
  // Fetched ("chegou"), or stored just now: the save button comes back.
  useEffect(
    () =>
      bridge?.on?.media?.((evento) => {
        if (evento.sha === item.ref && (evento.estado === "chegou" || evento.estado === "guardado")) setEmFalta(false)
      }),
    [bridge, item.ref],
  )
  const gravar = async (): Promise<void> => {
    const bytes = await bridge?.media?.bytes(item.ref!).catch(() => null)
    if (!bytes) {
      setEmFalta(true)
      return
    }
    try {
      descarregarBytes(bytes, nome)
    } catch {
      toast?.(strings.chat.fileBroken, "error")
    }
  }
  return (
    <li className={emFalta ? "file-attachment gone" : "file-attachment"}>
      <span className="file-mark" aria-hidden="true">
        {extensao || "?"}
      </span>
      <span className="file-text">
        <bdi className="file-name">{nome}</bdi>
        <span className="file-meta">{emFalta ? strings.media.ficheiroNoutroAparelho : formatarBytes(item.b ?? item.byteLength ?? 0)}</span>
      </span>
      {emFalta ? (
        <BotaoTrazer item={item} />
      ) : (
        <button
          type="button"
          className="file-get"
          title={strings.chat.fileDownload}
          aria-label={strings.chat.fileDownloadOf(nome)}
          onClick={() => void gravar()}
        >
          <DownloadIcon size={15} />
        </button>
      )}
    </li>
  )
}

/**
 * Separar os anexos de uma mensagem ou publicação em imagens e ficheiros.
 *
 * The decision itself is in `eImagem`, with the reason spelled out, in short: by
 * `mediaType`, never by `kind`, because dumping from the vault discards `kind`. It lives
 * there so `postKindOf` can use it without importing a component.
 */
export function separarAnexos(anexos: MediaItem[]): { imagens: MediaItem[]; ficheiros: MediaItem[] } {
  const imagens: MediaItem[] = []
  const ficheiros: MediaItem[] = []
  for (const item of anexos) {
    // A video in parts goes with images: it draws on the same grid and in the same carousel.
    if (eImagem(item) || eVideo(item)) imagens.push(item)
    else ficheiros.push(item)
  }
  return { imagens, ficheiros }
}
