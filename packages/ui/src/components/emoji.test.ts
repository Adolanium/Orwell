import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DESTINO, RAIZ, gerar } from "../../../../scripts/gerar-emojis.mjs"
import { CATEGORIES, findEmoji, fold, searchEmoji } from "./emoji.js"

const ALL = CATEGORIES.flatMap((category) => category.emojis)

describe("catálogo", () => {
  it("tem todas as categorias preenchidas", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0)
    for (const category of CATEGORIES) {
      expect(category.emojis.length, category.id).toBeGreaterThan(0)
    }
  })

  it("dá glifo e nome a cada entrada", () => {
    for (const emoji of ALL) {
      expect(emoji.char.length, emoji.name).toBeGreaterThan(0)
      expect(emoji.name.trim(), emoji.char).not.toBe("")
      // The name should never drag the synonym bar: if it does, the separator was
      // lost in editing and the screen reader would read garbage.
      expect(emoji.name).not.toContain("|")
    }
  })

  it("não repete glifos entre categorias", () => {
    // A repeated glyph appears twice in the grid and makes `findEmoji` depend on
    // order, classic sign of copy-paste between blocks.
    const seen = new Map<string, string>()
    for (const emoji of ALL) {
      expect(seen.get(emoji.char), `${emoji.char} repetido`).toBeUndefined()
      seen.set(emoji.char, emoji.name)
    }
  })

  it("encontra um glifo pelo próprio caracter", () => {
    expect(findEmoji("🙂")?.name).toBe("sorriso leve")
    expect(findEmoji("não é um emoji")).toBeUndefined()
  })
})

describe("fold", () => {
  it("tira acentos e maiúsculas", () => {
    expect(fold("Coração")).toBe("coracao")
    expect(fold("PÊSSEGO")).toBe("pessego")
    expect(fold("São Tomé")).toBe("sao tome")
  })
})

describe("searchEmoji", () => {
  it("devolve nada sem termo", () => {
    expect(searchEmoji("")).toEqual([])
    expect(searchEmoji("   ")).toEqual([])
  })

  it("procura sem exigir acentos", () => {
    const chars = searchEmoji("coracao").map((emoji) => emoji.char)
    expect(chars).toContain("❤️")
  })

  it("procura pelo nome escrito com acentos", () => {
    expect(searchEmoji("café").map((emoji) => emoji.char)).toContain("☕")
  })

  it("encontra por sinónimo e não só pelo nome", () => {
    // "imperial" is not the name of any emoji, it's what you say in Portuguese
    // when you order a beer, and that's why synonyms exist.
    expect(searchEmoji("imperial").map((emoji) => emoji.char)).toContain("🍺")
  })

  it("põe o prefixo do nome à frente do que só bate a meio", () => {
    const first = searchEmoji("cora")[0]
    expect(fold(first?.name ?? "").startsWith("cora")).toBe(true)
  })

  it("não passa do limite pedido", () => {
    expect(searchEmoji("a", 5).length).toBe(5)
  })

  it("devolve vazio para um termo que não existe", () => {
    expect(searchEmoji("zzzzzzq")).toEqual([])
  })
})

describe("catálogo completo (Unicode 15.0)", () => {
  it("tem os emojis de cada categoria, sem tons de pele nem componentes", () => {
    const counts = Object.fromEntries(CATEGORIES.map((category) => [category.id, category.emojis.length]))
    expect(counts).toEqual({
      rostos: 166,
      gestos: 363,
      natureza: 152,
      comida: 133,
      actividades: 85,
      viagens: 218,
      objectos: 261,
      simbolos: 223,
      bandeiras: 269,
    })
    expect(ALL.length).toBe(1870)
    expect(ALL.some((emoji) => /[\u{1F3FB}-\u{1F3FF}]/u.test(emoji.char))).toBe(false)
  })

  it("não repete glifos nem com o selector de variação posto ou tirado", () => {
    const bases = new Set(ALL.map((emoji) => emoji.char.replace(/\uFE0F/g, "")))
    expect(bases.size).toBe(ALL.length)
  })

  it("mantém o nome à mão em vez do nome do CLDR", () => {
    expect(findEmoji("🍺")?.name).toBe("cerveja")
    expect(findEmoji("🙂")?.name).toBe("sorriso leve")
  })

  it("dá nome em português a quem não tem nome à mão", () => {
    expect(findEmoji("🫨")?.name).toBe("cara a abanar")
  })

  it("tem sequências ZWJ", () => {
    expect(findEmoji("👩\u200D🚀")?.name).toMatch(/astronauta/)
    expect(findEmoji("🧑\u200D🚒")?.name).toBe("bombeiro")
    expect(ALL.filter((emoji) => emoji.char.includes("\u200D")).length).toBeGreaterThan(100)
  })

  it("tem bandeiras de países e a de subdivisão (Inglaterra)", () => {
    const england = "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"
    const flags = CATEGORIES.find((category) => category.id === "bandeiras")?.emojis ?? []
    expect(flags.map((emoji) => emoji.char)).toContain(england)
    expect(findEmoji(england)?.name).toMatch(/Inglaterra/)
    expect(findEmoji("🇵🇹")?.name).toBe("portugal")
  })

  it("encontra um glifo guardado sem o selector de variação (recentes antigos)", () => {
    expect(findEmoji("❤")?.char).toBe("❤️")
  })

  it("procura em português", () => {
    expect(searchEmoji("gato")[0]?.name).toMatch(/gato/)
    expect(searchEmoji("coracao").map((emoji) => emoji.char)).toContain("❤️")
    expect(searchEmoji("bandeira portugal").map((emoji) => emoji.char)).toContain("🇵🇹")
    expect(searchEmoji("portugal bandeira").map((emoji) => emoji.char)).toContain("🇵🇹")
  })

  it("procura em inglês, com o nome ainda em português", () => {
    const cat = searchEmoji("cat")
    expect(cat.map((emoji) => emoji.char)).toContain("🐈")
    expect(cat[0]?.name).toMatch(/gato/)
    const heart = searchEmoji("heart").map((emoji) => emoji.char)
    expect(heart).toContain("❤️")
    expect(heart).toContain("💖")
    expect(searchEmoji("england").map((emoji) => emoji.name)).toContain("bandeira: Inglaterra")
  })

  it("o ficheiro gerado está em dia com os dados (senão: node scripts/gerar-emojis.mjs)", () => {
    expect(readFileSync(`${RAIZ}/${DESTINO}`, "utf8") === gerar()).toBe(true)
  })
})
