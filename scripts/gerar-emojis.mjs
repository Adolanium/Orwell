#!/usr/bin/env node
/**
 * Builds the emoji catalog: `packages/ui/src/components/emoji.gen.ts`.
 *
 * Input: only files kept in the repo, in `packages/ui/dados/emoji/`. This
 * script never touches the network. See `ORIGEM.md` in that folder for where
 * each file came from and its checksum.
 *
 *   emoji-test-15.0.txt              Unicode's official list, order and groups
 *   cldr-42.0.0-annotations-*.json   CLDR names and search words (pt-PT, pt, en)
 *   cldr-42.0.0-annotations-derived-*.json   same, for sequences (ZWJ, flags)
 *   nomes-manuais.txt                our own Portuguese names; they win over CLDR
 *
 * What goes in: every `fully-qualified` emoji, without skin tone variants and
 * without the `Component` group. What comes out per emoji is one line:
 *
 *   <glyph> <Portuguese name> | <search words, normalized, deduplicated>
 *
 * The search words are: our own synonyms, then CLDR Portuguese words, then the
 * English name and English words. Portuguese comes first so that a Portuguese
 * search ranks Portuguese matches ahead of English ones.
 *
 *   node scripts/gerar-emojis.mjs           write the file
 *   node scripts/gerar-emojis.mjs --check   exit 1 if the file is out of date
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const DADOS = "packages/ui/dados/emoji"
export const DESTINO = "packages/ui/src/components/emoji.gen.ts"

const VERSAO_UNICODE = "15.0"
const VERSAO_CLDR = "42.0.0"

/** Unicode group -> our category id. `Component` is deliberately absent. */
const CATEGORIAS = [
  ["rostos", "Smileys & Emotion"],
  ["gestos", "People & Body"],
  ["natureza", "Animals & Nature"],
  ["comida", "Food & Drink"],
  ["actividades", "Activities"],
  ["viagens", "Travel & Places"],
  ["objectos", "Objects"],
  ["simbolos", "Symbols"],
  ["bandeiras", "Flags"],
]

const VS16 = /️/g
const TOM_DE_PELE = /[\u{1F3FB}-\u{1F3FF}]/u

/** Same rule as `fold` in emoji.ts (keep them in step): no accents, lowercase. */
const fold = (texto) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
/** Folded, with punctuation as single spaces, so "bandeira: Portugal" is "bandeira portugal". */
const normalizar = (texto) => fold(texto).replace(/[^\p{L}\p{N}]+/gu, " ").trim()

const ler = (nome, raiz) => readFileSync(join(raiz, DADOS, nome), "utf8")

/**
 * Merge the annotation files of one language. Key: glyph without VS16. The
 * first file wins field by field: a pt-PT entry may carry only the search
 * words, and then the name still comes from pt.
 */
function carregarAnotacoes(raiz, ficheiros) {
  const mapa = new Map()
  for (const { nome, chave } of ficheiros) {
    const anotacoes = JSON.parse(ler(nome, raiz))[chave].annotations
    for (const [glifo, valor] of Object.entries(anotacoes)) {
      const id = glifo.replace(VS16, "")
      const antes = mapa.get(id)
      mapa.set(id, {
        nome: antes?.nome ?? valor.tts?.[0],
        palavras: antes?.palavras.length ? antes.palavras : (valor.default ?? []),
      })
    }
  }
  return mapa
}

function lerTabela(raiz) {
  const emojis = []
  let grupo = ""
  for (const linha of ler(`emoji-test-${VERSAO_UNICODE}.txt`, raiz).split("\n")) {
    const g = /^# group: (.+)$/.exec(linha)
    if (g) {
      grupo = g[1]
      continue
    }
    const m = /^([0-9A-F ]+?)\s*; fully-qualified\s+# (\S+) E[\d.]+ (.+)$/.exec(linha)
    if (!m) continue
    const char = String.fromCodePoint(...m[1].trim().split(" ").map((c) => parseInt(c, 16)))
    if (TOM_DE_PELE.test(char)) continue
    emojis.push({ char, grupo, nomeEn: m[3] })
  }
  return emojis
}

function lerManuais(raiz) {
  const mapa = new Map()
  for (const linha of ler("nomes-manuais.txt", raiz).split("\n")) {
    const t = linha.trim()
    if (!t || t.startsWith("//")) continue
    const espaco = t.indexOf(" ")
    if (espaco === -1) continue
    const resto = t.slice(espaco + 1)
    const barra = resto.indexOf("|")
    const nome = (barra === -1 ? resto : resto.slice(0, barra)).trim()
    const sinonimos = barra === -1 ? "" : resto.slice(barra + 1).trim()
    if (nome) mapa.set(t.slice(0, espaco).replace(VS16, ""), { nome, sinonimos })
  }
  return mapa
}

