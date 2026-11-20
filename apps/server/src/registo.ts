/**
 * Who may create an account, on the server side (1.3.25, abuse brake).
 *
 * C2, the rule: `ENCLAVE_REGISTO` (`config.ts`) and the check at the first
 * `auth.finish` (`Store.entrarOuRegistar`, called by the gateway). See
 * `registo.ts` in the protocol for the three modes.
 *
 * C1, the count: `GET /_interno/registo`, how many accounts this server
 * created in the last hour and in the last 24 hours. Numbers only, never an
 * address. The Mac's `infra-alerts` reads it once an hour over SSH, from inside
 * the container, and warns on Telegram on a spike.
 *
 * **Why the count is only for loopback, and outside `/_enclave/`.** Caddy
 * forwards `/_enclave/*` to this process, so anything there is on the
 * internet. `/_interno/` is not forwarded: Caddy's last `handle` serves files
 * from `/srv` and answers 404. And the route itself checks the SOCKET's
 * address, never `request.ip`: `request.ip` reads X-Forwarded-For from the
 * proxies we trust (`PROXIES_DE_CONFIANCA`), and Caddy is one of them, so a
 * forged header would turn into "127.0.0.1". Two locks, each enough alone.
 *
 * **Why invites are made by a script, not by a route.** A route that makes
 * codes needs an operator secret on the server and is one more door on the
 * internet. The script (`scripts/convites-de-registo.mjs`) writes the hash
 * straight into the database over SSH, as `denuncias.mjs` already does, and
 * the code exists in clear only in the operator's terminal.
 */
import { normalizarConviteDeRegisto, type ModoDeRegisto } from "@enclave/protocol"
import type { FastifyInstance } from "fastify"
import { createHash, randomBytes } from "node:crypto"
import { currentMinute } from "./db.js"
import type { Store } from "./store.js"

/** Crockford's base32: no I, L, O or U, so a code read aloud is not misheard. 32 symbols, so a byte & 31 is unbiased. */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * A new code: 16 symbols, 80 bits, as `K7QM-2XRA-9DTB-W4HE`.
 *
 * 80 bits make guessing pointless even online: each try costs a fresh
 * challenge and a signature, and there are 2^80 codes per real one. That is why
 * a plain SHA-256 is enough for the hash, with no slow KDF: a slow hash
 * protects LOW-entropy secrets, and this one is not.
 */
export function gerarConviteDeRegisto(): string {
  const bytes = randomBytes(16)
  let codigo = ""
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % 4 === 0) codigo += "-"
    codigo += ALFABETO[bytes[i]! & 31]
  }
  return codigo
}

/** The SHA-256, in hex, of the code in its canonical form. The script computes the same. */
export function hashDoConviteDeRegisto(codigo: string): string {
  return createHash("sha256").update(normalizarConviteDeRegisto(codigo), "utf8").digest("hex")
}

/** What `GET /_interno/registo` answers. Version 1. */
export interface ContagemDoRegisto {
  v: 1
  modo: ModoDeRegisto
  /** Accounts created in the last 60 minutes, this one included. */
  ultimaHora: number
  /** Accounts created in the last 24 hours. */
  ultimas24h: number
  /** The minute (Unix minutes) of the count. */
  minuto: number
}

export function contagemDoRegisto(store: Store, modo: ModoDeRegisto, agora = currentMinute()): ContagemDoRegisto {
  return {
    v: 1,
    modo,
    ultimaHora: store.contasCriadasDesde(agora - 59),
    ultimas24h: store.contasCriadasDesde(agora - 24 * 60 + 1),
    minuto: agora,
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

/** Registers `GET /_interno/registo`. Anyone not on loopback gets the same 404 as a path that does not exist. */
export function registarContagemDoRegisto(app: FastifyInstance, store: Store, modo: ModoDeRegisto): void {
  app.get("/_interno/registo", async (pedido, resposta) => {
    if (!LOOPBACK.has(pedido.raw.socket.remoteAddress ?? "")) {
      resposta.callNotFound()
      return resposta
    }
    resposta.header("Cache-Control", "no-store")
    return contagemDoRegisto(store, modo)
  })
}
