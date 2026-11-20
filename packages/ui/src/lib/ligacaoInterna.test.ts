import { describe, expect, it } from "vitest"
import { formatInviteLink, formatShortInviteLink, friendLink } from "@enclave/client-core"
import { lerLigacaoInterna } from "./ligacaoInterna.js"
import { ligacaoDaMensagem } from "./ligacaoDaMensagem.js"
import { ligacaoCurtaDeAmigo } from "./ligacaoDeAmigo.js"

/**
 * Which clicked links are ours to open in this window (1.3.25).
 *
 * Only invite, friend and message links on the account's own server. Each
 * one the app mints is read here as the flow it belongs to; anything else,
 * a link to another server included, is `null` and goes out as before.
 */

const SERVIDOR = "casa.pt"
const CANAL = "!sala:casa.pt"
const CODIGO_NOVO = "0123456789abcdef"

describe("as ligações que esta app cunha, no servidor da conta", () => {
  it("o convite curto, como se copia e depois do redireccionamento", () => {
    const curta = formatShortInviteLink(SERVIDOR, "ab23cd45", CODIGO_NOVO)
    expect(lerLigacaoInterna(curta, SERVIDOR)).toEqual({ tipo: "convite-curto", curta })
    // After Caddy's redirect, and with capitals typed by hand: the canonical form comes back.
    expect(lerLigacaoInterna(curta.replace("/c#", "/app/c#"), SERVIDOR)).toEqual({ tipo: "convite-curto", curta })
    expect(lerLigacaoInterna("https://casa.pt/c#AB23CD45.0123456789ABCDEF", SERVIDOR)).toEqual({ tipo: "convite-curto", curta })
  })

  it("o convite longo", () => {
    const longa = formatInviteLink(SERVIDOR, CANAL, "AbCdEfGhIjKlMnOpQrStUvWxYz012345")
    expect(lerLigacaoInterna(longa, SERVIDOR)).toEqual({
      tipo: "convite",
      convite: { server: SERVIDOR, channel: CANAL, code: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    })
  })

  it("o amigo, curto e longo", () => {
    const curta = ligacaoCurtaDeAmigo(SERVIDOR, "@ana:casa.pt")
    expect(lerLigacaoInterna(curta, SERVIDOR)).toEqual({ tipo: "amigo", address: "@ana:casa.pt" })
    expect(lerLigacaoInterna(curta.replace("/a#", "/app/a#"), SERVIDOR)).toEqual({ tipo: "amigo", address: "@ana:casa.pt" })
    expect(lerLigacaoInterna(friendLink(SERVIDOR, "@ana:casa.pt"), SERVIDOR)).toEqual({ tipo: "amigo", address: "@ana:casa.pt" })
  })

  it("o amigo de outro servidor, partilhado a partir do nosso, é nosso: o aviso é do fluxo que já existe", () => {
    const curta = ligacaoCurtaDeAmigo(SERVIDOR, "@rui:outro.pt")
    expect(lerLigacaoInterna(curta, SERVIDOR)).toEqual({ tipo: "amigo", address: "@rui:outro.pt" })
  })

  it("a mensagem", () => {
    const ligacao = ligacaoDaMensagem(SERVIDOR, "@ana:casa.pt", { channel: CANAL, room: "", id: "m1" })
    expect(lerLigacaoInterna(ligacao, SERVIDOR)).toEqual({ tipo: "mensagem", alvo: { channel: CANAL, room: "", id: "m1" } })
  })

  it("o servidor compara-se como o núcleo o compara: maiúsculas, ponto final, porta por omissão", () => {
    const curta = ligacaoCurtaDeAmigo(SERVIDOR, "@ana:casa.pt")
    expect(lerLigacaoInterna(curta, "CASA.pt.")?.tipo).toBe("amigo")
    expect(lerLigacaoInterna(curta.replace("casa.pt/", "casa.pt:443/"), SERVIDOR)?.tipo).toBe("amigo")
  })
})

describe("o que é nosso mas não se lê diz o que diria no arranque, e não sai", () => {
  it("convite, amigo e mensagem estragados", () => {
    expect(lerLigacaoInterna("https://casa.pt/c#estragado", SERVIDOR)).toEqual({ tipo: "convite-invalido" })
    expect(lerLigacaoInterna("https://casa.pt/app/convite#so-uma-parte", SERVIDOR)).toEqual({ tipo: "convite-invalido" })
    expect(lerLigacaoInterna("https://casa.pt/a#", SERVIDOR)).toEqual({ tipo: "amigo-invalido" })
    expect(lerLigacaoInterna("https://casa.pt/app/m#m=sem-partes", SERVIDOR)).toEqual({ tipo: "mensagem-invalida" })
    // The secret in the query is a link that already leaked: the core refuses it, and so do we.
    expect(lerLigacaoInterna("https://casa.pt/c?x=1#ab23cd45.0123456789abcdef", SERVIDOR)).toEqual({ tipo: "convite-invalido" })
  })
})

describe("o link de emparelhamento nunca abre (1.3.25)", () => {
  it("de qualquer servidor, e mesmo estragado", () => {
    for (const href of [
      "https://casa.pt/app/emparelhar#segredo",
      "https://outro.pt/app/emparelhar#segredo",
      "https://casa.pt/app/emparelhar",
    ]) {
      expect(lerLigacaoInterna(href, SERVIDOR), href).toEqual({ tipo: "emparelhamento" })
    }
  })
})

describe("o que não é nosso fica como estava", () => {
  it("outro servidor, outro caminho, outro esquema", () => {
    for (const href of [
      formatShortInviteLink("outro.pt", "ab23cd45", CODIGO_NOVO),
      ligacaoCurtaDeAmigo("outro.pt", "@ana:outro.pt"),
      "https://casa.pt.mau.pt/c#ab23cd45.0123456789abcdef",
      "https://casa.pt/",
      "https://casa.pt/app/",
      "https://casa.pt/privacidade",
      "https://exemplo.pt/artigo",
      "mailto:ana@casa.pt",
      "isto não é um endereço",
    ]) {
      expect(lerLigacaoInterna(href, SERVIDOR), href).toBeNull()
    }
  })

  it("credenciais no endereço não são nossas: o anfitrião verdadeiro vem depois do @", () => {
    expect(lerLigacaoInterna("https://casa.pt@mau.pt/c#ab23cd45.0123456789abcdef", SERVIDOR)).toBeNull()
    expect(lerLigacaoInterna("https://mau.pt@casa.pt/c#ab23cd45.0123456789abcdef", SERVIDOR)).toBeNull()
  })

  it("sem servidor, nada é nosso", () => {
    expect(lerLigacaoInterna(ligacaoCurtaDeAmigo(SERVIDOR, "@ana:casa.pt"), "")).toBeNull()
  })
})
