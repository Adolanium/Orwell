import { describe, expect, it } from "vitest"
import { lerRolagens, reporRolagens } from "./rolagens.js"

describe("rolagens de um separador", () => {
  it("keeps the boxes that scrolled, and puts them back in a new copy of the same screen", () => {
    const antes = document.createElement("div")
    antes.innerHTML = '<div class="lista"></div><div class="lista"></div><p class="nota"></p>'
    const [primeira, segunda] = [...antes.querySelectorAll<HTMLElement>(".lista")]
    ;(segunda as HTMLElement).scrollTop = 340
    expect((primeira as HTMLElement).scrollTop).toBe(0)
    const lidas = lerRolagens(antes)
    expect([...lidas.values()]).toEqual([340])

    const depois = document.createElement("div")
    depois.innerHTML = '<div class="lista"></div><div class="lista"></div><p class="nota"></p>'
    reporRolagens(depois, lidas)
    expect(depois.querySelectorAll<HTMLElement>(".lista")[1]?.scrollTop).toBe(340)
    expect(depois.querySelectorAll<HTMLElement>(".lista")[0]?.scrollTop).toBe(0)
  })

  it("a box that is gone is left alone", () => {
    const depois = document.createElement("div")
    reporRolagens(depois, new Map([["lista#3", 80]]))
    expect(depois.children).toHaveLength(0)
  })
})
