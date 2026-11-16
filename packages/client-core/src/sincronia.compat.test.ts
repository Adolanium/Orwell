import { decodePayload, encodePayload, Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ArmazemDeMedia } from "./armazem/armazem.js"
import { ArmazemEmMemoria } from "./armazem/emMemoria.js"
import { absorverPayload, bytesDoMedia, inflarPayload } from "./armazem/referencias.js"
import { chaveDoEvento } from "./dobras.js"
import { entradaValida, mediaInteiraDe, paginaDe, TECTOS_DO_HISTORICO, type InflarParaOIrmao } from "./historico/conteudo.js"
import { CAPACIDADE_PEDE_PERFIS, CAPACIDADE_REENVIO } from "./session.js"
import { entradasDoCanal, fundirEntradasDoIrmao, juntarMediaDoIrmao, newVaultContents, type StoredPayload, type VaultContents } from "./vault.js"

/**
 * Sync phase S1 and a 0.5.7 client (§4.6 of the plan).
 *
 * No new field on the wire: the resend announcement and profile request go in
 * the `capacidades` field of `typing`, which already exists from phase 5. A
 * 0.5.7 reads `typing` with its schema, which lacks the field and is not
 * `strict()`: discards it and the payload passes. A payload that passes does
 * not count as deafness (`DEAF_FAILURES`), and an expired `typing` does not
 * show.
 */
describe("o sinal de aparelho de S1 num cliente 0.5.7", () => {
  /** The `typing` as 0.5.7 reads it. Copied from that version's schema (see `estado.test.ts` in the protocol). */
  const TypingAntigo = z.object({ t: z.literal("typing"), room: z.string().max(64).optional(), until: z.number().int().nonnegative() })

  it("o anúncio do reenvio e o pedido de perfis passam no esquema novo e no antigo", () => {
    const sinal = {
      t: "typing" as const,
      until: 0,
      capacidades: ["estado-da-conta", "chave-de-conta", CAPACIDADE_REENVIO, CAPACIDADE_PEDE_PERFIS],
    }
    expect(decodePayload(encodePayload(sinal))).toEqual(sinal)
    const lido = TypingAntigo.safeParse(JSON.parse(new TextDecoder().decode(encodePayload(sinal))))
    expect(lido.success).toBe(true)
    expect(lido.data).toEqual({ t: "typing", until: 0 })
  })

  it("as capacidades novas cabem no tecto do campo (16 nomes, 32 caracteres cada)", () => {
    for (const nome of [CAPACIDADE_REENVIO, CAPACIDADE_PEDE_PERFIS]) expect(nome.length).toBeLessThanOrEqual(32)
  })
})

/**
 * A 1.3 sibling (no store) and a new one, on the same account (media-store design). The wire
 * between siblings does not change: the new one sends `inline` or `evicted`,
 * never `{ ref }`, which the 1.3 interface drew as an empty `img src`. The old
 * sibling is built with today's types: the vault without `media`, and the
 * functions it already had (`fundirEntradasDoIrmao`, `juntarMediaDoIrmao`)
 * reading what the new one sends.
 */
describe("um irmão 1.3 lê o histórico de um irmão novo", () => {
  const PREFIXO = "data:image/png;base64,"
  const anexo = (nome: string, n: number) => ({ name: nome, mediaType: "image/png", byteLength: n, kind: "image", inline: `${PREFIXO}${"B".repeat(n)}` })
  const mensagem = (id: string, anexos: unknown[]) =>
    Payload.parse({ t: "message", id, sentAt: 1, body: id, attachments: anexos }) as StoredPayload

  /** Each attachment as 1.3 draws it: with the `inline`, or the `evicted` marker. Nothing else. */
  function desenhavel(payload: StoredPayload): boolean {
    const anexos = (payload["attachments"] ?? []) as Record<string, unknown>[]
    return anexos.every((a) => !("ref" in a) && ((typeof a["inline"] === "string" && a["inline"].length > 0) || a["evicted"] === true))
  }

  it("a página e os media: o pequeno com o texto, o grande depois, os dois desenháveis e iguais aos de sempre", async () => {
    const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
    await armazem.abrir()
    const pequena = mensagem("mensagem-pequena", [anexo("p.png", 400)])
    const grande = mensagem("mensagem-grande", [anexo("g.png", TECTOS_DO_HISTORICO.mediaComOTexto + 400)])
    const novo = newVaultContents()
    novo.history["!c"] = [pequena, grande].map((payload, i) => ({ seq: i + 1, sender: "@a:x", at: i + 1, payload: absorverPayload(novo, payload, armazem) }))
    await armazem.drenar()
    const inflar: InflarParaOIrmao = {
      payload: (payload, opcoes) => inflarPayload(novo, payload, armazem, opcoes ?? {}),
      bytes: (sha) => bytesDoMedia(novo, sha, armazem),
    }
    // What goes out on the wire: JSON.
    const pagina = JSON.parse(JSON.stringify(await paginaDe(novo, "!c", null, inflar))) as Awaited<ReturnType<typeof paginaDe>>

    // The 1.3 sibling stores the page as it used to.
    const antigo: VaultContents = newVaultContents()
    expect(pagina.e.every(entradaValida)).toBe(true)
    expect(fundirEntradasDoIrmao(antigo, "!c", pagina.e)).toBe(2)
    for (const entrada of entradasDoCanal(antigo, "!c")) expect(desenhavel(entrada.payload)).toBe(true)
    const [comTexto, semBytes] = entradasDoCanal(antigo, "!c").map((e) => (e.payload["attachments"] as Record<string, unknown>[])[0]!)
    expect(comTexto!["inline"]).toBe(anexo("p.png", 400).inline)
    expect(semBytes).toEqual({ evicted: true, name: "g.png", mediaType: "image/png" })

    // And asks for the large one, which arrives whole.
    const e = chaveDoEvento(entradasDoCanal(antigo, "!c")[1]!)!
    const resposta = JSON.parse(JSON.stringify(await mediaInteiraDe(novo, "@a:x", [{ c: "!c", e }], inflar))) as Awaited<ReturnType<typeof mediaInteiraDe>>
    expect(JSON.stringify(resposta)).not.toMatch(/"ref"/)
    const [item] = resposta.itens as { c: string; e: string; p: StoredPayload }[]
    expect(juntarMediaDoIrmao(antigo, "!c", item!.e, item!.p)).toBe(true)
    const final = entradasDoCanal(antigo, "!c")[1]!.payload
    expect(desenhavel(final)).toBe(true)
    expect((final["attachments"] as Record<string, unknown>[])[0]!["inline"]).toBe(anexo("g.png", TECTOS_DO_HISTORICO.mediaComOTexto + 400).inline)
  })
})
