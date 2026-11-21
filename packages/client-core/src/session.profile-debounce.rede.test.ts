import { randomBytes } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// The built package, like the harness: its sessions are the ones the test looks at.
import { Session } from "@enclave/client-core"

/**
 * Our profile goes out when the edits stop (1.3.26), against a real server.
 *
 * A name, then a portrait, then a status used to be three whole profiles in every
 * channel, each kept 30 days and downloaded by every device catching up. Now the
 * edits within `ESPERA_PARA_PUBLICAR_O_PERFIL_MS` of each other go out as one
 * version, once per channel, and an edit cut by a close goes out on the next opening.
 *
 * Ana has a portrait, so each profile she publishes is an application event bigger
 * than the portrait: the server's `events` table counts them without decrypting.
 */

let servidor: ServidorDeTeste
const abertas: { session: { disconnect(): void } }[] = []
const RETRATO = 30_000
const retrato = (): string => `data:image/png;base64,${Buffer.from(randomBytes(RETRATO)).toString("base64")}`

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  for (const conta of abertas.splice(0)) conta.session.disconnect()
  await servidor?.fechar()
})

/** Ana's whole profiles (events bigger than the portrait) in the channel after `desde`. */
function perfisInteiros(canal: string, desde: number): number {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    const linhas = base
      .prepare("SELECT length(ciphertext) AS bytes FROM events WHERE channel = ? AND kind = 'application' AND seq > ?")
      .all(canal, desde) as { bytes: number }[]
    return linhas.filter(({ bytes }) => bytes > (RETRATO * 4) / 3).length
  } finally {
    base.close()
  }
}

function ultimoSeq(canal: string): number {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    return (base.prepare("SELECT coalesce(max(seq), 0) AS seq FROM events WHERE channel = ?").get(canal) as { seq: number }).seq
  } finally {
    base.close()
  }
}

async function preparar(): Promise<{ ana: ContaDeTeste; bruno: ContaDeTeste; canais: string[] }> {
  const contas = await contasDeTeste(servidor, ["Ana", "Bruno"], { salaComum: false })
  abertas.push(...contas)
  const [ana, bruno] = contas as [ContaDeTeste, ContaDeTeste]
  await ana.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: retrato() })
  const canais = [await canalComTodos(servidor, ana, [bruno]), await canalComTodos(servidor, ana, [bruno])]
  await ate(() => bruno.vault.contents.directory[ana.address]?.payload["avatar"] !== undefined, "Bruno has Ana's portrait")
  // The edit above goes out too, and must not count below.
  await ate(() => !ana.session.perfilPorPublicar, "Ana's first profile went out", 15_000)
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  return { ana, bruno, canais }
}

const versaoEm = (conta: ContaDeTeste, de: ContaDeTeste): unknown => conta.vault.contents.directory[de.address]?.payload["updatedAt"]

describe("our profile goes out when the edits stop (1.3.26)", () => {
  it("three edits in under five seconds are one version, once per channel; this device shows each at once", async () => {
    expect(Session.ESPERA_PARA_PUBLICAR_O_PERFIL_MS).toBe(5_000)
    const { ana, bruno, canais } = await preparar()
    const marcas = canais.map(ultimoSeq)

    await ana.session.updateProfile({ ...ana.session.profile, displayName: "Ana Maria" })
    // This device shows it at once; nothing went out yet.
    expect(ana.session.profile.displayName).toBe("Ana Maria")
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await ana.session.updateProfile({ ...ana.session.profile, avatarDataUrl: retrato() })
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await ana.session.updateProfile({ ...ana.session.profile, statusText: "away for lunch" })
    expect(ana.session.profile.statusText).toBe("away for lunch")
    expect(canais.map((canal, i) => perfisInteiros(canal, marcas[i]!))).toEqual([0, 0])

    const versao = ana.session.profile.updatedAt
    await ate(() => versaoEm(bruno, ana) === versao, "Bruno gets the last version", 20_000)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const porCanal = canais.map((canal, i) => perfisInteiros(canal, marcas[i]!))
    console.log(`three edits: whole profiles per channel ${JSON.stringify(porCanal)}`)
    expect(porCanal).toEqual([1, 1])
    expect(bruno.vault.contents.directory[ana.address]?.payload["statusText"]).toBe("away for lunch")
    expect(ana.session.perfilPorPublicar).toBe(false)
  }, 120_000)

  it("an edit cut by closing the app goes out on the next opening", async () => {
    const { ana, bruno, canais } = await preparar()
    const marcas = canais.map(ultimoSeq)
    await ana.session.updateProfile({ ...ana.session.profile, statusText: "closing now" })
    const versao = ana.session.profile.updatedAt
    // Closed inside the wait: nothing went out, and the vault says so.
    ana.session.disconnect()
    expect(ana.vault.contents.perfilPorPublicar).toBe(versao)
    await new Promise((resolve) => setTimeout(resolve, Session.ESPERA_PARA_PUBLICAR_O_PERFIL_MS + 1_000))
    expect(canais.map((canal, i) => perfisInteiros(canal, marcas[i]!))).toEqual([0, 0])
    expect(versaoEm(bruno, ana)).not.toBe(versao)

    const reaberta = await recarregar(ana)
    abertas.push(reaberta)
    reaberta.session.loadIdentity()
    await reaberta.session.connect()
    await ate(() => versaoEm(bruno, ana) === versao, "Bruno gets the edit after Ana opens again", 20_000)
    expect(bruno.vault.contents.directory[ana.address]?.payload["statusText"]).toBe("closing now")
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(canais.map((canal, i) => perfisInteiros(canal, marcas[i]!))).toEqual([1, 1])
    expect(reaberta.vault.contents.perfilPorPublicar).toBeUndefined()
  }, 120_000)

  it("an edit whose every send failed still goes out on the next connection, by publishedProfileAt", async () => {
    const { ana, bruno, canais } = await preparar()
    await ana.session.updateProfile({ ...ana.session.profile, statusText: "sends failed" })
    const versao = ana.session.profile.updatedAt
    // Every channel send fails: the flag is cleared all the same, and no channel records the version.
    const enviar = ana.session.send.bind(ana.session)
    ana.session.send = async () => {
      throw new Error("the socket is stalled")
    }
    await ana.session.publicarPerfilPendente()
    ana.session.send = enviar
    expect(ana.vault.contents.perfilPorPublicar).toBeUndefined()
    for (const canal of canais) expect(ana.vault.contents.publishedProfileAt[canal]).not.toBe(versao)
    expect(versaoEm(bruno, ana)).not.toBe(versao)

    ana.session.disconnect()
    await ana.session.connect()
    await ate(() => versaoEm(bruno, ana) === versao, "Bruno gets the edit after Ana connects again", 20_000)
    for (const canal of canais) await ate(() => ana.vault.contents.publishedProfileAt[canal] === versao, `published in ${canal}`)
  }, 120_000)

  it("a close that asks first (lock, quit) sends the waiting edit before the socket goes", async () => {
    const { ana, bruno, canais } = await preparar()
    const marcas = canais.map(ultimoSeq)
    await ana.session.updateProfile({ ...ana.session.profile, statusText: "locking" })
    const versao = ana.session.profile.updatedAt
    await ana.session.publicarPerfilPendente()
    ana.session.disconnect()
    await ate(() => versaoEm(bruno, ana) === versao, "Bruno gets the edit sent before the lock")
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(canais.map((canal, i) => perfisInteiros(canal, marcas[i]!))).toEqual([1, 1])
  }, 120_000)
})
