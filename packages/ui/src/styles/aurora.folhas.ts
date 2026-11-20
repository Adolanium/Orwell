import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The 1.3.19 sheets, read back out of the Aurora theme, for the tests.
 *
 * `aurora.gen.css` is the sheets of 1.3.19, one section per file (each opens
 * with a `/* styles/<file> *\/` line), every selector scoped to the Aurora
 * attribute and every keyframe renamed with `-aurora`. Taking the scope and
 * the suffix off gives back each sheet as 1.3.19 wrote it, without comments.
 * The tests that pinned the 1.3.19 skin (`*.aurora.test.ts`) read their sheets
 * here, so they keep proving the same things, now about the Aurora theme.
 */
const ESCOPO = ':root[data-theme="aurora"]'
const AQUI = dirname(fileURLToPath(import.meta.url))
const escapar = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** One sheet of 1.3.19 ("fundo.css"), as it was. */
export function folhaDaAurora(nome: string): string {
  const gerado = readFileSync(join(AQUI, "aurora.gen.css"), "utf8")
  const partes = gerado.split(/^\/\* styles\/([A-Za-z]+\.css) \*\/$/m)
  const indice = partes.indexOf(nome)
  if (indice < 0) throw new Error("aurora.gen.css does not have the sheet asked for", { cause: nome })
  const e = escapar(ESCOPO)
  return (
    (partes[indice + 1] ?? "")
      // A selector that named the root kept its own `:root` or `html` beside the scope.
      .split(`${ESCOPO}:root`)
      .join(":root")
      .split(`html${ESCOPO}`)
      .join("html")
      // An attribute selector was written twice (on the root, and below it): one again.
      .replace(new RegExp(`${e}(\\[[^,{]*?),\\s*${e} \\1(?=\\s*[,{])`, "g"), "$1")
      // "SCOPE .x" is ".x"; "SCOPE {" and "SCOPE:..." were the root.
      .replace(new RegExp(`${e} (?=[^{,\\s])`, "g"), "")
      .replace(new RegExp(e, "g"), ":root")
      // Only the suffix the generator added to keyframe names, never "--aurora-azul".
      .replace(/(?<=[A-Za-z0-9])-aurora\b/g, "")
  )
}
