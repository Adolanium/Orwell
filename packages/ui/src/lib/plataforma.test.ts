import { describe, expect, it } from "vitest"
import { ehPwaDoIos } from "./plataforma.js"

/**
 * The installed web app on iPhone and iPad. iOS turns off its microphone when
 * the screen locks (WebKit bug 239602), and the call panel says so until there
 * is a native app.
 */
const IPHONE = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 }
const IPAD_COMO_MAC = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 }
const MAC = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 }
const ANDROID = { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", platform: "Linux armv8l", maxTouchPoints: 5 }

describe("a app instalada no iPhone", () => {
  it("é o iPhone ou o iPad com a app aberta a partir do ecrã principal", () => {
    expect(ehPwaDoIos({ ...IPHONE, standalone: true }, false)).toBe(true)
    expect(ehPwaDoIos(IPHONE, true)).toBe(true)
    expect(ehPwaDoIos({ ...IPAD_COMO_MAC, standalone: true }, true)).toBe(true)
  })

  it("não é o Safari no iPhone", () => {
    expect(ehPwaDoIos({ ...IPHONE, standalone: false }, false)).toBe(false)
  })

  it("não é a app instalada no Android nem no computador", () => {
    expect(ehPwaDoIos(ANDROID, true)).toBe(false)
    expect(ehPwaDoIos(MAC, true)).toBe(false)
  })

  it("sem navigator não é nada", () => {
    expect(ehPwaDoIos(undefined, true)).toBe(false)
  })
})
