import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge, LinkCard } from "../bridge.js"
import type { MediaItem } from "../types.js"
import { LinkPreview } from "../screens/social/LinkPreview.js"
import { PostImages } from "./PostImages.js"

/**
 * The permanent thumbnails the vault keeps as `{ ref }` (design §3, Task 10):
 * the link card one and the video poster. They are asked from the store by
 * reference, and never reach a `src` as "[object Object]" (the YouTube
 * thumbnail bug in 1.1.0).
 */

afterEach(cleanup)

function ponte(sha: string) {
  const bytes = vi.fn(async (pedido: string) => (pedido === sha ? new Uint8Array([82, 73, 70, 70]) : null))
  const bridge = {
    media: { bytes, fixar: vi.fn(async () => {}), soltar: vi.fn(async () => {}) },
    video: { estado: vi.fn(async () => ({ fase: "pronto" })), bytes: vi.fn(async () => null) },
    on: {},
  } as unknown as EnclaveBridge
  return { bridge, bytes }
}

const semObjecto = (): void => {
  for (const img of document.querySelectorAll("img")) expect(img.getAttribute("src")).not.toContain("[object")
}

describe("miniaturas por referência", () => {
  it.each([
    ["um cartão de link", "https://exemplo.pt/artigo"],
    ["um vídeo do YouTube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ])("%s mostra a miniatura do armazém", async (_nome, url) => {
    const sha = `miniatura-${Math.random().toString(36).slice(2)}`
    const { bridge, bytes } = ponte(sha)
    const link = { url, title: "Título", thumbnail: { ref: sha } } as unknown as LinkCard
    const { container } = render(
      <BridgeContext.Provider value={bridge}>
        <LinkPreview link={link} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^(blob:|data:)/))
    expect(bytes).toHaveBeenCalledWith(sha)
    semObjecto()
  })

  it("o poster de um vídeo, guardado por referência, mostra-se depois de recarregar", async () => {
    const sha = `poster-${Math.random().toString(36).slice(2)}`
    const { bridge } = ponte(sha)
    const video = {
      name: "praia.mp4",
      mediaType: "video/mp4",
      duration: 12,
      byteLength: 3_000_000,
      poster: { ref: sha },
      partes: { n: 3, sha256: "A".repeat(43), bytes: 1_048_576 },
    } as unknown as MediaItem
    render(
      <BridgeContext.Provider value={bridge}>
        <PostImages media={[video]} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(document.querySelector(".video-tocar img")?.getAttribute("src")).toMatch(/^(blob:|data:)/))
    expect(document.querySelector(".video-sem-miniatura")).toBeNull()
    semObjecto()
  })
})
