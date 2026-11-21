import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import postcss, { type Declaration, type Rule } from "postcss"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearDiagnostics, diagnosticsSnapshot } from "../../lib/diagnostics.js"
import {
  aberturaDesmontou,
  aberturaMontou,
  esquecerAbertura,
  MINIMO_VISIVEL_MS,
  origemDaAbertura,
  SAIDA_MS,
  SAIDA_REDUZIDA_MS,
  VEIL_DEADLINE_MS,
} from "./abertura-viva.js"

/**
 * The opening from start to finish: the phase between mounts and the fade-out.
 *
 * jsdom has no Web Animations. Here each element gets the animations given to it, in the form the browser gives them (a `CSSAnimation` with name and `startTime`); what is tested is what the module does with them. Testing with the real browser, frame by frame, is in `scripts/abertura-prova.mjs`.
 */
class AnimacaoFalsa {
  constructor(
    readonly animationName: string,
    public startTime: number | null,
  ) {}
}

const animacoes = new WeakMap<Element, AnimacaoFalsa[]>()

function comAnimacoes(elemento: Element, ...lista: AnimacaoFalsa[]): Element {
  animacoes.set(elemento, lista)
  return elemento
}

function splash(): HTMLElement {
  const gate = document.createElement("div")
  gate.className = "gate"
  gate.innerHTML = '<div class="abertura"><span class="abertura-anel"></span><p class="abertura-texto">A abrir…</p></div>'
  return gate
}

let reduzido = false

beforeEach(() => {
  vi.useFakeTimers()
  reduzido = false
  vi.stubGlobal("CSSAnimation", AnimacaoFalsa)
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: reduzido && consulta.includes("reduce") }))
  // The animations of an element and its children, like `{ subtree: true }`.
  Element.prototype.getAnimations = function (this: Element) {
    return [this, ...this.querySelectorAll("*")].flatMap((e) => animacoes.get(e) ?? []) as unknown as Animation[]
  }
})

