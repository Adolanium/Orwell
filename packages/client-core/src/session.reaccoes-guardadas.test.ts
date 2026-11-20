import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import type { StoredChatMessage, VaultContents } from "./vault.js"

/**
 * `reaccoesGuardadas` (B6, 1.3.25): every chat reaction the vault holds for a
 * channel, from both lists, in server order, without the inherited entries. The
 * interface folds the chips over this and memory, not over memory alone.
 */
const CANAL = "!lagar:casa.pt"
const linha = (seq: number): StoredChatMessage => ({ seq, sender: "@ana:casa.pt", at: seq, payload: { t: "message", id: `m-${seq}`, body: "olá" } as StoredChatMessage["payload"] })
const reaccao = (seq: number, quem: string, extra: Partial<StoredChatMessage> = {}): StoredChatMessage => ({
  seq,
  sender: quem,
  at: seq,
  payload: { t: "reaction", target: "m-1", emoji: "👍", remove: false } as StoredChatMessage["payload"],
  ...extra,
})

function ler(contents: Partial<VaultContents>, canal = CANAL): StoredChatMessage[] {
  return Session.prototype.reaccoesGuardadas.call({ vault: { contents } } as unknown as Session, canal)
}

describe("reaccoesGuardadas", () => {
  it("as 3 reacções de uma linha com 250 entradas depois vêm todas, por ordem do servidor", () => {
    const contents = {
      history: { [CANAL]: [linha(1), ...Array.from({ length: 250 }, (_, i) => linha(10 + i))] },
      estadoDoCanal: { [CANAL]: [reaccao(2, "@ana:casa.pt"), reaccao(3, "@bruno:casa.pt"), reaccao(4, "@carla:casa.pt")] },
    }
    expect(ler(contents).map((entrada) => entrada.sender)).toEqual(["@ana:casa.pt", "@bruno:casa.pt", "@carla:casa.pt"])
  })

  it("sem as herdadas do emparelhamento, e só deste canal", () => {
    const contents = {
      history: { [CANAL]: [linha(1)], "!outro:casa.pt": [reaccao(5, "@duda:casa.pt")] },
      estadoDoCanal: { [CANAL]: [reaccao(2, "@ana:casa.pt", { herdado: true } as Partial<StoredChatMessage>), reaccao(3, "@bruno:casa.pt")] },
    }
    expect(ler(contents).map((entrada) => entrada.sender)).toEqual(["@bruno:casa.pt"])
  })

  it("uma cópia, não o cofre: mexer no que volta não muda o cofre", () => {
    const contents = { history: {}, estadoDoCanal: { [CANAL]: [reaccao(2, "@ana:casa.pt")] } }
    const [primeira] = ler(contents)
    ;(primeira as StoredChatMessage).sender = "@outro:casa.pt"
    expect(contents.estadoDoCanal[CANAL][0]?.sender).toBe("@ana:casa.pt")
  })
})
