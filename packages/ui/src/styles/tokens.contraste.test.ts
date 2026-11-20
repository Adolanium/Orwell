import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The two themes of `tokens.css`, measured from the sheet itself.
 *
 * Each theme writes its layer-1 values (surfaces, text tiers, brand, danger,
 * presence) as `#rrggbb`. Here every text tier must pass 4.5:1 on every
 * surface where text can land, the white ink must pass on the brand and red
 * fills, and the presence dots must pass 3:1 (a graphic, WCAG 1.4.11).
 *
 * The light theme is written twice (the explicit choice and "System" on a
 * light OS); the two blocks must say the same thing.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const tokens = ler("./tokens.css").replace(/\/\*[\s\S]*?\*\//g, "")

/** The body of the first rule whose selector is exactly this one. */
function bloco(selector: string): string {
  const inicio = tokens.indexOf(`${selector} {`)
  if (inicio < 0) throw new Error(`falta ${selector} em tokens.css`)
  const abre = tokens.indexOf("{", inicio)
  return tokens.slice(abre + 1, tokens.indexOf("}", abre))
}

function valores(corpo: string): Map<string, string> {
  return new Map([...corpo.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]))
}

const escuro = valores(bloco(":root"))
const claroEscolhido = valores(bloco(':root[data-theme="claro"]'))
const claroDoSistema = valores(bloco('  :root[data-theme="sistema"]'))
/** The light theme: the dark values, overridden by the light block. */
const claro = new Map([...escuro, ...claroEscolhido])