afterEach(() => {
  esquecerAbertura()
  clearDiagnostics()
  document.body.replaceChildren()
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The microtask in which the exit decides. */
const depoisDoCommit = (): Promise<void> => Promise.resolve()

describe("a fase da abertura", () => {
  it("herda o relógio do splash do index.html, e cada montagem entra nele", () => {
    const doHtml = splash()
    comAnimacoes(doHtml.querySelector(".abertura-anel")!, new AnimacaoFalsa("abertura-gira-vivo", 137))
    document.body.append(doHtml)
    expect(origemDaAbertura()).toBe(137)

    // React removes the one from the HTML and puts its own: new animations, starting now.
    doHtml.remove()
    const doReact = splash()
    const anel = new AnimacaoFalsa("abertura-gira-vivo", null)
    const tarja = new AnimacaoFalsa("abertura-tarja", null)
    comAnimacoes(doReact.querySelector(".abertura-anel")!, anel, tarja)
    document.body.append(doReact)
    aberturaMontou(doReact)
    expect(anel.startTime).toBe(137)
    expect(tarja.startTime).toBe(137)
  })

  it("com movimento reduzido também: a fase não depende de nenhuma regra da folha", () => {
    reduzido = true
    const doHtml = splash()
    comAnimacoes(doHtml.querySelector(".abertura-anel")!, new AnimacaoFalsa("abertura-pulsa", 90))
    document.body.append(doHtml)
    origemDaAbertura()
    doHtml.remove()

    const doReact = splash()
    const pulsa = new AnimacaoFalsa("abertura-pulsa", 2400)
    comAnimacoes(doReact, pulsa)
    aberturaMontou(doReact)
    expect(pulsa.startTime).toBe(90)
  })

  it("não toca nas animações que não são da abertura", () => {
    const outra = new AnimacaoFalsa("aurora", 5)
    const el = comAnimacoes(splash(), outra)
    aberturaMontou(el)
    expect(outra.startTime).toBe(5)
  })
})

describe("a saída da abertura", () => {
  it("um splash que dá lugar a outro no mesmo commit não sai", async () => {
    const primeiro = splash()
    aberturaMontou(primeiro)
    aberturaDesmontou(primeiro)
    aberturaMontou(splash())
    await depoisDoCommit()
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
  })

  it("o último fica por cima, segura até ao mínimo, esbate e sai", async () => {
    const ultimo = splash()
    document.body.append(ultimo)
    aberturaMontou(ultimo)
    ultimo.remove()
    aberturaDesmontou(ultimo)
    await depoisDoCommit()

    const veu = document.querySelector<HTMLElement>(".abertura-veu")
    expect(veu).not.toBeNull()
    expect(veu?.getAttribute("aria-hidden")).toBe("true")
    expect(veu?.inert).toBe(true)
    // The next screen waits hidden already.
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(true)

    vi.advanceTimersByTime(MINIMO_VISIVEL_MS - 50)
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(true)

    vi.advanceTimersByTime(50)
    expect(document.documentElement.classList.contains("abertura-a-sair")).toBe(true)
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(false)
    expect(document.documentElement.style.getPropertyValue("--abertura-saida")).toBe(`${SAIDA_MS}ms`)

    vi.advanceTimersByTime(SAIDA_MS)
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
    expect(document.documentElement.style.getPropertyValue("--abertura-saida")).toBe("")
  })

  it("com movimento reduzido esbate na mesma, mais devagar", async () => {
    reduzido = true
    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    vi.advanceTimersByTime(MINIMO_VISIVEL_MS)
    expect(document.documentElement.style.getPropertyValue("--abertura-saida")).toBe(`${SAIDA_REDUZIDA_MS}ms`)
    vi.advanceTimersByTime(SAIDA_MS)
    expect(document.querySelector(".abertura-veu")).not.toBeNull()
    vi.advanceTimersByTime(SAIDA_REDUZIDA_MS - SAIDA_MS)
    expect(document.querySelector(".abertura-veu")).toBeNull()
  })

  it("um splash que volta a meio da saída cancela-a, e entra no mesmo relógio", async () => {
    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    expect(document.querySelector(".abertura-veu")).not.toBeNull()

    const outraVez = splash()
    const anel = new AnimacaoFalsa("abertura-gira-vivo", null)
    comAnimacoes(outraVez, anel)
    aberturaMontou(outraVez)
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
    expect(anel.startTime).toBe(origemDaAbertura())
  })

  it("se a abertura já se viu o mínimo, esbate logo", async () => {
    // The opening started long ago: the splash from the HTML has been going since the first draw.
    const doHtml = splash()
    comAnimacoes(doHtml.querySelector(".abertura-anel")!, new AnimacaoFalsa("abertura-gira-vivo", performance.now() - 5_000))
    document.body.append(doHtml)
    origemDaAbertura()
    doHtml.remove()

    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    vi.advanceTimersByTime(0)
    expect(document.documentElement.classList.contains("abertura-a-sair")).toBe(true)
  })

  it("sem Web Animations (o jsdom dos outros testes) não deixa cópias no body", async () => {
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations
    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    expect(document.querySelector(".abertura-veu")).toBeNull()
  })
})

/** The exit copy going up, the way the last splash leaves. */
async function veilUp(): Promise<void> {
  const ultimo = splash()
  document.body.append(ultimo)
  aberturaMontou(ultimo)
  ultimo.remove()
  aberturaDesmontou(ultimo)
  await depoisDoCommit()
}

const veilLines = () => diagnosticsSnapshot().filter((linha) => linha.code === "opening-veil-long")

describe("a saída que não depende dos temporizadores (21/11/2026)", () => {
  it("o caminho normal não muda: sai pelos temporizadores e não escreve no registo", async () => {
    await veilUp()
    vi.advanceTimersByTime(MINIMO_VISIVEL_MS + SAIDA_MS)
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
    expect(veilLines()).toEqual([])
    // The listeners went with it: a page coming back later touches nothing.
    vi.setSystemTime(Date.now() + 60_000)
    document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new Event("focus"))
    expect(veilLines()).toEqual([])
  })

  it("com os temporizadores parados, a página que volta depois do prazo arruma a saída", async () => {
    await veilUp()
    // The tab froze: wall time runs, no timer fires.
    vi.setSystemTime(Date.now() + 10_000)
    expect(document.querySelector(".abertura-veu")).not.toBeNull()
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(true)

    document.dispatchEvent(new Event("visibilitychange"))
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
    expect(veilLines()).toHaveLength(1)
    expect(veilLines()[0]).toMatchObject({ outcome: "page-back" })
    expect(veilLines()[0]?.detail).toMatch(/^veil 10000 ms, hold 10000 ms, visible$/)
  })

  it.each(["pageshow", "focus"])("também ao %s", async (evento) => {
    await veilUp()
    vi.setSystemTime(Date.now() + 5_000)
    window.dispatchEvent(new Event(evento))
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(veilLines()).toHaveLength(1)
  })

  it("a página que volta antes do prazo deixa a saída normal seguir", async () => {
    await veilUp()
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(true)
    vi.advanceTimersByTime(MINIMO_VISIVEL_MS)
    expect(document.documentElement.classList.contains("abertura-a-sair")).toBe(true)
  })

  it("um separador escondido não arruma: espera ficar visível", async () => {
    await veilUp()
    vi.setSystemTime(Date.now() + 10_000)
    const visibilidade = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(document.querySelector(".abertura-veu")).not.toBeNull()
    visibilidade.mockReturnValue("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(document.querySelector(".abertura-veu")).toBeNull()
    visibilidade.mockRestore()
  })

  it("um temporizador que acorda depois do prazo do CSS arruma logo, sem esbater outra vez", async () => {
    await veilUp()
    // The first timer runs late, past the CSS deadline: the stylesheet already faded.
    vi.setSystemTime(Date.now() + VEIL_DEADLINE_MS + 1_000)
    vi.advanceTimersToNextTimer()
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.classList.contains("abertura-a-sair")).toBe(false)
    expect(veilLines()[0]).toMatchObject({ outcome: "late-timer" })
  })
})

/**
 * The CSS deadline itself. jsdom runs no CSS animations, so here the stylesheet is
 * read as text and the rules that decide are checked; the same thing measured in
 * real Chromium, Firefox and WebKit, with the timers frozen, is
 * `scripts/opening-veil-deadline-proof.mjs`.
 */
describe("o prazo do véu na folha (pele.css)", () => {
  const ESTILOS = join(dirname(fileURLToPath(import.meta.url)), "../../styles/")
  const folha = (nome: string) => postcss.parse(readFileSync(ESTILOS + nome, "utf8"))
  const emMovimentoReduzido = (regra: Rule) =>
    regra.parent?.type === "atrule" && /prefers-reduced-motion:\s*reduce/.test((regra.parent as { params: string }).params)
  function declaracoes(nome: string, seletor: string, reduzido: boolean): Declaration[] {
    const encontradas: Declaration[] = []
    folha(nome).walkRules((regra) => {
      if (regra.selectors.includes(seletor) && emMovimentoReduzido(regra) === reduzido)
        regra.walkDecls((d) => void encontradas.push(d))
    })
    return encontradas
  }
  const animacao = (nome: string, seletor: string) =>
    declaracoes(nome, seletor, false).find((d) => d.prop === "animation")?.value

  it("o véu e a app por baixo têm um fim próprio, em VEIL_DEADLINE_MS, com o esbatimento de SAIDA_MS", () => {
    expect(animacao("pele.css", ".abertura-veu")).toBe(`veil-deadline ${SAIDA_MS}ms ease-out ${VEIL_DEADLINE_MS / 1000}s both`)
    expect(animacao("pele.css", ".abertura-a-segurar body > :not(.abertura-veu)")).toBe(
      `veil-deadline ${SAIDA_MS}ms ease-out ${VEIL_DEADLINE_MS / 1000}s reverse both`,
    )
  })

  it("o nome não começa por abertura-: o acertarFase não lhe mexe no início", () => {
    expect(animacao("pele.css", ".abertura-veu")?.startsWith("abertura-")).toBe(false)
  })

  it("o véu não traz o fundo do .gate", () => {
    expect(declaracoes("pele.css", "body > .abertura-veu", false)).toEqual([
      expect.objectContaining({ prop: "background", value: "transparent" }),
    ])
  })

  it("com movimento reduzido o prazo esbate na mesma, mais devagar, e ganha às regras universais", () => {
    for (const seletor of [".abertura-a-segurar body > .abertura-veu", ".abertura-a-segurar body > :not(.abertura-veu)"]) {
      const duracao = declaracoes("pele.css", seletor, true).find((d) => d.prop === "animation-duration")
      expect(duracao?.value).toBe(`${SAIDA_REDUZIDA_MS}ms`)
      expect(duracao?.important).toBe(true)
    }
  })

  it("nenhuma regra de movimento reduzido corta o atraso de 3 s", () => {
    // The universal rules shorten durations only; no `!important` delay or
    // shorthand may reach the veil or the app under reduced motion, in any sheet.
    const tocam: string[] = []
    for (const nome of readdirSync(ESTILOS).filter((f) => f.endsWith(".css"))) {
      folha(nome).walkRules((regra) => {
        if (!emMovimentoReduzido(regra)) return
        regra.walkDecls((d) => {
          if (!d.important || (d.prop !== "animation-delay" && d.prop !== "animation")) return
          const universal = regra.selectors.some((s) => /(^|\s)\*/.test(s) || /\bbody\s*>/.test(s) || s.includes("abertura-veu"))
          if (universal && !regra.selectors.every((s) => s.includes(".abertura-a-sair"))) tocam.push(`${nome} ${regra.selector}`)
        })
      })
    }
    expect(tocam).toEqual([])
    // And the universal rules themselves: duration and count, never a delay.
    const universal = declaracoes("base.css", "*", true).map((d) => d.prop)
    expect(universal).toContain("animation-duration")
    expect(universal).not.toContain("animation-delay")
    expect(universal).not.toContain("animation")
  })
})
