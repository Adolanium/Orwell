import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postcss from "postcss"
import { describe, expect, it } from "vitest"

/**
 * No new rule in the universal bucket (1.3.20 fluidity).
 *
 * Blink files each rule under the id, class, tag or attribute of its
 * rightmost compound, and in a style recalc tries on an element only the rules
 * filed under what that element has. A rule whose rightmost part is `*`, a
 * bare pseudo-element (`::selection`), or a `:is()`/`:where()` with more than
 * one argument has nothing to be filed under: it goes to the universal bucket
 * and is tried on EVERY element, every recalc. `:where(.a)` with one argument
 * is filed under `.a` (checked in Chromium with selector stats). The lists in
 * `paineis.css` were the costliest rules of the main sheet; written one
 * selector per surface, the switch, the menus and the scroll got faster
 * (measured with Chromium selector stats in 1.3.20).
 *
 * The rules below are the ones that stay, each cheap or unavoidable. A new one
 * fails here: write it one selector per class, or add it with a reason.
 */
const AQUI = (relativo: string): string => fileURLToPath(new URL(relativo, import.meta.url))
const FICAM = new Set([
  // The reset and the root: by nature.
  "tokens.css :root",
  "base.css *",
  "base.css *::before",
  "base.css *::after",
  "base.css ::selection",
  "base.css ::-webkit-scrollbar",
  "base.css ::-webkit-scrollbar-thumb",
  "base.css :where(button, [href], input, select, textarea, [tabindex]):focus-visible",
  "pele.css ::selection",
  "screens.css :root",
  "movel.css :root",
  // Behind a parent class with `>`: Blink checks the parent at once.
  "screens.css .rail > *",
  "screens.css .post-images > *",
  "screens.css .pessoa-corpo > *",
  "screens.css .topbar.topbar-conversa > :not(h1, .topbar-espaco)",
  "screens.css .call-chip.ao-vivo-convida > :not(.ao-vivo-convite, .ao-vivo-cimo, .chip-volume, .call-chip-mais, .call-chip-musica, .call-chip-labels)",
  "screens.css .call-chip.ao-vivo-convida:is(:hover, :focus-within) > :not(.ao-vivo-convite, .ao-vivo-cimo, .chip-volume, .call-chip-mais, .call-chip-musica, .call-chip-labels)",
  "pele.css .main.com-sala > :not(.connection-banner, .call, .chat-pedido, .statusbar)",
  // The phone layout (option B): every list and pushed screen in the one grid cell.
  "telemovel.css :root .app.telemovel > *",
  "telemovel.css :root .app.telemovel > .vista-guardada > *",
  "telemovel.css :root .app.telemovel .people-destination > *",
  "telemovel.css :root .app.telemovel .ecra-empurrado > :last-child",
  "telemovel.css :root .app.telemovel .ecra-empurrado > .barra-do-telemovel ~ :last-child",
  "telemovel.css :root .app.telemovel .topbar-empurrada > *",
  "telemovel.css :root .app.telemovel .topbar-empurrada > .topbar-contexto > *",
  // The opening's veil: a class on <html> the ancestor filter rejects at once.
  "pele.css .abertura-a-segurar body > :not(.abertura-veu)",
  "pele.css .abertura-a-sair body > :not(.abertura-veu)",
  // Behind a rare ancestor class: the ancestor filter rejects them at once.
  "screens.css .call-chip.ao-vivo-convida :is(.chip-volume, .call-chip-mais, .call-chip-musica, .call-chip-labels)",
  "denunciasDoCanal.css .seccao-denuncias :is(.denuncia-nova, .denuncia-prova, .denuncia-marca)",
  "denunciasDoCanal.css .seccao-denuncias :is(.denuncia-dados dt, .denuncia-rotulo)",
  "folhaDeDenunciar.css .sheet.denunciar :is(.denunciar-alvo-cabecalho, .denunciar-item-cabecalho)",
])

/** The rightmost compound of a selector (after the last top-level combinator). */
function ultimoComposto(seletor: string): string {
  let profundidade = 0
  let inicio = 0
  for (let i = 0; i < seletor.length; i++) {
    const c = seletor[i] as string
    if (c === "(" || c === "[") profundidade++
    else if (c === ")" || c === "]") profundidade--
    else if (profundidade === 0 && /[\s>+~]/.test(c)) inicio = i + 1
  }
  return seletor.slice(inicio)
}

function argumentos(lista: string): number {
  let profundidade = 0
  let n = 1
  for (const c of lista) {
    if (c === "(") profundidade++
    else if (c === ")") profundidade--
    else if (c === "," && profundidade === 0) n++
  }
  return n
}

/** Whether Blink can file this compound under a class, id, tag or attribute. */
function temBalde(composto: string): boolean {
  const s = composto.replace(/::[\w-]+(\([^)]*\))?$/, "")
  if (/^[a-zA-Z][\w-]*/.test(s) || /^[#.][\w-]/.test(s)) return true
  let profundidade = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (c === "(") profundidade++
    else if (c === ")") profundidade--
    else if (profundidade === 0 && (c === "." || c === "#" || c === "[")) return true
    else if (profundidade === 0 && c === ":" && /^:(is|where)\(/.test(s.slice(i))) {
      const abre = s.indexOf("(", i) + 1
      let fundo = 1
      let k = abre
      while (fundo > 0 && k < s.length) {
        if (s[k] === "(") fundo++
        else if (s[k] === ")") fundo--
        k++
      }
      if (argumentos(s.slice(abre, k - 1)) === 1) return true
    }
  }
  return false
}

function universais(): string[] {
  const entrada = readFileSync(AQUI("../styles.css"), "utf8")
  const nomes = [...entrada.matchAll(/@import "\.\/styles\/([A-Za-z.]+\.css)"/g)].map((m) => m[1] as string)
  const fora: string[] = []
  for (const nome of nomes) {
    postcss.parse(readFileSync(AQUI(`./${nome}`), "utf8")).walkRules((regra) => {
      if (regra.parent?.type === "atrule" && /keyframes$/.test((regra.parent as postcss.AtRule).name)) return
      for (const seletor of regra.selectors) {
        const limpo = seletor.replace(/\s+/g, " ").trim()
        if (!temBalde(ultimoComposto(limpo))) fora.push(`${nome} ${limpo}`)
      }
    })
  }
  return fora
}

describe("o balde universal da folha principal", () => {
  it("só tem as regras que ficam, cada uma com a sua razão", () => {
    expect(universais().filter((r) => !FICAM.has(r))).toEqual([])
  })

  it("o detector reconhece o que o Blink não arquiva (prova da própria régua)", () => {
    expect(temBalde(":where(.a, .b)")).toBe(false)
    expect(temBalde(":is(.a, .b)")).toBe(false)
    expect(temBalde("*")).toBe(false)
    expect(temBalde("::selection")).toBe(false)
    expect(temBalde(":where(.a)")).toBe(true)
    expect(temBalde(":where(.a:not(.b))")).toBe(true)
    expect(temBalde(".a.a")).toBe(true)
    expect(temBalde("button:hover")).toBe(true)
    expect(temBalde("[data-tip]::before")).toBe(true)
    expect(ultimoComposto(":where(.a, .b) :where(.c)")).toBe(":where(.c)")
  })

  it("paineis.css não tem nenhuma", () => {
    expect(universais().filter((r) => r.startsWith("paineis.css "))).toEqual([])
  })
})
