/**
 * The mention highlight (a line that mentions me, a reply with "@ Mention" on
 * included), as the stylesheets draw it. 17/11/2026.
 *
 * jsdom applies no CSS, so these read the sheets in the order `styles.css`
 * imports them. The live proof is `scripts/prova-destaque-respostas.mjs`.
 *
 * Four defects the owner saw as "buggy":
 * - under the mouse the lit ground vanished: `pele.css` clears `.message:hover`
 *   with the same weight as `.message.menciona-me`, and it loads later;
 * - the 3 px bar sat on the first pixels of the face, because `.message` has
 *   no side padding;
 * - on a touch screen the tapped line keeps `:hover`, so the same rule left a
 *   lit line without its ground until the next tap ("they get stuck");
 * - a lit line jumped to (from search) faded to clear and then snapped back,
 *   because the jump's keyframes ended on `transparent`.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const semComentarios = (texto: string): string => texto.replace(/\/\*[\s\S]*?\*\//g, "")

/** Every sheet, in the order the entry point imports them. */
function folhasPorOrdem(): string[] {
  const entrada = readFileSync(join(raiz, "styles.css"), "utf8")
  return [...entrada.matchAll(/@import "\.\/(styles\/[^"]+)"/g)].map((m) => semComentarios(readFileSync(join(raiz, m[1]!), "utf8")))
}

/** The bodies of the rules whose selector list holds exactly `seletor`, across all sheets, in cascade order. */
function corpos(seletor: string): string[] {
  const achados: string[] = []
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regra = new RegExp(`(?:^|[}\\n])\\s*([^{}@]*?)\\{([^{}]*)\\}`, "g")
  for (const folha of folhasPorOrdem()) {
    for (const m of folha.matchAll(regra)) {
      const lista = m[1]!.split(",").map((s) => s.trim())
      if (lista.some((s) => new RegExp(`^${escapado}$`).test(s))) achados.push(m[2]!)
    }
  }
  return achados
}

const valor = (corpo: string, nome: string): string | null => new RegExp(`(?:^|;)\\s*${nome}\\s*:([^;}]*)`).exec(corpo)?.[1]?.trim() ?? null

describe("o destaque de menção", () => {
  it("com o rato por cima, o fundo fica (uma regra mais forte que a do `.message:hover` da pele)", () => {
    const sobre = corpos(".message.menciona-me:hover").map((c) => valor(c, "background")).filter(Boolean)
    expect(sobre.length, "uma regra .message.menciona-me:hover com fundo").toBeGreaterThan(0)
    expect(sobre.at(-1)).not.toMatch(/transparent\s*$|^none$/)
  })

  it("ao toque (o :hover fica preso na linha tocada), o fundo é o de repouso, fora de qualquer @media", () => {
    const folhas = folhasPorOrdem().join("\n")
    const foraDeMedia = folhas.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
    const regra = new RegExp(`(?:^|[}\\n])\\s*\\.message\\.menciona-me:hover\\s*\\{([^{}]*)\\}`).exec(foraDeMedia)?.[1] ?? ""
    const repouso = new RegExp(`(?:^|[}\\n])\\s*\\.message\\.menciona-me\\s*\\{([^{}]*)\\}`).exec(foraDeMedia)?.[1] ?? ""
    expect(valor(regra, "background"), "o fundo ao toque").toBe(valor(repouso, "background"))
  })

  it("a barra fica fora da cara: a linha acesa recua para o padding e devolve-o, alinhada com as outras", () => {
    const corpo = corpos(".message.menciona-me").at(-1) ?? ""
    const recuo = valor(corpo, "margin-inline-start") ?? valor(corpo, "margin-left")
    const almofada = valor(corpo, "padding-inline-start") ?? valor(corpo, "padding-left")
    expect(almofada, "padding à esquerda").not.toBeNull()
    expect(recuo, "margem negativa igual ao padding").toBe(`calc(-1 * ${almofada})`)
    expect(valor(corpo, "box-shadow")).toMatch(/inset 3px 0 0/)
  })

  it("o salto até uma linha acesa não a apaga no fim: os quadros do realce não acabam em transparente", () => {
    const screens = semComentarios(readFileSync(join(raiz, "styles/screens.css"), "utf8"))
    const quadros = /@keyframes procura-acende \{([\s\S]*?)\n\}/.exec(screens)?.[1] ?? ""
    expect(quadros, "os quadros do realce").not.toBe("")
    expect(quadros).not.toMatch(/100%\s*\{[^}]*(background|box-shadow)/)
  })
})
