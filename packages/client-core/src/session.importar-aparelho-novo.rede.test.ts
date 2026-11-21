import { toBase64 } from "@enclave/protocol"
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
// The same build as the harness (`@enclave/client-core`), so the classes are the same ones.
import {
  ArmazemEmMemoria,
  ERRO_CONTA_CHEIA_NO_IMPORTAR,
  ERRO_FICHEIRO_DE_APARELHO_REVOGADO,
  Session,
  Vault,
} from "@enclave/client-core"

/**
 * Importing the account file on a new device, against the real server (1.3.26,
 * 21/11/2026): the import is a NEW device of the account and
 * never removes one. What this holds, end to end:
 *
 * - the device that exported keeps working (no Erro 748), and both write and read
 *   in the same channel;
 * - the history of the file is on the new device;
 * - the device that exported sees "a new device joined" at once (live manifest);
 * - "Remove" on it takes the new device out;
 * - a full account and a file from a removed device refuse, and nothing changes.
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

/** A new device that imports `ficheiro` with the handover, unlocks and connects. */
async function importarNoutroAparelho(ficheiro: Uint8Array, nome: string): Promise<ContaDeTeste> {
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

async function exportar(conta: ContaDeTeste): Promise<Uint8Array> {
  await conta.session.flush()
  return conta.vault.exportVault()
}

function corpos(conta: ContaDeTeste, canal: string): string[] {
  return conta.session
    .history(canal)
    .map((entrada) => entrada.payload["body"])
    .filter((corpo): corpo is string => typeof corpo === "string")
}

/** The `device-new` statuses of a session, with the device key. */
function avisosDeAparelhoNovo(conta: ContaDeTeste): () => string[] {
  const vistos: string[] = []
  conta.session.on("status", (evento) => {
    if (evento.code === "device-new") vistos.push(evento.detail.split("|")[0]!)
  })
  return () => vistos
}

describe("importar o ficheiro da conta num aparelho novo", () => {
  it("o original continua, os dois escrevem e lêem, o histórico fica, o original vê o aviso, e Remover tira o novo", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"], { salaComum: false })
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, { t: "message", body: "antes do ficheiro", sentAt: Date.now(), id: "m-1-xxxxxxxx" })
    await ate(() => corpos(bruno!, canal).includes("antes do ficheiro"), "o Bruno lê a mensagem de antes")
    // The original learned its own list (the silent first read), so the next key is news.
    await ate(() => ana!.vault.contents.aparelhosConhecidos !== undefined, "a Ana conhece os aparelhos da conta", 20_000)
    // The first read of the list is silent: nothing to compare with.
    expect(ana!.avisos).not.toContain("device-new")
    const avisos = avisosDeAparelhoNovo(ana!)
    const chaveOriginal = toBase64(ana!.session.identity.deviceSigningPublicKey)

    const ficheiro = await exportar(ana!)
    const novo = await importarNoutroAparelho(ficheiro, "Ana (aparelho novo)")
    abertas.push(novo)

    // A NEW device key, the same account.
    expect(novo.address).toBe(ana!.address)
    const chaveNova = toBase64(novo.session.identity.deviceSigningPublicKey)
    expect(chaveNova).not.toBe(chaveOriginal)

    // The history came with the file.
    expect(corpos(novo, canal)).toContain("antes do ficheiro")

    // The original sees the notice, at once, with the new key.
    await ate(() => avisos().includes(chaveNova), "a Ana vê o aviso do aparelho novo", 15_000)

    // The original keeps working: never revoked, still online.
    expect(ana!.avisos).not.toContain("device-revoked")
    expect(ana!.session.connection).toBe("online")

    // The new device gets its own seat in the channel, through the existing paths.
    await ate(() => novo.session.channels.includes(canal), "o aparelho novo senta-se no canal", 90_000, 250)

    // Both write, and everyone reads both.
    await ana!.session.send(canal, { t: "message", body: "do original", sentAt: Date.now(), id: "m-2-xxxxxxxx" })
    await novo.session.send(canal, { t: "message", body: "do novo", sentAt: Date.now(), id: "m-3-xxxxxxxx" })
    await ate(() => corpos(bruno!, canal).includes("do original") && corpos(bruno!, canal).includes("do novo"), "o Bruno lê os dois", 20_000)
    await ate(() => corpos(novo, canal).includes("do original"), "o novo lê o original", 20_000)
    await ate(() => corpos(ana!, canal).includes("do novo"), "o original lê o novo", 20_000)
    expect(ana!.avisos).not.toContain("device-revoked")
    // And the account channel (account state between devices), through `#cuidarDoCanalDaConta`.
    const canalDaConta = ana!.session.canalDaConta
    await ate(() => novo.session.groupFor(canalDaConta) !== undefined, "o aparelho novo entra no canal da conta", 60_000, 250)

    // "Remove" on the original takes the new device out.
    await ana!.session.revokeDevice(chaveNova)
    await ate(() => novo.avisos.includes("device-revoked"), "o aparelho novo sai da conta", 20_000)
    const manifesto = await ana!.session.aparelhosDaConta()
    expect(manifesto?.map((aparelho) => aparelho.deviceKey)).toEqual([chaveOriginal])
    // And the original still writes.
    await ana!.session.send(canal, { t: "message", body: "depois de remover", sentAt: Date.now(), id: "m-4-xxxxxxxx" })
    await ate(() => corpos(bruno!, canal).includes("depois de remover"), "o Bruno lê o original depois de remover", 20_000)
  }, 240_000)

  it("conta cheia: o importar recusa com a frase própria, e ninguém sai da conta", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    for (let i = 0; i < 3; i++) abertas.push(await emparelharAparelho(ana!, `Ana ${i}`))
    await ate(() => (ana!.vault.contents.deviceManifests?.[ana!.address] ?? 0) >= 4, "quatro aparelhos na conta", 30_000)
    const antes = (await ana!.session.aparelhosDaConta())?.map((aparelho) => aparelho.deviceKey)
    expect(antes).toHaveLength(4)
    // Devices paired HERE are not news here.
    expect(ana!.avisos).not.toContain("device-new")

    const ficheiro = await exportar(ana!)
    const disco = new CofreEmMemoria()
    disco.bytes = new TextEncoder().encode("conta-de-outra-pessoa")
    const vault = new Vault(disco)
    const session = new Session(vault)
    await expect(vault.importVault(ficheiro, FRASE, { passagem: (pedido) => session.passagemDoImportar(pedido) })).rejects.toThrow(
      ERRO_CONTA_CHEIA_NO_IMPORTAR,
    )
    // Nothing was written here, and nobody left the account.
    expect(new TextDecoder().decode(disco.bytes!)).toBe("conta-de-outra-pessoa")
    expect((await ana!.session.aparelhosDaConta())?.map((aparelho) => aparelho.deviceKey)).toEqual(antes)
    expect(ana!.avisos).not.toContain("device-revoked")
  }, 180_000)

  it("ficheiro de um aparelho que já saiu da conta: o servidor recusa, e a frase diz isso", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => (telemovel.vault.contents.deviceManifests?.[ana!.address] ?? 0) >= 2, "o telemóvel vê o manifesto com ele", 30_000)
    // The phone's file, then the phone is removed on the computer.
    const ficheiroDoTelemovel = await exportar(telemovel)
    telemovel.session.disconnect()
    await ana!.session.revokeDevice(toBase64(telemovel.session.identity.deviceSigningPublicKey))

    const antes = (await ana!.session.aparelhosDaConta())?.map((aparelho) => aparelho.deviceKey)
    const vault = new Vault(new CofreEmMemoria())
    const session = new Session(vault)
    await expect(
      vault.importVault(ficheiroDoTelemovel, "frase-do-telemovel", { passagem: (pedido) => session.passagemDoImportar(pedido) }),
    ).rejects.toThrow(ERRO_FICHEIRO_DE_APARELHO_REVOGADO)
    expect((await ana!.session.aparelhosDaConta())?.map((aparelho) => aparelho.deviceKey)).toEqual(antes)
  }, 120_000)

  it("a ligação de passagem não deixa rasto nos canais: o original não perde nada nem recebe nada a mais", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"], { salaComum: false })
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const epocaAntes = ana!.session.groupFor(canal)?.state.groupContext.epoch
    // The handover alone, without the new device connecting after it.
    const ficheiro = await exportar(ana!)
    const vault = new Vault(new CofreEmMemoria())
    const session = new Session(vault)
    await vault.importVault(ficheiro, FRASE, { passagem: (pedido) => session.passagemDoImportar(pedido) })
    // A round trip on the original's socket, so anything the handover caused has arrived.
    await ana!.session.send(canal, { t: "message", body: "depois da passagem", sentAt: Date.now(), id: "m-5-xxxxxxxx" })
    await ate(() => corpos(bruno!, canal).includes("depois da passagem"), "o Bruno lê o original")
    // No epoch moved: no commit, no seat, nothing done with the old leaf.
    expect(ana!.session.groupFor(canal)?.state.groupContext.epoch).toBe(epocaAntes)
    expect(bruno!.session.groupFor(canal)?.state.groupContext.epoch).toBe(epocaAntes)
    // (The channel's sequence is not checked: Bruno's own background sync may write there meanwhile.
    // That the handover sends no channel frame is held frame by frame in `passagem.test.ts`.)
    expect(ana!.avisos).not.toContain("device-revoked")
    expect(bruno!.avisos.filter((codigo) => codigo === "event-failed" || codigo === "decrypt-failed")).toEqual([])
  }, 120_000)
})
