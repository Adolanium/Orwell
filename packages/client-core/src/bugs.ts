import { CorpoDoBug, ROTA_DOS_BUGS, type Identity } from "@enclave/protocol"
import { assinarPedido } from "./denuncia.js"

/**
 * "Report a bug" (12/11/2026), from the caller's side: the body checked by the
 * schema, signed by this device, posted to the account server.
 *
 * The schema is `.strict()`: a field the form did not show is refused here, before
 * it leaves the device, and again on the server. Errors are keys from
 * `lib/codigosDeErro.ts` of the interface.
 */
export async function enviarBug(origem: string, identidade: Identity, corpo: unknown, buscar: typeof fetch = fetch): Promise<{ ok: true }> {
  const lido = CorpoDoBug.safeParse(corpo)
  if (!lido.success) throw new Error("the bug report is not valid")
  const pedido = assinarPedido(identidade, ROTA_DOS_BUGS, lido.data)
  let resposta: Response
  try {
    resposta = await buscar(`${origem}${ROTA_DOS_BUGS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pedido),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
  } catch {
    throw new Error("could not reach the homeserver")
  }
  if (resposta.status === 429) throw new Error("too many bug reports sent")
  if (resposta.status === 401) {
    const erro = await resposta.json().catch(() => undefined)
    if ((erro as { error?: unknown } | undefined)?.error === "stale-request") throw new Error("the device clock is off")
  }
  if (!resposta.ok) throw new Error("the server did not take the bug report")
  return { ok: true }
}
