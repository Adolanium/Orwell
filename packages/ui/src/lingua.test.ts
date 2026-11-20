import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  aoMudarLingua,
  CHAVE_DA_LINGUA,
  definirLingua,
  detectarLingua,
  escolherLingua,
  guardarPreferencia,
  lerPreferencia,
  linguaActual,
  linguaDoSistema,
  linguaNoEndereco,
  LINGUA_BASE,
  strings,
  translateError,
} from "./strings.js"

/**
 * The language: who chooses it, what happens when text is missing, and the
 * default.
 *
 * The rule of the owner (20/11/2026): English is the default. The app opens in
 * Portuguese only when the system or browser is in Portuguese (`pt`, `pt-PT`,
 * `pt-BR`...). Any other language opens in English. The explicit choice of the
 * person always wins.
 *
 * The suite reads Portuguese because `testes/lingua-de-teste.ts` asks for it.
 * The default itself is `LINGUA_BASE`, measured below.
 */

// Each case leaves the language as the setup file left it: Portuguese.
afterEach(() => {
  definirLingua("pt")
  localStorage.removeItem(CHAVE_DA_LINGUA)
})

describe("a língua por omissão", () => {
  it("é o inglês: a base do módulo, antes de o anfitrião arrancar a língua", () => {
    expect(LINGUA_BASE).toBe("en")
  })

  it("o `lang` fixo das páginas é inglês", () => {
    for (const pagina of ["../../../apps/web/index.html", "../../../apps/client/src/renderer/index.html"]) {
      const html = readFileSync(join(AQUI, pagina), "utf8")
      expect(html, pagina).toMatch(/<html lang="en"/)
    }
  })
})

describe("escolherLingua — a ordem de quem manda", () => {
  /*
    Since 1.3.9 (12/11/2026): the interface opens in English until the
    person chooses another language. The browser and the system no longer count.
    Only the address (`?lingua=`) and the saved choice do.
  */
  it("o endereço ganha a tudo", () => {
    expect(escolherLingua({ doEndereco: "en", guardada: "pt" })).toBe("en")
    expect(escolherLingua({ doEndereco: "pt", guardada: "en" })).toBe("pt")
  })

  it("depois do endereço, a escolha guardada", () => {
    expect(escolherLingua({ guardada: "pt" })).toBe("pt")
    expect(escolherLingua({ guardada: "en" })).toBe("en")
  })

  it("sem escolha, inglês", () => {
    expect(escolherLingua({})).toBe("en")
    expect(escolherLingua({ guardada: "auto" })).toBe("en")
    expect(escolherLingua({ doEndereco: "klingon" })).toBe("en")
    expect(escolherLingua({ doEndereco: "pt-PT" })).toBe("pt")
  })
})

describe("o sistema conta: português só quando a primeira língua é português (20/11/2026)", () => {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "languages")
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "languages", { ...original, configurable: true })
    delete (navigator as unknown as Record<string, unknown>)["languages"]
  })

  it.each([
    [["de-DE", "de"], "en"],
    [["pt-BR"], "pt"],
    [["pt-PT", "pt"], "pt"],
    [["pt"], "pt"],
    [["fr"], "en"],
    [["en-US"], "en"],
    [["de-DE", "pt-PT"], "en"],
    [[], "en"],
  ] as const)("sistema %j dá %s", (sistema, esperada) => {
    expect(linguaDoSistema(sistema)).toBe(esperada)
    expect(escolherLingua({ doSistema: sistema })).toBe(esperada)
  })

  it("um browser em alemão abre em inglês", () => {
    Object.defineProperty(navigator, "languages", { value: ["de-DE", "de"], configurable: true })
    expect(detectarLingua({ endereco: "http://localhost/app/" })).toBe("en")
  })

  it("um browser em português abre em português", () => {
    Object.defineProperty(navigator, "languages", { value: ["pt-BR", "en"], configurable: true })
    expect(detectarLingua({ endereco: "http://localhost/app/" })).toBe("pt")
  })

  it("a lista do anfitrião (Electron) ganha ao `navigator`", () => {
    Object.defineProperty(navigator, "languages", { value: ["en-US"], configurable: true })
    expect(detectarLingua({ endereco: "http://localhost/app/", sistema: ["pt-PT"] })).toBe("pt")
    expect(detectarLingua({ endereco: "http://localhost/app/", sistema: ["de-DE"] })).toBe("en")
  })

  it("a escolha guardada ganha ao sistema, nos dois sentidos", () => {
    Object.defineProperty(navigator, "languages", { value: ["pt-PT"], configurable: true })
    guardarPreferencia("en")
    expect(detectarLingua({ endereco: "http://localhost/app/" })).toBe("en")
    Object.defineProperty(navigator, "languages", { value: ["de-DE"], configurable: true })
    guardarPreferencia("pt")
    expect(detectarLingua({ endereco: "http://localhost/app/" })).toBe("pt")
  })

  it("com `?lingua=pt`, português, sem guardar nada", () => {
    Object.defineProperty(navigator, "languages", { value: ["de-DE"], configurable: true })
    expect(detectarLingua({ endereco: "http://localhost/app/?lingua=pt" })).toBe("pt")
    expect(lerPreferencia()).toBe("auto")
  })

  it("arrancar sem escolha num browser alemão dá inglês", async () => {
    const { arrancarLingua } = await import("./strings.js")
    Object.defineProperty(navigator, "languages", { value: ["de-DE"], configurable: true })
    expect(arrancarLingua({ endereco: "http://localhost/app/" })).toBe("en")
    expect(strings.menu.leave).toBe("Leave the channel")
  })

  it("arrancar sem escolha num browser em português dá português", async () => {
    const { arrancarLingua } = await import("./strings.js")
    definirLingua("en")
    Object.defineProperty(navigator, "languages", { value: ["pt-PT"], configurable: true })
    expect(arrancarLingua({ endereco: "http://localhost/app/" })).toBe("pt")
    expect(strings.menu.leave).toBe("Sair do canal")
  })
})

