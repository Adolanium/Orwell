import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { AvisosDoCarril, classeDoBotaoDoCarril, descricaoDoCarril } from "./AvisosDoCarril.js"
import { strings } from "../strings.js"

afterEach(cleanup)

/**
 * The notices on one rail button (option A, 20/11/2026), drawn alone.
 *
 * Each notice has its own SHAPE, not only its own colour: unread is a pill
 * with no number, a mention is a number, a nudge is a glyph, a call is a
 * green seal. Someone who does not see colour still tells them apart.
 */
function botao(props: Parameters<typeof AvisosDoCarril>[0], activo = false): HTMLElement {
  render(
    <button
      className={classeDoBotaoDoCarril({ activo, toque: props.toque !== undefined })}
      aria-label="Amigos"
      aria-describedby={descricaoDoCarril(props)}
    >
      <AvisosDoCarril {...props} />
    </button>,
  )
  return screen.getByRole("button", { name: "Amigos" })
}

describe("AvisosDoCarril — o que se desenha", () => {
  it("sem nada, não desenha nada nem se descreve", () => {
    const b = botao({ id: "x", quantas: 0 })
    expect(b.querySelector(".rail-pill, .rail-count, .rail-toque, .rail-chamada")).toBeNull()
    expect(b.getAttribute("aria-describedby")).toBeNull()
  })

  it("por ler sem número: a pílula, e nada mais", () => {
    const b = botao({ id: "x", quantas: 0, porLer: true })
    expect(b.querySelector(".rail-pill")).not.toBeNull()
    expect(b.querySelector(".rail-count")).toBeNull()
  })

  it("com número: a pastilha com o número, e a pílula sai", () => {
    const b = botao({ id: "x", quantas: 3, porLer: true })
    expect(b.querySelector(".rail-count")?.textContent).toBe("3")
    expect(b.querySelector(".rail-pill")).toBeNull()
  })

  it("acima de nove, a pastilha diz 9+", () => {
    const b = botao({ id: "x", quantas: 14 })
    expect(b.querySelector(".rail-count")?.textContent).toBe("9+")
  })

  it("o destino aberto não leva pílula", () => {
    const b = botao({ id: "x", quantas: 0, porLer: true, activo: true }, true)
    expect(b.querySelector(".rail-pill")).toBeNull()
  })

  it("toque: contorno no botão e a pastilha com o glifo em vez do número", () => {
    const b = botao({ id: "x", quantas: 1, toque: strings.rail.cotoveladaPorVer("Carla") })
    expect(b.classList.contains("tocado")).toBe(true)
    expect(b.querySelector(".rail-toque svg")).not.toBeNull()
    expect(b.querySelector(".rail-count")).toBeNull()
  })

  it("chamada: o selo verde, ao lado do número", () => {
    const b = botao({ id: "x", quantas: 2, chamada: true })
    expect(b.querySelector(".rail-chamada svg")).not.toBeNull()
    expect(b.querySelector(".rail-count")?.textContent).toBe("2")
  })

  it("os desenhos não se lêem: quem ouve tem as palavras", () => {
    const b = botao({ id: "x", quantas: 2, toque: strings.rail.cotoveladaPorVer("Carla"), chamada: true })
    for (const desenho of b.querySelectorAll(".rail-pill, .rail-count, .rail-toque, .rail-chamada")) {
      expect(desenho.getAttribute("aria-hidden")).toBe("true")
    }
  })
})

describe("AvisosDoCarril — o que se diz a quem não vê o ecrã", () => {
  it("o número inteiro, mesmo quando o desenho diz 9+", () => {
    botao({ id: "x", quantas: 14 })
    expect(screen.getByRole("button", { name: "Amigos", description: strings.rail.porAtender(14) })).toBeTruthy()
  })

  it("por ler, toque e chamada, cada um com a sua frase", () => {
    botao({ id: "x", quantas: 0, porLer: true, toque: strings.rail.cotoveladaPorVer("Carla"), chamada: true })
    const b = screen.getByRole("button", { name: "Amigos" })
    const descricao = document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? ""
    // One source for the nudge's words: the sentence that names the sender.
    expect(descricao).toContain("Carla deu-te uma cotovelada.")
    expect(descricao).toContain(strings.rail.chamada)
  })
})