/** Everything the generator learned, for the report and for the tests. */
export function construir(raiz = RAIZ) {
  const tabela = lerTabela(raiz)
  const manuais = lerManuais(raiz)
  const pt = carregarAnotacoes(raiz, [
    { nome: `cldr-${VERSAO_CLDR}-annotations-pt-PT.json`, chave: "annotations" },
    { nome: `cldr-${VERSAO_CLDR}-annotations-derived-pt-PT.json`, chave: "annotationsDerived" },
    { nome: `cldr-${VERSAO_CLDR}-annotations-pt.json`, chave: "annotations" },
    { nome: `cldr-${VERSAO_CLDR}-annotations-derived-pt.json`, chave: "annotationsDerived" },
  ])
  const en = carregarAnotacoes(raiz, [
    { nome: `cldr-${VERSAO_CLDR}-annotations-en.json`, chave: "annotations" },
    { nome: `cldr-${VERSAO_CLDR}-annotations-derived-en.json`, chave: "annotationsDerived" },
  ])

  const usados = new Set()
  const porCategoria = Object.fromEntries(CATEGORIAS.map(([id]) => [id, []]))
  const semNomePt = []
  for (const { char, grupo, nomeEn } of tabela) {
    const categoria = CATEGORIAS.find(([, g]) => g === grupo)
    if (!categoria) continue
    const id = char.replace(VS16, "")
    const manual = manuais.get(id)
    if (manual) usados.add(id)
    const cldrPt = pt.get(id)
    const cldrEn = en.get(id)
    if (!manual && !cldrPt?.nome) semNomePt.push(char)

    const nome = manual?.nome ?? cldrPt?.nome ?? nomeEn
    // Search words, most specific first. Each is kept only if the text collected
    // so far does not already contain it: a word that sits inside the name finds
    // the emoji anyway, and the file stays small.
    let acumulado = normalizar(nome)
    const termos = []
    const juntar = (texto) => {
      const n = normalizar(texto ?? "")
      if (!n || acumulado.includes(n)) return
      termos.push(n)
      acumulado += ` ${n}`
    }
    if (manual) manual.sinonimos.split(/\s+/).forEach(juntar)
    if (manual) juntar(cldrPt?.nome)
    for (const p of cldrPt?.palavras ?? []) juntar(p)
    juntar(cldrEn?.nome ?? nomeEn)
    for (const p of cldrEn?.palavras ?? []) juntar(p)
    porCategoria[categoria[0]].push({ char, linha: termos.length ? `${char} ${nome} | ${termos.join(" ")}` : `${char} ${nome}` })
  }
  const orfaos = [...manuais.keys()].filter((k) => !usados.has(k))
  return { porCategoria, semNomePt, orfaos, manuais: manuais.size }
}

/** The whole text of `emoji.gen.ts`. */
export function gerar(raiz = RAIZ) {
  const { porCategoria } = construir(raiz)
  const blocos = Object.entries(porCategoria).map(
    ([id, lista]) => `  ${id}: [\n${lista.map((e) => `    ${JSON.stringify(e.linha)},`).join("\n")}\n  ],`,
  )
  return `// GENERATED by scripts/gerar-emojis.mjs. Do not edit by hand.
// Data: Unicode Emoji ${VERSAO_UNICODE} (emoji-test.txt) and CLDR ${VERSAO_CLDR} annotations (pt-PT, pt, en),
// both under the Unicode License v3 (see THIRD-PARTY-NOTICES.txt).
// Line format: <glyph> <Portuguese name> | <normalized search words>

export const UNICODE_EMOJI_VERSION = ${JSON.stringify(VERSAO_UNICODE)}
export const CLDR_VERSION = ${JSON.stringify(VERSAO_CLDR)}

export const EMOJI_LINES = {
${blocos.join("\n")}
} as const
`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const texto = gerar()
  const alvo = join(RAIZ, DESTINO)
  if (process.argv.includes("--check")) {
    let actual = ""
    try {
      actual = readFileSync(alvo, "utf8")
    } catch {}
    if (actual !== texto) {
      console.error(`${DESTINO} is out of date. Run: node scripts/gerar-emojis.mjs`)
      process.exit(1)
    }
    console.log(`${DESTINO} is up to date.`)
  } else {
    writeFileSync(alvo, texto)
    const { porCategoria, semNomePt, orfaos, manuais } = construir()
    const contagens = Object.entries(porCategoria).map(([id, l]) => `${id}=${l.length}`)
    console.log(`Wrote ${DESTINO}: ${Object.values(porCategoria).flat().length} emojis (${contagens.join(", ")})`)
    console.log(`Manual names used: ${manuais - orfaos.length}/${manuais}. Without a Portuguese name (English used): ${semNomePt.length}`)
    if (orfaos.length) console.log(`Manual entries not in the Unicode table (dropped): ${orfaos.join(" ")}`)
  }
}
