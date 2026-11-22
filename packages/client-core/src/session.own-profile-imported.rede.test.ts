import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { ArmazemEmMemoria, Session, Vault } from "@enclave/client-core"

/**
 * The own profile on a device that came in by importing the account file
 * (hotfix 1.3.26-2, 22/11/2026).
 *
 * The imported device is born with the profile the file carried. A newer
 * profile that another device of the account published reached it only through
 * the account channel: in a room, live or in a catch-up, our own `profile`
 * went to the directory and never to `contents.profile`. So a device that was
 * not (yet) in the account channel kept the old name for ever.
 *
 * What this holds: a profile of our own account, from another device of the
 * account and newer (`updatedAt`), is adopted by any path; the device then
 * republishes the NEW version, never the old one.
 */

const FRASE = "frase-passe-de-teste"

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => {
  desligarContas(abertas.splice(0))
})
afterAll(async () => {
  await servidor?.fechar()
})

async function importar(ficheiro: Uint8Array, nome: string): Promise<ContaDeTeste> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend)
  const armazem = new ArmazemEmMemoria()
  const session = new Session(vault, { armazem })
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  await vault.importVault(ficheiro, FRASE, { passagem: (pedido) => session.passagemDoImportar(pedido) })
  await vault.unlock(FRASE)
  const identidade = session.loadIdentity()
  await session.connect()
  return { nome, session, vault, backend, armazem, address: identidade.address, avisos }
}

/**
 * A newer profile on `aparelho`, published in `canal` ONLY: the account channel
 * does not carry it, which is the path the imported device used to miss.
 */
async function perfilNovoSoNoCanal(aparelho: ContaDeTeste, canal: string, displayName: string): Promise<number> {
  const updatedAt = Date.now()
  await aparelho.vault.update((contents) => {
    contents.profile = { displayName, donations: [], updatedAt }
  })
  expect(await aparelho.session.publishProfile([canal])).toEqual([])
  return updatedAt
}

function nomeNoDirectorio(conta: ContaDeTeste, address: string): unknown {
  return conta.vault.contents.directory[address]?.payload["displayName"]
}

describe("the own profile on an imported device", () => {
  it("adopts a newer own profile heard in a room, live and in a catch-up, and republishes only the new one", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"], { salaComum: false })
    abertas.push(ana!, bruno!)
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ate(() => telemovel.session.channels.includes(canal), "the phone is in the room", 60_000, 250)

    // The file carries the profile "Ana".
    await ana!.session.flush()
    const ficheiro = await ana!.vault.exportVault()
    const novo = await importar(ficheiro, "Ana (imported)")
    abertas.push(novo)
    expect(novo.session.profile.displayName).toBe("Ana")
    await ate(() => novo.session.channels.includes(canal), "the imported device is in the room", 90_000, 250)
    /*
      And in the account channel, with the full state of its siblings already
      read: what comes next reaches it through the room only.
    */
    await ate(() => novo.session.groupFor(novo.session.canalDaConta) !== undefined, "the imported device is in the account channel", 60_000, 250)
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    // Live: the phone publishes a newer profile in the room only.
    const perfis: string[] = []
    novo.session.on("perfil", ({ profile }) => perfis.push(profile.displayName))
    const v2 = await perfilNovoSoNoCanal(telemovel, canal, "Ana Nova")
    await ate(() => novo.session.profile.displayName === "Ana Nova", "the imported device adopts the live profile", 20_000)
    expect(novo.session.profile.updatedAt).toBe(v2)
    expect(perfis).toContain("Ana Nova")

    // An OLDER own profile heard later does not take its place.
    await telemovel.vault.update((contents) => {
      contents.profile = { displayName: "Ana Velha", donations: [], updatedAt: v2 - 60_000 }
    })
    await telemovel.session.publishProfile([canal], true)
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(novo.session.profile.displayName).toBe("Ana Nova")

    // In a catch-up: the imported device is off while the phone publishes.
    novo.session.disconnect()
    const v3 = await perfilNovoSoNoCanal(telemovel, canal, "Ana Terceira")
    await novo.session.connect()
    await ate(() => novo.session.profile.displayName === "Ana Terceira", "the imported device adopts the profile of the catch-up", 30_000)
    expect(novo.session.profile.updatedAt).toBe(v3)

    // What it publishes from now on is the new version: Bruno never goes back to an old name.
    await novo.session.publishProfile([canal], true)
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(nomeNoDirectorio(bruno!, ana!.address)).toBe("Ana Terceira")
  }, 240_000)

  it("a profile edit still waiting in the file is not the imported device's to publish", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    // An edit that has not gone out yet (the 5 s debounce) travels in the file.
    await ana!.session.updateProfile({ displayName: "Ana Editada", donations: [] })
    expect(ana!.vault.contents.perfilPorPublicar).toBeDefined()
    const ficheiro = await ana!.vault.exportVault()
    const vault = new Vault(new CofreEmMemoria())
    const session = new Session(vault)
    await vault.importVault(ficheiro, FRASE, { passagem: (pedido) => session.passagemDoImportar(pedido) })
    await vault.unlock(FRASE)
    // The profile comes with the file; the duty to publish it stays with the device that wrote it.
    expect(vault.contents.profile.displayName).toBe("Ana Editada")
    expect(vault.contents.perfilPorPublicar).toBeUndefined()
  }, 60_000)
})
