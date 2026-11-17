import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { VideoTile } from "./VideoTile.js"

/**
 * The tile of someone with the camera off shows their profile photo, like the
 * rest of the app, and the initial only when there is no photo (16/11/2026:
 * a person named "13" with a photo showed "1").
 */
afterEach(cleanup)
// jsdom has no media playback.
beforeAll(() => {
  HTMLMediaElement.prototype.play = () => Promise.resolve()
})

const FOTO = "data:image/png;base64,iVBORw0KGgo="

describe("o mosaico de quem tem a câmara desligada", () => {
  it("mostra a fotografia do perfil, e não a inicial", () => {
    const { container } = render(
      <VideoTile stream={null} muted={false} label="13" connected profile={{ displayName: "13", donations: [], avatarDataUrl: FOTO }} />,
    )
    expect(container.querySelector(".tile img")?.getAttribute("src")).toBe(FOTO)
    expect(container.querySelector(".tile-initial")).toBeNull()
  })

  it("sem fotografia, a inicial do nome", () => {
    const { container } = render(
      <VideoTile stream={null} muted={false} label="13" connected profile={{ displayName: "13", donations: [] }} />,
    )
    expect(container.querySelector(".tile-initial")?.textContent).toBe("1")
  })
})
