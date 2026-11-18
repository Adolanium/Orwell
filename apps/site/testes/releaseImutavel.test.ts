import { describe, expect, it } from "vitest"
// @ts-expect-error plain JavaScript script, no declarations: it is run by
// `node scripts/publicar-instaladores.mjs` and isn't part of any build.
import { publicarManifestoNaRelease, textoDasSomas } from "../../../scripts/instaladores.mjs"

/**
 * The signed manifest and the installers' sums go into the public GitHub
 * release, and the release is immutable once published (on since 18/11/2026:
 * assets can no longer be added, changed or deleted, the tag is locked). So: a
 * draft on the expected commit, the assets, then publish; and it must come out
 * immutable, with the tag where it should be (review C1, I1, I2). No network:
 * `gh` and `fetch` are fakes that hold a release.
 */
const MANIFESTO = new TextEncoder().encode('{\n  "versao": "1.3.20"\n}\n')
const SOMAS = new TextEncoder().encode(textoDasSomas([{ soma: "a".repeat(64), nome: "Orwell-1.3.20-windows-x64.exe" }]))
const OUTRO = new TextEncoder().encode('{\n  "versao": "1.3.20", "x": 1\n}\n')
const ALVO = "1".repeat(40)
const FICHEIROS = [
  { nome: "actualizacao-windows.json", caminho: "/tmp/actualizacao-windows.json", bytes: MANIFESTO },
  { nome: "somas-sha256.txt", caminho: "/tmp/somas-sha256.txt", bytes: SOMAS },
]

type Release = {
  isDraft: boolean
  publishedAt: string | null
  targetCommitish: string
  ficheiros: Record<string, Uint8Array>
}

function github(
  inicial: Release | null,
  opcoes: { definicaoLigada?: boolean; saiImutavel?: boolean; tagEm?: string; tagAntes?: { type: string; sha: string } } = {},
): { gh: (argumentos: string[]) => Promise<string>; buscar: typeof fetch; comandos: string[]; estado: () => Release | null } {
  let release = inicial
  const comandos: string[] = []
  const gh = async (argumentos: string[]): Promise<string> => {
    const [grupo, accao] = argumentos
    comandos.push(grupo === "api" ? `api ${accao!.split("/").slice(3).join("/") || "immutable-releases"}` : accao!)
    if (grupo === "api") {
      if (accao!.endsWith("/immutable-releases")) return JSON.stringify({ enabled: opcoes.definicaoLigada ?? true })
      // Before publishing, the tag exists only if someone made it already.
      if (accao!.includes("/git/ref/tags/") && release?.isDraft) {
        if (opcoes.tagAntes) return JSON.stringify({ object: opcoes.tagAntes })
        throw new Error("Not Found")
      }
      if (!release || release.isDraft) throw new Error("Not Found")
      if (accao!.includes("/releases/tags/")) return JSON.stringify({ immutable: opcoes.saiImutavel ?? true })
      if (accao!.includes("/git/ref/tags/")) return JSON.stringify({ object: { type: "commit", sha: opcoes.tagEm ?? release.targetCommitish } })
      throw new Error(`api inesperada: ${accao}`)
    }
    if (!release) throw new Error("release not found")
    if (accao === "view") {
      return JSON.stringify({
        isDraft: release.isDraft,
        publishedAt: release.publishedAt,
        targetCommitish: release.targetCommitish,
        assets: Object.keys(release.ficheiros).map((name) => ({ name })),
      })
    }
    if (accao === "upload") {
      // Immutable: a published release takes no asset (GitHub refuses).
      if (!release.isDraft) throw new Error("Cannot upload assets to an immutable release")
      const f = FICHEIROS.find((x) => x.caminho === argumentos[3])!
      release = { ...release, ficheiros: { ...release.ficheiros, [f.nome]: f.bytes } }
      return ""
    }
    if (accao === "edit" && argumentos.includes("--draft=false")) {
      release = { ...release, isDraft: false, publishedAt: "2026-11-20T10:00:00Z" }
      return ""
    }
    throw new Error(`comando inesperado: ${argumentos.join(" ")}`)
  }
  const buscar = (async (url: string) => {
    // A draft's assets are not public.
    const nome = url.split("/").pop()!
    if (!release || release.isDraft || !release.ficheiros[nome] || !url.includes("/releases/download/v1.3.20/")) return new Response("Not Found", { status: 404 })
    return new Response(release.ficheiros[nome])
  }) as typeof fetch
  return { gh, buscar, comandos, estado: () => release }
}

