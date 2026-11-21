import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { GATILHOS, MONTAGENS } from "./inventario.js"

/**
 * No feature lost on the phone (option B, 20/11/2026).
 *
 * The rule: on a phone every menu is complete and no feature is lost. This test reads the source of the interface and
 * fails when a desktop menu has no phone path:
 *
 * 1. a `<ContextMenu` mounted in a file the inventory does not know;
 * 2. a right click (`onContextMenu=`) the inventory does not know;
 * 3. a right click whose element has no long press (`{...aoDedo(...)}` or
 *    `{...toque}`) in the same opening tag: on a phone that menu has no door;
 * 4. the message's hover bar with an action that is not in the message menu
 *    (the long press opens that menu);
 * 5. a test the inventory names that does not exist.
 *
 * The entries of each menu are the same array on both sides, and the sheet
 * draws it in the same order: `ContextMenu.test.tsx` ("a folha do telemóvel")
 * and `App.telemovel.test.tsx` ("menus inteiros por toque longo") prove it.
 */
/* The path goes via a variable, not a literal: Vite rewrites a literal
   `new URL("./x", import.meta.url)` to an asset address (see `styles/toque.test.ts`). */
const acima = "../../"
const raiz = fileURLToPath(new URL(acima, import.meta.url))

function ficheiros(pasta: string): string[] {
  const lista: string[] = []
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) {
      if (nome === "testes" || nome === "vendor" || nome === "node_modules") continue
      lista.push(...ficheiros(caminho))
    } else if (nome.endsWith(".tsx") && !nome.includes(".test.")) {
      lista.push(caminho)
    }
  }
  return lista
}

const fontes = ficheiros(raiz).map((caminho) => ({
  ficheiro: relative(raiz, caminho).split("\\").join("/"),
  texto: readFileSync(caminho, "utf8"),
}))

const contar = (texto: string, padrao: RegExp): number => [...texto.matchAll(padrao)].length

/**
 * The opening tag around a position: from the `<` before it to the `>` that
 * closes the tag. Braces are counted so a `>` inside `{...}` does not end it.
 */
function etiquetaEm(texto: string, posicao: number): string {
  let inicio = posicao
  let profundidade = 0
  while (inicio > 0) {
    const letra = texto[inicio]
    if (letra === "}") profundidade++
    else if (letra === "{") profundidade--
    else if (letra === "<" && profundidade <= 0 && /[A-Za-z]/.test(texto[inicio + 1] ?? "")) break
    inicio--
  }
  let fim = posicao
  profundidade = 0
  while (fim < texto.length) {
    const letra = texto[fim]
    if (letra === "{") profundidade++
    else if (letra === "}") profundidade--
    else if (letra === ">" && profundidade === 0 && texto[fim - 1] !== "=") break
    fim++
  }
  return texto.slice(inicio, fim + 1)
}

describe("inventário do telemóvel: nenhum menu do computador fica sem caminho", () => {
  it("every file that mounts a ContextMenu is in the inventory, with the same count", () => {
    const montagens = Object.fromEntries(
      fontes
        .map(({ ficheiro, texto }) => [ficheiro, contar(texto, /<ContextMenu\b/g)] as const)
        .filter(([, quantos]) => quantos > 0),
    )
    const noInventario = Object.fromEntries(Object.entries(MONTAGENS).map(([ficheiro, m]) => [ficheiro, m.quantos]))
    expect(montagens).toEqual(noInventario)
    for (const [ficheiro, montagem] of Object.entries(MONTAGENS)) {
      expect(montagem.menus, `${ficheiro}: um caminho no telemóvel por menu`).toHaveLength(montagem.quantos)
    }
  })

  it("every right click is in the inventory, with the same count", () => {
    const gatilhos = Object.fromEntries(
      fontes
        .map(({ ficheiro, texto }) => [ficheiro, contar(texto, /onContextMenu=/g)] as const)
        .filter(([, quantos]) => quantos > 0),
    )
    const noInventario = Object.fromEntries(Object.entries(GATILHOS).map(([ficheiro, g]) => [ficheiro, g.quantos]))
    expect(gatilhos).toEqual(noInventario)
  })

  it("every right click has a long press on the same element", () => {
    const semDedo: string[] = []
    for (const { ficheiro, texto } of fontes) {
      for (const achado of texto.matchAll(/onContextMenu=/g)) {
        const etiqueta = etiquetaEm(texto, achado.index ?? 0)
        if (!/\{\.\.\.(aoDedo\(|toque\})/.test(etiqueta)) {
          const linha = texto.slice(0, achado.index).split("\n").length
          semDedo.push(`${ficheiro}:${linha}`)
        }
      }
    }
    expect(semDedo).toEqual([])
  })

  it("the message's hover bar has no action that the message menu (the long press) lacks", () => {
    const linha = fontes.find((f) => f.ficheiro === "screens/chat/Timeline.tsx")?.texto ?? ""
    const ecra = fontes.find((f) => f.ficheiro === "screens/chat/ChatScreen.tsx")?.texto ?? ""
    const barra = linha.slice(linha.indexOf('className="msg-actions"'), linha.indexOf("</article>"))
    const menu = ecra.slice(ecra.indexOf("{menuDaMensagem && active && ("), ecra.indexOf("</main>"))
    const accoesDaBarra = [...barra.matchAll(/aria-label=\{(strings\.[a-zA-Z.]+)\}/g)].map((m) => m[1])
    // React, Reply, Copy, and "More" (which is the menu itself).
    expect(accoesDaBarra).toEqual([
      "strings.reaccoes.reagir",
      "strings.respostas.responder",
      "strings.chat.copyText",
      "strings.chat.messageMore",
    ])
    for (const accao of accoesDaBarra.filter((a) => a !== "strings.chat.messageMore")) {
      expect(menu, `${accao} falta no menu da mensagem`).toContain(accao as string)
    }
    // The quick reactions of the bar are the row on top of the menu.
    expect(barra).toContain("ReaccoesRapidas")
    expect(menu).toContain("reaccoesRapidas.map")
  })

  it("every test the inventory names exists", () => {
    const testes = Object.values(MONTAGENS).flatMap((m) => m.testes)
    for (const teste of testes) expect(existsSync(join(raiz, teste)), teste).toBe(true)
  })
})
