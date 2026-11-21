import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * No Portuguese text outside the catalogs (20/11/2026).
 *
 * The rule: English is the default, and Portuguese shows only to
 * whoever has a Portuguese system or chose it. A sentence written straight in
 * the code skips that rule: it shows in Portuguese on a German system. That
 * happened, and it is a defect.
 *
 * So every text goes first into `linguas/en.ts`, with its pair in
 * `linguas/pt.ts`. This test reads every string, template and JSX text in the
 * interface and in the desktop main process (comments do not count: the
 * TypeScript parser drops them), and fails on any one with a Portuguese accent.
 *
 * Accents are the measure because they are cheap and do not lie: English has
 * none. A Portuguese sentence without accents ("Sair") escapes this net; the
 * review is what catches those.
 *
 * `PERMITIDOS` holds the texts that are not shown, or that must stay as they
 * are, each one with the reason. A reason that no longer matches the code is
 * an error too: the list cannot keep excuses for text that went away.
 */

function raiz(): string {
  const meu = expect.getState().testPath
  if (!meu) throw new Error("no test path: nothing to sweep")
  return join(dirname(meu), "../../..")
}

const PASTAS = ["packages/ui/src", "apps/client/src/main"]

/** Not product, or the catalogs themselves. */
function foraDoAlcance(caminho: string): boolean {
  return (
    /\.test\.tsx?$/.test(caminho) ||
    /\.gen\.ts$/.test(caminho) ||
    /\.d\.ts$/.test(caminho) ||
    caminho.includes("/linguas/") ||
    caminho.includes("/vendor/") ||
    caminho.includes("/testes/")
  )
}

const ACENTO = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/

/** `ficheiro::texto`, and why it may stay. */
const PERMITIDOS: Readonly<Record<string, string>> = {
  "packages/ui/src/escolha-da-lingua.ts::Português":
    "o nome da língua escrito nela mesma, para quem a procura sem ler a outra",
  "packages/ui/src/hooks/usePrefs.ts::Âmbar": "nome interno de uma cor de destaque; a interface não o mostra",
  "packages/ui/src/hooks/usePrefs.ts::Índigo": "nome interno de uma cor de destaque; a interface não o mostra",
  "packages/ui/src/lib/statusPolicy.ts::Esse convite já atingiu o limite de utilizações.":
    "compatibilidade: a frase que um núcleo antigo mandava, comparada para dar a chave; nunca se mostra",
  "apps/client/src/main/lingua-do-anfitriao.ts::*":
    "o catálogo do processo principal, com as duas línguas lado a lado",
  "packages/ui/src/lib/nomesDeOrigem.ts::*":
    "os nomes com que as salas nascem, nas duas línguas, para os reconhecer; o ecrã mostra-os pelo catálogo",
  "apps/client/src/main/actualizacao-windows.ts::*":
    "`textosDaPergunta`, que já escolhe entre as duas línguas",
  "packages/ui/src/screens/telemovel/inventario.ts::*":
    "o inventário dos menus do telemóvel, que só o `inventario.test.ts` lê; a app não o importa nem o mostra",
}

interface Achado {
  ficheiro: string
  linha: number
  texto: string
}

function ficheiros(RAIZ: string): string[] {
  const lista: string[] = []
  const andar = (pasta: string): void => {
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome)
      if (statSync(caminho).isDirectory()) andar(caminho)
      else if (/\.tsx?$/.test(nome)) {
        const rel = relative(RAIZ, caminho)
        if (!foraDoAlcance(`/${rel}`)) lista.push(rel)
      }
    }
  }
  for (const pasta of PASTAS) andar(join(RAIZ, pasta))
  return lista
}

function textosCom(ficheiro: string, codigo: string): Achado[] {
  const fonte = ts.createSourceFile(
    ficheiro,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ficheiro.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const achados: Achado[] = []
  const visitar = (no: ts.Node): void => {
    let texto: string | undefined
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) texto = no.text
    else if (ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no)) texto = no.text
    else if (ts.isJsxText(no)) texto = no.text.trim()
    if (texto && ACENTO.test(texto)) {
      achados.push({ ficheiro, linha: fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1, texto })
    }
    ts.forEachChild(no, visitar)
  }
  visitar(fonte)
  return achados
}

function permitido(achado: Achado): string | undefined {
  return PERMITIDOS[`${achado.ficheiro}::${achado.texto}`] ?? PERMITIDOS[`${achado.ficheiro}::*`]
}

describe("texto visível fora do catálogo", () => {
  const RAIZ = raiz()
  const achados = ficheiros(RAIZ).flatMap((ficheiro) => textosCom(ficheiro, readFileSync(join(RAIZ, ficheiro), "utf8")))

  it("nenhum texto com acentos portugueses fica fora de `linguas/`", () => {
    const fora = achados.filter((achado) => permitido(achado) === undefined)
    expect(
      fora.map((a) => `${a.ficheiro}:${a.linha}: ${a.texto.slice(0, 80)}`),
      "texto em português fora do catálogo: põe-no em `linguas/en.ts` e `linguas/pt.ts`",
    ).toEqual([])
  })

  it("cada permissão ainda corresponde a texto que existe", () => {
    const usadas = new Set(
      achados.flatMap((achado) => [`${achado.ficheiro}::${achado.texto}`, `${achado.ficheiro}::*`]),
    )
    const mortas = Object.keys(PERMITIDOS).filter((chave) => !usadas.has(chave))
    expect(mortas, "permissões para texto que já não existe").toEqual([])
  })
})
