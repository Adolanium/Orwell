import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CORES_DO_ARRANQUE, HTML_DO_ARRANQUE, htmlDoArranque } from "./ecra-de-arranque.js"
import { escreverTema, FUNDO_DA_JANELA, lerTemaGuardado, temaVisto } from "./tema-da-janela.js"

// By path, not `new URL(...)`: in jsdom `URL` is not Node's.
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (relativo: string): string => readFileSync(join(AQUI, relativo), "utf8")
const tokens = ler("../../../../packages/ui/src/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "")

/** `--fundo` in the first rule with exactly this selector. */
function fundoDe(seletor: string): string {
  const inicio = tokens.indexOf(`${seletor} {`)
  const corpo = tokens.slice(tokens.indexOf("{", inicio) + 1, tokens.indexOf("}", inicio))
  return /--fundo:\s*(#[0-9a-f]{6})/i.exec(corpo)?.[1] ?? ""
}

describe("a cor com que as janelas abrem segue o tema escolhido", () => {
  it("o fundo de cada tema é o --fundo de tokens.css (o body), para nada mudar de cor quando a página chega", () => {
    expect(FUNDO_DA_JANELA.escuro).toBe(fundoDe(":root"))
    expect(FUNDO_DA_JANELA.claro).toBe(fundoDe(':root[data-theme="claro"]'))
  })

  it("lê o ficheiro com tolerância: sem ficheiro ou com lixo é o escuro", () => {
    expect(lerTemaGuardado(null)).toBe("escuro")
    expect(lerTemaGuardado("{nada")).toBe("escuro")
    expect(lerTemaGuardado('{"tema":"roxo"}')).toBe("escuro")
    for (const tema of ["escuro", "claro", "sistema"] as const) expect(lerTemaGuardado(escreverTema(tema))).toBe(tema)
  })

  it("«sistema» segue o sistema operativo", () => {
    expect(temaVisto("sistema", true)).toBe("escuro")
    expect(temaVisto("sistema", false)).toBe("claro")
    expect(temaVisto("claro", true)).toBe("claro")
    expect(temaVisto("escuro", false)).toBe("escuro")
  })

  it("o index.ts não escreve cor de janela à mão: vem do tema", () => {
    const index = ler("./index.ts")
    expect(index).not.toMatch(/backgroundColor:\s*"#/)
    expect(index).toMatch(/backgroundColor:\s*FUNDO_DA_JANELA\[temaNoEcra\(\)\]/)
    expect(index).toMatch(/backgroundColor:\s*CORES_DO_ARRANQUE\[temaNoEcra\(\)\]\.fundo/)
    expect(index).toMatch(/htmlDoArranque\(temaNoEcra\(\)\)/)
  })
})

describe("o ecrã de arranque nos dois temas", () => {
  it("o escuro é o desenho aprovado, inalterado", () => {
    expect(htmlDoArranque("escuro")).toBe(HTML_DO_ARRANQUE)
    expect(HTML_DO_ARRANQUE).toContain(`background: ${CORES_DO_ARRANQUE.escuro.fundo} url("data:image/webp`)
  })

  it("o claro tem fundo claro, sem a arte escura, com a mesma política e sem script", () => {
    const claro = htmlDoArranque("claro")
    expect(claro).toContain(`background: ${CORES_DO_ARRANQUE.claro.fundo};`)
    expect(claro).not.toContain("data:image/webp")
    expect(claro).toContain('class="arte"')
    expect(claro).not.toMatch(/<script/i)
    const csp = (html: string): string | undefined => /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]
    expect(csp(claro)).toBe(csp(HTML_DO_ARRANQUE))
    for (const id of ["titulo", "barra", "cheio", "detalhe"]) expect(claro).toContain(`id="${id}"`)
  })
})

describe("o tema Aurora (a pele da 1.3.19)", () => {
  it("abre na noite dele, e o arranque é o desenho aprovado", () => {
    expect(FUNDO_DA_JANELA.aurora).toBe("#080c1a")
    expect(lerTemaGuardado(escreverTema("aurora"))).toBe("aurora")
    expect(temaVisto("aurora", false)).toBe("aurora")
    expect(htmlDoArranque("aurora")).toBe(HTML_DO_ARRANQUE)
  })
})

describe("o tema Sistema com a app aberta (revisão M7)", () => {
  it("a cor da janela segue a mudança do sistema, não só o arranque", () => {
    const index = ler("./index.ts")
    expect(index).toMatch(/nativeTheme\.on\("updated"[\s\S]{0,200}temaEscolhido === "sistema"[\s\S]{0,120}setBackgroundColor\(FUNDO_DA_JANELA\[temaNoEcra\(\)\]\)/)
  })
})