describe("o parâmetro do endereço — a porta por onde os guiões pedem", () => {
  it("lê-se de um endereço inteiro", () => {
    expect(linguaNoEndereco("http://127.0.0.1:5173/app/?lingua=pt")).toBe("pt")
    expect(linguaNoEndereco("http://127.0.0.1:5173/app/?lingua=en#/algures")).toBe("en")
  })

  it("e a ausência dele não é um erro", () => {
    expect(linguaNoEndereco("http://127.0.0.1:5173/app/")).toBeUndefined()
    expect(linguaNoEndereco("nada disto é um endereço")).toBeUndefined()
  })
})

describe("mudar de língua", () => {
  it("troca o texto todo de uma vez", () => {
    definirLingua("en")
    expect(strings.menu.leave).toBe("Leave the channel")
    expect(strings.sidebar.newRoom).toBe("New room")
    expect(strings.gate.create).toBe("Create account")
  })

  it("as funções continuam a montar-se, com a mesma assinatura", () => {
    definirLingua("en")
    expect(strings.sidebar.hiddenRooms(1)).toBe("1 hidden room")
    expect(strings.sidebar.hiddenRooms(4)).toBe("4 hidden rooms")
    expect(strings.memberRoles.title("Direcção")).toBe("Roles in Direcção")
  })

  it("e voltar atrás devolve o português, sem restos", () => {
    definirLingua("en")
    definirLingua("pt")
    expect(strings.menu.leave).toBe("Sair do canal")
    expect(strings.sidebar.hiddenRooms(4)).toBe("4 salas escondidas")
  })

  it("avisa quem estiver à escuta, e só quando muda mesmo", () => {
    let avisos = 0
    const largar = aoMudarLingua(() => (avisos += 1))
    definirLingua("en")
    expect(avisos).toBe(1)
    definirLingua("en")
    expect(avisos, "definir a mesma língua não é uma mudança").toBe(1)
    definirLingua("pt")
    expect(avisos).toBe(2)
    largar()
    definirLingua("en")
    expect(avisos, "quem largou deixa de ser avisado").toBe(2)
  })
})

describe("o que falta cai para português, e nunca para uma chave em cru", () => {
  it("uma língua sem uma folha usa a portuguesa dessa folha", () => {
    // Proved with an overlay of fake data instead of a hole in real English:
    // English is complete today, and a test that relied on it being incomplete
    // would die the day someone finished the translation.
    const junta = juntarComoOModulo({ menu: { leave: "Leave" } })
    expect(junta.menu.leave).toBe("Leave")
    expect(junta.menu.remove, "o que a sobreposição não diz fica em português").toBe("Eliminar canal")
  })

  it("e nenhuma folha do catálogo é indefinida em nenhuma das línguas", () => {
    for (const lingua of ["pt", "en"] as const) {
      definirLingua(lingua)
      const vazias = folhasVazias(strings, "")
      expect(vazias, `folhas sem texto em ${lingua}:\n${vazias.join("\n")}`).toEqual([])
    }
  })
})

