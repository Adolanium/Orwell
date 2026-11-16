import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge } from "../bridge.js"
import { strings } from "../strings.js"
import { PostImages } from "./PostImages.js"

afterEach(cleanup)

describe("PostImages", () => {
  it("media com bytes rende como imagem", () => {
    render(<PostImages media={[{ inline: "data:image/png;base64,AAAA", name: "foto.png", mediaType: "image/png" }]} />)
    expect(screen.getByAltText("foto.png")).toBeTruthy()
    expect(screen.queryByText(strings.media.noutroAparelho)).toBeNull()
  })

  it("media evicted rende o placeholder honesto, não uma imagem partida", () => {
    render(<PostImages media={[{ evicted: true, name: "foto.png", mediaType: "image/png" }]} />)
    expect(screen.getByText(strings.media.noutroAparelho)).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
  })

  it("mistura: a imagem viva fica, a antiga vira placeholder", () => {
    render(
      <PostImages
        media={[
          { inline: "data:image/png;base64,AAAA", name: "nova.png", mediaType: "image/png" },
          { evicted: true, name: "antiga.png", mediaType: "image/png" },
        ]}
      />,
    )
    expect(screen.getByAltText("nova.png")).toBeTruthy()
    expect(screen.getByText(strings.media.noutroAparelho)).toBeTruthy()
  })

  it("media no armazém (ref): a caixa reservada com w e h, sem imagem partida e sem a frase do aparelho antigo", () => {
    // A store that has not answered yet: the image is loading.
    const bridge = { media: { bytes: () => new Promise(() => {}), fixar: async () => {}, soltar: async () => {} }, on: {} } as unknown as EnclaveBridge
    const { container } = render(
      <BridgeContext.Provider value={bridge}>
        <PostImages media={[{ ref: "sha-eira", name: "eira.png", mediaType: "image/png", w: 640, h: 480 }]} />
      </BridgeContext.Provider>,
    )
    const caixa = container.querySelector(".media-caixa")
    expect(caixa?.getAttribute("width")).toBe("640")
    expect(caixa?.getAttribute("height")).toBe("480")
    expect(document.querySelector("img:not([src])")).toBeNull()
  })

  it("sem media não rende nada", () => {
    const { container } = render(<PostImages media={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
