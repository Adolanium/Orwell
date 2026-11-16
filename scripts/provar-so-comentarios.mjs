/**
 * Proves that a change touches only comments.
 *
 *   node scripts/provar-so-comentarios.mjs <ref-a> [ref-b]
 *
 * For each .ts, .tsx, .mjs and .css file that differs between `ref-a` and
 * `ref-b` (the working tree if `ref-b` is absent), emits both versions without
 * comments and compares them: TypeScript's emitter with `removeComments` for
 * code, esbuild minified for CSS. Exits 1 and lists the files when any differ.
 */
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const exigir = createRequire(path.join(raiz, "package.json"))
const ts = exigir("typescript")
const { transform } = exigir("esbuild")

const [refA, refB] = process.argv.slice(2)
if (!refA) {
  console.error("usage: node scripts/provar-so-comentarios.mjs <ref-a> [ref-b]")
  process.exit(2)
}

const git = (...args) => execFileSync("git", ["-C", raiz, ...args], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] })
const ficheiros = git("diff", "--name-only", refA, ...(refB ? [refB] : []))
  .split("\n")
  .filter((f) => /\.(tsx?|mjs|css)$/.test(f))
/** The file at `ref` (or on disk), or null where it does not exist: an added or deleted file is a difference. */
function ler(ref, f) {
  try {
    return ref ? git("show", `${ref}:${f}`) : fs.readFileSync(path.join(raiz, f), "utf8")
  } catch {
    return null
  }
}

async function semComentarios(f, codigo) {
  if (f.endsWith(".css")) return (await transform(codigo, { loader: "css", minify: true })).code
  return ts.transpileModule(codigo, {
    fileName: f,
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
  }).outputText
}

const diferentes = []
for (const f of ficheiros) {
  const [antes, depois] = [ler(refA, f), ler(refB, f)]
  if (antes === null || depois === null) {
    diferentes.push(f)
    continue
  }
  const [a, b] = await Promise.all([semComentarios(f, antes), semComentarios(f, depois)])
  if (a !== b) diferentes.push(f)
}
console.log(`${ficheiros.length} files, ${ficheiros.length - diferentes.length} identical without comments, ${diferentes.length} different`)
for (const f of diferentes) console.log(`  ${f}`)
process.exit(diferentes.length === 0 ? 0 : 1)
