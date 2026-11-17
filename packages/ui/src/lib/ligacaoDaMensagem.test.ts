import { describe, expect, it } from "vitest"
import { CAMINHO_DA_MENSAGEM, lerLigacaoDaMensagem, ligacaoDaMensagem } from "./ligacaoDaMensagem.js"

describe("ligacaoDaMensagem", () => {
  it("põe o canal, a sala e a mensagem só no fragmento", () => {
    const link = ligacaoDaMensagem("orwell.pt", "@ana:orwell.pt", { channel: "c1", room: "r1", id: "m1" })
    expect(link).toBe(`https://orwell.pt${CAMINHO_DA_MENSAGEM}#m=c1/r1/m1`)
    expect(new URL(link).search).toBe("")
  })

  it("dá a volta completa, mesmo com barras e a sala por omissão", () => {
    const alvo = { channel: "a/b+c=", room: "", id: "x y/z" }
    const link = ligacaoDaMensagem("localhost:8452", "@ana:localhost:8452", alvo)
    expect(link.startsWith("http://localhost:8452/app/m#")).toBe(true)
    expect(lerLigacaoDaMensagem(new URL(link).hash)).toEqual(alvo)
  })

  it("recusa o que não é uma ligação de mensagem", () => {
    for (const mau of ["", "#x", "#m=", "#m=a/b", "#m=a/b/c/d", "#m=/b/c", "#m=a/b/", "#m=%E0%A4%A/b/c"]) {
      expect(lerLigacaoDaMensagem(mau), mau).toBeNull()
    }
  })
})