describe("a escolha guardada", () => {
  it('sem nada escrito, é "auto"', () => {
    expect(lerPreferencia()).toBe("auto")
  })

  it("guarda-se e volta a ler-se", () => {
    guardarPreferencia("en")
    expect(lerPreferencia()).toBe("en")
    guardarPreferencia("auto")
    expect(lerPreferencia()).toBe("auto")
  })

  it("lixo lê-se como ausência, e não impede a aplicação de abrir", () => {
    localStorage.setItem(CHAVE_DA_LINGUA, "{isto não é uma língua}")
    expect(lerPreferencia()).toBe("auto")
  })

  it("um armazenamento que atira não leva a aplicação com ele", () => {
    const partido = {
      getItem(): string {
        throw new Error("bloqueado")
      },
      setItem(): void {
        throw new Error("bloqueado")
      },
    }
    expect(lerPreferencia(partido)).toBe("auto")
    expect(() => guardarPreferencia("en", partido)).not.toThrow()
  })
})

describe("translateError — o único recurso que não é o português", () => {
  it("em português, diz a frase portuguesa", () => {
    expect(translateError("vault is locked")).toBe("Erro 101\nO cofre está bloqueado.")
  })

  it("em inglês, diz a frase inglesa e não a portuguesa", () => {
    definirLingua("en")
    expect(translateError("vault is locked")).toBe("Error 101\nThe vault is locked.")
  })

  it("o que não conhece é o 900 na língua de quem lê, com a mensagem em cru por baixo", () => {
    expect(translateError("something else entirely")).toBe("Erro 900\nAconteceu um erro que a app não conhece.\nsomething else entirely")
    definirLingua("en")
    expect(translateError("something else entirely")).toBe("Error 900\nThe app does not know this error.\nsomething else entirely")
  })
})

describe('"auto" guardado volta a seguir o sistema', () => {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "languages")
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "languages", { ...original, configurable: true })
    delete (navigator as unknown as Record<string, unknown>)["languages"]
  })

  it("num sistema alemão, escolher português e depois \"auto\" dá inglês", async () => {
    Object.defineProperty(navigator, "languages", { value: ["de-DE"], configurable: true })
    const { aplicarEscolhaDeLingua } = await import("./hooks/useLingua.js")
    aplicarEscolhaDeLingua("pt")
    expect(linguaActual()).toBe("pt")
    aplicarEscolhaDeLingua("auto")
    expect(linguaActual()).toBe("en")
  })

  it("num sistema em português, escolher inglês e depois \"auto\" dá português", async () => {
    Object.defineProperty(navigator, "languages", { value: ["pt-PT"], configurable: true })
    const { aplicarEscolhaDeLingua } = await import("./hooks/useLingua.js")
    aplicarEscolhaDeLingua("en")
    expect(linguaActual()).toBe("en")
    aplicarEscolhaDeLingua("auto")
    expect(linguaActual()).toBe("pt")
  })
})

/* ------------------------------------------------------------------ ferramentas */

const AQUI = dirname(fileURLToPath(import.meta.url))

/** The same merge the module does, over a sample overlay. */
function juntarComoOModulo(porCima: Record<string, unknown>): typeof strings {
  const juntar = (base: unknown, cima: unknown): unknown => {
    if (cima === undefined) return base
    if (typeof cima === "function" || Array.isArray(cima)) return cima
    if (typeof base !== "object" || base === null || Array.isArray(base)) return cima
    if (typeof cima !== "object" || cima === null) return cima
    const saida: Record<string, unknown> = {}
    for (const [chave, valor] of Object.entries(base as Record<string, unknown>)) {
      saida[chave] = juntar(valor, (cima as Record<string, unknown>)[chave])
    }
    return saida
  }
  return juntar(strings, porCima) as typeof strings
}

/** Screens that would reach the display empty, another name for a raw key. */
function folhasVazias(valor: unknown, caminho: string): string[] {
  if (typeof valor === "string") return valor.length > 0 ? [] : [caminho]
  if (typeof valor === "function") return []
  if (Array.isArray(valor)) return valor.flatMap((item, i) => folhasVazias(item, `${caminho}[${i}]`))
  if (valor && typeof valor === "object") {
    return Object.entries(valor).flatMap(([chave, dentro]) =>
      folhasVazias(dentro, caminho ? `${caminho}.${chave}` : chave),
    )
  }
  return [caminho]
}
