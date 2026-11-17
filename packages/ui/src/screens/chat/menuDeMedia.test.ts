import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { itensDeMedia, temMedia } from "./menuDeMedia.js"

const PNG = "data:image/png;base64,iVBORw0KGgo="
const PDF = "data:application/pdf;base64,JVBERi0="

function mensagem(anexos: NonNullable<ChatMessage["payload"]["attachments"]>): ChatMessage {
  return { channel: "c", seq: 1, sender: "@a:s", payload: { t: "message", id: "m1", attachments: anexos } } as ChatMessage
}
const itens = (message: ChatMessage, ligacao: string | null = "https://x/app/m#m=c//m1", haItensAntes = false) =>
  itensDeMedia({ message, ligacao, aviso: null, haItensAntes }).map((item) => item.label)

describe("as entradas de media do menu da mensagem", () => {
  it("uma imagem: copiar imagem, descarregar e copiar a ligação", () => {
    expect(itens(mensagem([{ name: "a.png", mediaType: "image/png", inline: PNG }]))).toEqual([
      strings.media.copiarImagem,
      strings.media.descarregar,
      strings.media.copiarLigacao,
    ])
  })

  it("um ficheiro: só descarregar (e a ligação)", () => {
    expect(itens(mensagem([{ name: "p.pdf", mediaType: "application/pdf", inline: PDF }]))).toEqual([
      strings.media.descarregar,
      strings.media.copiarLigacao,
    ])
  })

  it("várias coisas: cada entrada diz qual, pelo número ou pelo nome", () => {
    const rotulos = itens(
      mensagem([
        { name: "a.png", mediaType: "image/png", inline: PNG },
        { name: "b.png", mediaType: "image/png", inline: PNG },
        { name: "p.pdf", mediaType: "application/pdf", inline: PDF },
      ]),
      null,
    )
    expect(rotulos).toEqual([
      strings.media.copiarImagemN(1),
      strings.media.copiarImagemN(2),
      strings.media.descarregarN(1),
      strings.media.descarregarN(2),
      strings.media.descarregarFicheiro("p.pdf"),
    ])
  })

  it("o que já não tem bytes não tem entradas, nem a mensagem tem menu só por isso", () => {
    const velha = mensagem([{ name: "a.png", mediaType: "image/png", evicted: true }])
    expect(itens(velha)).toEqual([])
    expect(temMedia(velha)).toBe(false)
    expect(temMedia(mensagem([{ name: "a.png", mediaType: "image/png", inline: PNG }]))).toBe(true)
  })

  it("abre o bloco com um separador quando já há texto copiável antes", () => {
    const com = itensDeMedia({
      message: mensagem([{ name: "a.png", mediaType: "image/png", inline: PNG }]),
      ligacao: null,
      aviso: null,
      haItensAntes: true,
    })
    expect(com[0]?.separatorBefore).toBe(true)
    expect(com[1]?.separatorBefore).toBeUndefined()
  })
})
