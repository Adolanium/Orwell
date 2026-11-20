import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { enderecoParaAbrirFora, podeAbrirFora } from "./links-externos.js"

/**
 * The links the window passes to the system browser.
 *
 * Since November 2, 2026, a YouTube video thumbnail is a link with
 * `target="_blank"`: on the desktop app that reaches `setWindowOpenHandler`,
 * which passes it to `shell.openExternal`. The address came from a message,
 * that is from someone else, and the system opens what it's given: a `file:`
 * runs a local file, a custom scheme opens another app. Only web URLs pass.
 */
describe("o que se abre no browser do sistema", () => {
  it("abre a web", () => {
    expect(podeAbrirFora("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true)
    expect(podeAbrirFora("http://exemplo.pt/artigo")).toBe(true)
  })

  it("recusa tudo o que não é a web", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "smb://servidor/partilha",
      "vscode://ficheiro",
      "data:text/html,<p>ola</p>",
      "isto não é um endereço",
      "",
    ]) {
      expect(podeAbrirFora(url), url).toBe(false)
    }
  })

  it("recusa credenciais no endereço: o anfitrião verdadeiro vem depois do @", () => {
    for (const url of [
      "https://www.youtube.com@mau.pt/",
      "https://www.youtube.com:@mau.pt/",
      "http://localhost:80@exemplo.pt/",
      "https://utilizador:senha@exemplo.pt/",
    ]) {
      expect(podeAbrirFora(url), url).toBe(false)
    }
  })

  it("recusa esquemas disfarçados com maiúsculas, espaços ou barras", () => {
    for (const url of ["FILE:///etc/passwd", " javascript:alert(1)", "file:\\\\servidor\\x", "https:", "http://"]) {
      expect(podeAbrirFora(url), url).toBe(false)
    }
  })

  it("entrega ao sistema o endereço lido, não o texto que veio da mensagem", () => {
    expect(enderecoParaAbrirFora("HTTPS://Exemplo.PT/a b")).toBe("https://exemplo.pt/a%20b")
    expect(enderecoParaAbrirFora("https:\\\\exemplo.pt\\x")).toBe("https://exemplo.pt/x")
    expect(enderecoParaAbrirFora('https://exemplo.pt/"&calc')).toBe("https://exemplo.pt/%22&calc")
    expect(enderecoParaAbrirFora("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    expect(enderecoParaAbrirFora("file:///etc/passwd")).toBeNull()
  })
})

describe("os links para esta app, no servidor da conta, não saem para o browser (1.3.25)", () => {
  /*
    An invite link carries a bearer secret in its fragment. In the system
    browser it would stay in that browser's history, and open a second copy of
    the app there. The interface opens these in the window; this is the rule
    for a click that still reaches `setWindowOpenHandler`.
  */
  const SERVIDOR = "orwell.pt"

  it("convite, amigo e mensagem do próprio servidor ficam cá", () => {
    for (const url of [
      "https://orwell.pt/c#abcd2345.0123456789abcdef",
      "https://orwell.pt/app/c#abcd2345.0123456789abcdef",
      "https://orwell.pt/app/convite#!sala%3Aorwell.pt/segredo",
      "https://orwell.pt/a#ana",
      "https://orwell.pt/app/a#ana",
      "https://orwell.pt/app/amigo#@ana:orwell.pt",
      "https://orwell.pt/app/m#m=!sala%3Aorwell.pt//m1",
      "https://ORWELL.pt/c#abcd2345.0123456789abcdef",
      "https://orwell.pt:443/a#ana",
    ]) {
      expect(enderecoParaAbrirFora(url, SERVIDOR), url).toBeNull()
    }
    expect(podeAbrirFora("https://orwell.pt/c#abcd2345.0123456789abcdef", "Orwell.PT.")).toBe(false)
  })

  it("o resto do próprio servidor, e os mesmos caminhos noutro servidor, saem como antes", () => {
    for (const url of [
      "https://orwell.pt/",
      "https://orwell.pt/privacidade",
      "https://orwell.pt/app/",
      "https://outro.pt/c#abcd2345.0123456789abcdef",
      "https://outro.pt/a#ana",
      "https://orwell.pt.mau.pt/c#abcd2345.0123456789abcdef",
    ]) {
      expect(enderecoParaAbrirFora(url, SERVIDOR), url).not.toBeNull()
    }
  })

  it("sem conta aberta, nada é \"da app\": a regra antiga mantém-se", () => {
    expect(podeAbrirFora("https://orwell.pt/c#abcd2345.0123456789abcdef")).toBe(true)
    expect(podeAbrirFora("https://orwell.pt/c#abcd2345.0123456789abcdef", null)).toBe(true)
  })

  it("o link de emparelhamento nunca sai, de servidor nenhum, com ou sem conta", () => {
    for (const servidor of [SERVIDOR, null]) {
      expect(enderecoParaAbrirFora("https://orwell.pt/app/emparelhar#segredo", servidor)).toBeNull()
      expect(enderecoParaAbrirFora("https://outro.pt/app/emparelhar#segredo", servidor)).toBeNull()
    }
  })

  it("loopback com porta conta como o servidor (desenvolvimento)", () => {
    expect(enderecoParaAbrirFora("http://localhost:8448/a#ana", "localhost:8448")).toBeNull()
    expect(enderecoParaAbrirFora("http://localhost:9999/a#ana", "localhost:8448")).not.toBeNull()
  })
})

describe("a política da janela principal", () => {
  /* The path is passed as a variable: see `toque.test.ts` in the interface. */
  const relativo = "./index.ts"
  const fonte = readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")

  it("não embebe nada: o leitor do YouTube saiu", () => {
    expect(fonte).toContain(`"frame-src 'none'"`)
    expect(fonte).not.toMatch(/frame-src https:/)
  })

  it("só entrega ao sistema o endereço que `enderecoParaAbrirFora` leu", () => {
    expect(fonte).toMatch(
      /setWindowOpenHandler\(\(\{ url \}\) => \{\s*const destino = enderecoParaAbrirFora\(url, servidorDaConta\(\)\)\s*if \(destino\) void shell\.openExternal\(destino\)/,
    )
    // And no other `openExternal` with raw text.
    expect(fonte).not.toMatch(/openExternal\(url\)/)
  })
})