const rascunho = (extra: Partial<Release> = {}): Release => ({ isDraft: true, publishedAt: null, targetCommitish: ALVO, ficheiros: {}, ...extra })
const publicar = (g: ReturnType<typeof github>, alvo = ALVO) =>
  publicarManifestoNaRelease({ tag: "v1.3.20", repositorio: "magnuslab-sudo/Orwell", alvo, ficheiros: FICHEIROS, gh: g.gh, buscar: g.buscar })

describe("a release pública, imutável, com o manifesto e as somas", () => {
  it("rascunho no commit certo: sobe os dois ficheiros, publica, e confere imutável, tag e bytes", async () => {
    const g = github(rascunho())
    expect(await publicar(g)).toEqual({ ok: true, publicouAgora: true })
    // The setting and the assets BEFORE publishing; immutability and tag after.
    expect(g.comandos).toEqual([
      "view",
      "api git/ref/tags/v1.3.20",
      "api immutable-releases",
      "upload",
      "upload",
      "edit",
      "view",
      "api releases/tags/v1.3.20",
      "api git/ref/tags/v1.3.20",
    ])
    expect(Object.keys(g.estado()!.ficheiros).sort()).toEqual(["actualizacao-windows.json", "somas-sha256.txt"])
  })

  it("rascunho noutro commit: recusa antes de publicar (a tag não se muda depois)", async () => {
    const g = github(rascunho({ targetCommitish: "2".repeat(40) }))
    const r = await publicar(g)
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/--target/)
    expect(g.comandos).toEqual(["view"])
    expect(g.estado()!.isDraft).toBe(true)
  })

  it("releases imutáveis desligadas no repositório: recusa antes de publicar", async () => {
    const g = github(rascunho(), { definicaoLigada: false })
    const r = await publicar(g)
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/desligadas/)
    expect(g.estado()!.isDraft).toBe(true)
  })

  it("publicada mas não imutável: recusa, e nada vai para o VPS", async () => {
    const g = github(rascunho(), { saiImutavel: false })
    const r = await publicar(g)
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/sem ser imutável/)
  })

  it("uma tag que já existe noutro commit, ou anotada, recusa ANTES de publicar (revisão N4)", async () => {
    for (const tagAntes of [
      { type: "commit", sha: "4".repeat(40) },
      { type: "tag", sha: ALVO },
    ]) {
      const g = github(rascunho(), { tagAntes })
      const r = await publicar(g)
      expect(r.ok).toBe(false)
      expect(r.porque).toMatch(/já existe/)
      expect(g.estado()!.isDraft).toBe(true)
      expect(g.comandos).not.toContain("edit")
    }
  })

  it("uma tag que já existe no commit certo deixa publicar", async () => {
    const g = github(rascunho(), { tagAntes: { type: "commit", sha: ALVO } })
    expect(await publicar(g)).toEqual({ ok: true, publicouAgora: true })
  })

  it("a tag publicada noutro commit: recusa", async () => {
    const g = github(rascunho(), { tagEm: "3".repeat(40) })
    const r = await publicar(g)
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/não aponta/)
  })

  it("sem release: recusa, e diz para enviar primeiro a cópia pública e usar --target", async () => {
    const g = github(null)
    const r = await publicar(g)
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/cópia pública/)
    expect(r.porque).toMatch(/--target/)
  })

  it("já publicada sem os ficheiros: recusa, porque já não se lhe junta nada", async () => {
    const g = github({ isDraft: false, publishedAt: "2026-11-19T10:00:00Z", targetCommitish: ALVO, ficheiros: {} })
    const r = await publicar(g)
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/imutável/)
  })

  it("já publicada com estes mesmos ficheiros (um envio repetido): segue, sem tentar mexer", async () => {
    const g = github({
      isDraft: false,
      publishedAt: "2026-11-19T10:00:00Z",
      targetCommitish: ALVO,
      ficheiros: { "actualizacao-windows.json": MANIFESTO, "somas-sha256.txt": SOMAS },
    })
    expect(await publicar(g)).toEqual({ ok: true, publicouAgora: false })
    expect(g.comandos.filter((c) => c === "upload" || c === "edit")).toEqual([])
  })

  it("já publicada com outro manifesto: recusa, e manda publicar uma versão nova", async () => {
    const g = github({
      isDraft: false,
      publishedAt: "2026-11-19T10:00:00Z",
      targetCommitish: ALVO,
      ficheiros: { "actualizacao-windows.json": OUTRO, "somas-sha256.txt": SOMAS },
    })
    const r = await publicar(g)
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/versão nova/)
  })

  it("as somas escrevem-se como o sha256sum, uma linha por instalador", () => {
    expect(textoDasSomas([{ soma: "f".repeat(64), nome: "a.exe" }, { soma: "e".repeat(64), nome: "b.dmg" }])).toBe(`${"f".repeat(64)}  a.exe\n${"e".repeat(64)}  b.dmg\n`)
  })
})