type Rgb = readonly [number, number, number]
function hex(tema: Map<string, string>, nome: string): Rgb {
  const valor = tema.get(nome)
  const m = /^#([0-9a-f]{6})$/i.exec(valor ?? "")
  if (!m) throw new Error(`${nome} não é #rrggbb: ${valor}`)
  const n = Number.parseInt(m[1] as string, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
function luminancia([r, g, b]: Rgb): number {
  const linear = (c: number): number => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
function contraste(a: Rgb, b: Rgb): number {
  const [x, y] = [luminancia(a), luminancia(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const SUPERFICIES = ["--fundo", "--vidro-solido", "--bg-main", "--bg-raised", "--bg-hover", "--flutuante", "--poco"]
const TEXTOS = ["--titulo", "--texto", "--secundario", "--apagado", "--discreto", "--acento", "--rosa", "--warning"]
const PONTOS = ["--presenca", "--presence-away", "--presence-busy", "--presence-offline"]

describe.each([
  ["escuro", escuro],
  ["claro", claro],
] as const)("o tema %s", (_nome, tema) => {
  it.each(TEXTOS)("%s passa 4,5:1 sobre todas as superfícies", (texto) => {
    for (const superficie of SUPERFICIES) {
      expect(contraste(hex(tema, texto), hex(tema, superficie)), `${texto} sobre ${superficie}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("a tinta escura passa 4,5:1 sobre o ciano da marca, em repouso e debaixo do rato", () => {
    expect(contraste(hex(tema, "--tinta-acento"), hex(tema, "--acento-cheio"))).toBeGreaterThanOrEqual(4.5)
    expect(contraste(hex(tema, "--tinta-acento"), hex(tema, "--acento-cheio-sobre"))).toBeGreaterThanOrEqual(4.5)
  })

  it("a tinta branca passa 4,5:1 sobre o vermelho", () => {
    expect(contraste(hex(tema, "--tinta"), hex(tema, "--rosa-cheio"))).toBeGreaterThanOrEqual(4.5)
  })

  it("a marca é rgb(139, 233, 253) como preenchimento, nos dois temas", () => {
    expect(tema.get("--acento-cheio")).toBe("#8be9fd")
  })

  it.each(PONTOS)("o ponto %s passa 3:1 sobre todas as superfícies", (ponto) => {
    const cor = tema.get(ponto)?.startsWith("var(") ? "--presenca" : ponto
    for (const superficie of SUPERFICIES) {
      expect(contraste(hex(tema, cor), hex(tema, superficie)), `${ponto} sobre ${superficie}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe("as duas formas do tema claro", () => {
  it("o claro escolhido e o claro do sistema dizem o mesmo", () => {
    expect(Object.fromEntries(claroDoSistema)).toEqual(Object.fromEntries(claroEscolhido))
  })

  it("o escuro é o de omissão, e o claro só pinta com `data-theme`", () => {
    expect(escuro.get("color-scheme")).toBeUndefined()
    expect(tokens).toMatch(/:root\s*\{\s*color-scheme:\s*dark/)
    expect(tokens).toMatch(/:root\[data-theme="claro"\]\s*\{\s*color-scheme:\s*light/)
    expect(tokens).toMatch(/@media \(prefers-color-scheme: light\)\s*\{\s*:root\[data-theme="sistema"\]/)
  })
})

describe("a pele plana", () => {
  const folhas = ["./fundo.css", "./pele.css", "./paineis.css"].map(ler).join("\n").replace(/\/\*[\s\S]*?\*\//g, "")

  it("não há aurora, chuva nem vidro", () => {
    expect(folhas).not.toMatch(/aurora|chuva|backdrop-filter/)
    expect(tokens).not.toMatch(/--aurora-|--chuva-/)
  })

  it("o primário é um preenchimento sólido, sem gradiente nem brilho", () => {
    expect(folhas).not.toMatch(/linear-gradient\(135deg/)
    const primario = /\n\.primary\s*\{([^}]*)\}/.exec(folhas)?.[1] ?? ""
    expect(primario).toMatch(/background:\s*var\(--accent-deep\)/)
    expect(primario).toMatch(/box-shadow:\s*none/)
  })
})

describe("a chamada: o que está por cima de uma imagem", () => {
  /** `rgb(r g b / a)` as written in tokens.css. */
  function rgba(nome: string): readonly [number, number, number, number] {
    const m = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(escuro.get(nome) ?? "")
    if (!m) throw new Error(`${nome} não é rgb(r g b / a): ${escuro.get(nome)}`)
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const
  }
  const sobre = (base: Rgb, [r, g, b, a]: readonly [number, number, number, number]): Rgb =>
    [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)] as const
  const BRANCO: Rgb = [255, 255, 255]

  it("o véu e o texto não mudam com o tema: o claro não os redefine", () => {
    for (const nome of ["--midia-veu", "--midia-veu-forte", "--midia-titulo", "--midia-texto", "--midia-secundario"]) {
      expect(escuro.has(nome), nome).toBe(true)
      expect(claroEscolhido.has(nome), nome).toBe(false)
    }
  })

  it.each(["--midia-veu", "--midia-veu-forte"])("o texto passa 4,5:1 sobre %s, mesmo com uma imagem branca por baixo", (veu) => {
    const fundo = sobre(BRANCO, rgba(veu))
    for (const texto of ["--midia-titulo", "--midia-texto", "--midia-secundario"]) {
      expect(contraste(hex(escuro, texto), fundo), texto).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("as etiquetas sobre a imagem usam o véu e apontam o texto para --midia-*, e o cartão não tem o bisel de vidro", () => {
    const ecras = ler("./screens.css").replace(/\/\*[\s\S]*?\*\//g, "")
    expect(ecras).not.toMatch(/rgba\(6, 9, 20/)
    const mapa = /\.call-chip-labels,[^{]*\{([^}]*)\}/.exec(ecras)?.[1] ?? ""
    for (const papel of ["--titulo", "--text", "--text-dim", "--text-faint", "--discreto"]) {
      expect(mapa, papel).toMatch(new RegExp(`${papel}:\\s*var\\(--midia-`))
    }
    const chip = /\n\.call-chip\s*\{([^}]*)\}/.exec(ecras)?.[1] ?? ""
    expect(chip).toMatch(/box-shadow:\s*var\(--sombra-1\)/)
    expect(ecras).not.toMatch(/0 10px 28px rgb\(0 0 0/)
  })
})

/**
 * The rail notices (option A, 20/11/2026), in the three themes.
 *
 * Each notice is a shape on the rail (`--fundo`), so the shape must pass 3:1
 * against it (WCAG 1.4.11). The mention carries a number, so its ink must pass
 * 4.5:1 on its fill. The nudge, the call and the dropped connection carry a
 * glyph, never text: 3:1 is enough there.
 *
 * The tokens point at layer 1 with `var()`; here they are followed to the hex.
 * Aurora is read from its own root (`aurora.gen.css`) and the hand sheet
 * (`aurora.css`), over the dark values.
 */
describe("os avisos do carril", () => {
  function blocoDe(folha: string, selector: string): string {
    const limpa = folha.replace(/\/\*[\s\S]*?\*\//g, "")
    const inicio = limpa.indexOf(`${selector} {`)
    if (inicio < 0) throw new Error(`falta ${selector}`)
    const abre = limpa.indexOf("{", inicio)
    return limpa.slice(abre + 1, limpa.indexOf("}", abre))
  }
  const auroraRaiz = ':root[data-theme="aurora"]:root'
  const aurora = new Map([
    ...escuro,
    ...valores(blocoDe(ler("./aurora.gen.css"), auroraRaiz)),
    ...valores(blocoDe(ler("./aurora.css"), auroraRaiz)),
  ])

  /** Follows `var(--x)` until a hex. */
  function cor(tema: Map<string, string>, nome: string): Rgb {
    let atual = nome
    for (let passo = 0; passo < 8; passo++) {
      const valor = tema.get(atual) ?? ""
      const m = /^var\((--[a-z0-9-]+)\)$/.exec(valor)
      if (!m) return hex(tema, atual)
      atual = m[1] as string
    }
    throw new Error(`${nome}: var() sem fim`)
  }

  const FORMAS = ["--aviso-neutro", "--aviso-mencao", "--aviso-toque", "--aviso-chamada", "--aviso-ligacao"]
  const GLIFOS = [
    ["--aviso-toque-tinta", "--aviso-toque"],
    ["--aviso-chamada-tinta", "--aviso-chamada"],
    ["--aviso-ligacao-tinta", "--aviso-ligacao"],
  ] as const

  describe.each([
    ["escuro", escuro],
    ["claro", claro],
    ["aurora", aurora],
  ] as const)("no tema %s", (_nome, tema) => {
    it.each(FORMAS)("%s passa 3:1 sobre o fundo do carril", (forma) => {
      expect(contraste(cor(tema, forma), cor(tema, "--fundo"))).toBeGreaterThanOrEqual(3)
    })

    it("o número da menção passa 4,5:1 sobre a pastilha", () => {
      expect(contraste(cor(tema, "--aviso-mencao-tinta"), cor(tema, "--aviso-mencao"))).toBeGreaterThanOrEqual(4.5)
    })

    it.each(GLIFOS)("o glifo %s passa 3:1 sobre %s", (tinta, fundo) => {
      expect(contraste(cor(tema, tinta), cor(tema, fundo))).toBeGreaterThanOrEqual(3)
    })
  })

  it("o claro escolhido e o do sistema têm os mesmos avisos", () => {
    for (const nome of FORMAS.flatMap((f) => [f, `${f}-tinta`])) {
      expect(claroDoSistema.get(nome), nome).toBe(claroEscolhido.get(nome))
    }
  })
})