describe("uma versão publicada fica queimada (revisão M8)", () => {
  it("instaladores reconstruídos depois de publicados não passam; os mesmos, ou nada publicado, passam", async () => {
    // @ts-expect-error plain JavaScript script, no declarations
    const { instaladoresMudados } = await import("../../../scripts/instaladores.mjs")
    const agora = [{ nome: "a.exe", soma: "1".repeat(64) }, { nome: "b.dmg", soma: "2".repeat(64) }]
    expect(instaladoresMudados(null, agora)).toEqual([])
    expect(instaladoresMudados({ "a.exe": "1".repeat(64), "b.dmg": "2".repeat(64) }, agora)).toEqual([])
    expect(instaladoresMudados({ "a.exe": "9".repeat(64), "b.dmg": "2".repeat(64) }, agora)).toEqual([agora[0]])
  })
})

describe("a cadência do Windows: 72 h entre versões (revisão N3)", () => {
  it("recusa uma versão nova com a anterior a menos de 72 h, salvo urgente ou forçado", async () => {
    // @ts-expect-error plain JavaScript script, no declarations
    const { cadenciaDoWindows } = await import("../../../scripts/instaladores.mjs")
    const agora = Date.parse("2026-11-25T12:00:00Z")
    const anterior = (horas: number) => ({ tag: "v1.3.20", publicadaEm: new Date(agora - horas * 3_600_000).toISOString() })
    const r = cadenciaDoWindows({ anterior: anterior(71), agora, urgente: false, forcar: false })
    expect(r.ok).toBe(false)
    expect(r.porque).toMatch(/72 h/)
    expect(cadenciaDoWindows({ anterior: anterior(72), agora, urgente: false, forcar: false })).toEqual({ ok: true })
    expect(cadenciaDoWindows({ anterior: anterior(10), agora, urgente: true, forcar: false })).toEqual({ ok: true })
    expect(cadenciaDoWindows({ anterior: anterior(10), agora, urgente: false, forcar: true })).toEqual({ ok: true })
    expect(cadenciaDoWindows({ anterior: null, agora, urgente: false, forcar: false })).toEqual({ ok: true })
  })
})
