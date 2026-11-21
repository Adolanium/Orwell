import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  ate,
  canalComTodos,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { ArmazemEmMemoria, ERRO_APARELHO_ATRASADO, ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA, Session, Vault } from "@enclave/client-core"

/**
 * One password on every device of the account (1.3.26), against the real server:
 *
 * - a change on one device reaches the others through the account channel, and
 *   each one then opens with the new password only;
 * - the first change is the migration: devices with other passwords adopt it;
 * - a device that was off adopts it when it comes back (the MLS event is kept);
 * - a new device paired after asks for the account password and checks it;
 * - account files from before keep opening with the old password.
 */

const ANTIGA = "frase-passe-de-teste"
const NOVA = "palavra-nova-da-conta-1"
const MAIS_NOVA = "palavra-ainda-mais-nova-2"

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => desligarContas(abertas.splice(0)))
afterAll(async () => {
  await servidor?.fechar()
})

async function abreCom(conta: Pick<ContaDeTeste, "backend">, frase: string): Promise<boolean> {
  return new Vault(conta.backend).unlock(frase).then(
    () => true,
    () => false,
  )
}

function mudou(conta: ContaDeTeste): boolean {
  return conta.avisos.includes("account-password-changed")
}

/** A new device paired with `conta` the 1.3.26 way: no password before, the account's after the six words. */
async function emparelharComAPalavraDaConta(conta: ContaDeTeste, tentativas: string[]): Promise<ContaDeTeste & { erros: string[] }> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend)
  vault.criarProvisorioPorSelar()
  const armazem = new ArmazemEmMemoria()
  const session = new Session(vault, { armazem })
  const avisos: string[] = []
  session.on("status", (e) => e.code && avisos.push(e.code))
  let tipo: string | undefined
  const fase = (alvo: string, quem: Session) =>
    new Promise<void>((resolve, reject) => {
      const desligar = quem.on("pair", (evento) => {
        if (evento.fase === alvo) {
          if (evento.fase === "certificado") tipo = evento.palavraPasse
          desligar()
          resolve()
        } else if (evento.fase === "falhou") reject(new Error(evento.razao))
      })
    })
  const sasA = fase("sas", conta.session)
  const { link } = await conta.session.emparelharComoAnfitriao()
  const sasB = fase("sas", session)
  session.emparelharComoConvidado(link)
  await Promise.all([sasA, sasB])
  const certificado = fase("certificado", session)
  const concluido = fase("concluido", conta.session)
  await session.confirmarSas()
  await conta.session.confirmarSas()
  await certificado
  expect(tipo).toBe("conta")
  const erros: string[] = []
  for (const frase of tentativas) {
    try {
      await session.selarAposEmparelhar(frase)
      break
    } catch (erro) {
      erros.push((erro as Error).message)
    }
  }
  await vault.confirmarProvisorio()
  const identidade = session.loadIdentity()
  await session.connect()
  session.concluirEmparelhamento()
  await concluido
  return { nome: `${conta.nome} (novo)`, session, vault, backend, armazem, address: identidade.address, avisos, erros }
}

describe("a mesma palavra-passe em todos os aparelhos da conta", () => {
  it("mudar num muda em todos, e o que estava desligado muda quando volta", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    // Two phones paired the old way, each with its own password: the migration case.
    const ligado = await emparelharAparelho(ana!, "Ana (ligado)")
    const desligado = await emparelharAparelho(ana!, "Ana (desligado)")
    abertas.push(ligado, desligado)
    const canalDaConta = ana!.session.canalDaConta
    await ate(
      () => ligado.session.groupFor(canalDaConta) !== undefined && desligado.session.groupFor(canalDaConta) !== undefined,
      "os dois telemóveis no canal da conta",
      60_000,
    )
    expect(await abreCom(ligado, "frase-do-telemovel")).toBe(true)
    const ficheiroAntes = await ana!.vault.exportVault()

    // One phone is off.
    await desligado.session.flush()
    desligado.session.disconnect()

    // The first change, on the computer.
    await ana!.session.mudarPalavraPasse(ANTIGA, NOVA)
    expect(await abreCom(ana!, NOVA)).toBe(true)

    // The phone that is on adopts it: the account password opens it, its own no longer does.
    await ate(() => mudou(ligado), "o telemóvel ligado muda", 30_000)
    await ligado.session.flush()
    expect(await abreCom(ligado, NOVA)).toBe(true)
    expect(await abreCom(ligado, "frase-do-telemovel")).toBe(false)

    // The phone that was off comes back: it opens with what it had, connects, and adopts.
    const volta = await recarregar(desligado, "frase-do-telemovel")
    const avisos: string[] = []
    volta.session.on("status", (e) => e.code && avisos.push(e.code))
    volta.session.loadIdentity()
    await volta.session.connect()
    abertas.push({ ...desligado, ...volta, avisos })
    await ate(() => avisos.includes("account-password-changed"), "o telemóvel desligado muda quando volta", 60_000)
    await volta.session.flush()
    expect(await abreCom(desligado, NOVA)).toBe(true)
    expect(await abreCom(desligado, "frase-do-telemovel")).toBe(false)

    // A change on a phone reaches the computer too.
    await ligado.session.mudarPalavraPasse(NOVA, MAIS_NOVA)
    await ate(() => mudou(ana!), "o computador muda", 30_000)
    await ana!.session.flush()
    expect(await abreCom(ana!, MAIS_NOVA)).toBe(true)

    // The file saved before still opens with the password of its day.
    const noutro = new Vault(new CofreEmMemoria())
    await noutro.importVault(ficheiroAntes, ANTIGA)
    await noutro.unlock(ANTIGA)
  }, 240_000)

  it("a sibling that dropped the change event takes the record the next time the device that changed connects", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    const phone = await emparelharAparelho(ana!, "Ana (phone)")
    abertas.push(phone)
    const canalDaConta = ana!.session.canalDaConta
    await ate(() => phone.session.groupFor(canalDaConta) !== undefined, "the phone in the account channel", 60_000)

    // The phone reads the event and drops the record, as a 1.3.25 sibling does before its update.
    const dropped = vi.spyOn(phone.vault, "adoptarPalavraPasseDaConta").mockResolvedValue(false)
    await ana!.session.mudarPalavraPasse(ANTIGA, NOVA)
    await ate(() => dropped.mock.calls.length > 0, "the phone reads the change and drops it", 30_000)
    // Every copy of this connection is dropped too: let them all arrive before the phone listens again.
    await ana!.session.flush()
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    dropped.mockRestore()
    expect(mudou(phone)).toBe(false)

    // The computer connects again: the record goes out once on the new connection, and the phone adopts it.
    await ana!.session.flush()
    ana!.session.disconnect()
    await ana!.session.connect()
    await ate(() => mudou(phone), "the phone adopts on the next connection", 60_000)
    await phone.session.flush()
    expect(await abreCom(phone, NOVA)).toBe(true)
  }, 180_000)

  it("I forgot the current password: the open vault changes it, the phone adopts it, and a new device joins with it", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    const phone = await emparelharAparelho(ana!, "Ana (phone)")
    abertas.push(phone)
    await ate(() => phone.session.groupFor(ana!.session.canalDaConta) !== undefined, "the phone in the account channel", 60_000)

    // No current password: the open vault is the proof.
    await ana!.session.changePasswordWithOpenVault(NOVA)
    await ana!.session.flush()
    expect(await abreCom(ana!, NOVA)).toBe(true)
    expect(await abreCom(ana!, ANTIGA)).toBe(false)
    await ate(() => mudou(phone), "the phone adopts the new password", 30_000)
    await phone.session.flush()
    expect(await abreCom(phone, NOVA)).toBe(true)

    // Adding a device works again: it asks for the new account password.
    const novo = await emparelharComAPalavraDaConta(ana!, [ANTIGA, NOVA])
    abertas.push(novo)
    expect(novo.erros).toEqual([ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA])
    await novo.session.flush()
    expect(await abreCom(novo, NOVA)).toBe(true)
  }, 180_000)

  it("a device that saw a newer record and did not adopt it refuses to change, until it catches up", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    const phone = await emparelharAparelho(ana!, "Ana (phone)")
    abertas.push(phone)
    await ate(() => phone.session.groupFor(ana!.session.canalDaConta) !== undefined, "the phone in the account channel", 60_000)

    // The phone's disk refuses writes while the change arrives: it sees v1 and cannot adopt it.
    const write = phone.backend.write.bind(phone.backend)
    phone.backend.write = async () => {
      throw new Error("vault storage is full")
    }
    await ana!.session.mudarPalavraPasse(ANTIGA, NOVA)
    await ate(() => phone.vault.contents.highestAccountPasswordVersionSeen === 1, "the phone sees v1", 30_000)
    phone.backend.write = write
    expect(mudou(phone)).toBe(false)

    // Behind: the phone refuses to change, and says so.
    await expect(phone.session.mudarPalavraPasse("frase-do-telemovel", MAIS_NOVA)).rejects.toThrow(ERRO_APARELHO_ATRASADO)
    await expect(phone.session.changePasswordWithOpenVault(MAIS_NOVA)).rejects.toThrow(ERRO_APARELHO_ATRASADO)

    // The computer connects again, the phone adopts v1, and then its change goes and reaches the computer.
    await ana!.session.flush()
    ana!.session.disconnect()
    await ana!.session.connect()
    await ate(() => mudou(phone), "the phone adopts v1 on the next connection", 60_000)
    await phone.session.mudarPalavraPasse(NOVA, MAIS_NOVA)
    await ate(() => mudou(ana!), "the computer adopts v2", 30_000)
    await ana!.session.flush()
    expect(await abreCom(ana!, MAIS_NOVA)).toBe(true)
  }, 180_000)

  it("um aparelho novo pede a palavra-passe da conta depois de emparelhar, e recusa outra", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    await ana!.session.mudarPalavraPasse(ANTIGA, NOVA)
    const novo = await emparelharComAPalavraDaConta(ana!, ["nao-e-esta", NOVA])
    abertas.push(novo)
    expect(novo.erros).toEqual([ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA])
    await novo.session.flush()
    expect(await abreCom(novo, NOVA)).toBe(true)
    // And a later change reaches it, through the account channel it joined.
    await ate(() => novo.session.groupFor(ana!.session.canalDaConta) !== undefined, "o novo no canal da conta", 60_000)
    await ana!.session.mudarPalavraPasse(NOVA, MAIS_NOVA)
    await ate(() => mudou(novo), "o novo muda", 30_000)
    await novo.session.flush()
    expect(await abreCom(novo, MAIS_NOVA)).toBe(true)
  }, 180_000)

  it("importar um ficheiro de antes da mudança: abre com a antiga e, já na conta, passa à da conta", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: false })
    abertas.push(ana!)
    // A channel of the account: the new device takes its seat there and announces itself, and so enters the account channel.
    await canalComTodos(servidor, ana!, [])
    await ana!.session.flush()
    const ficheiroAntigo = await ana!.vault.exportVault()
    await ana!.session.mudarPalavraPasse(ANTIGA, NOVA)

    const backend = new CofreEmMemoria()
    const vault = new Vault(backend)
    const session = new Session(vault, { armazem: new ArmazemEmMemoria() })
    const avisos: string[] = []
    session.on("status", (e) => e.code && avisos.push(e.code))
    await vault.importVault(ficheiroAntigo, ANTIGA, { passagem: (pedido) => session.passagemDoImportar(pedido) })
    await vault.unlock(ANTIGA)
    const identidade = session.loadIdentity()
    await session.connect()
    abertas.push({ nome: "Ana (importada)", session, vault, backend, armazem: new ArmazemEmMemoria(), address: identidade.address, avisos })
    await ate(() => avisos.includes("account-password-changed"), "o aparelho importado passa à palavra-passe da conta", 90_000, 250)
    await session.flush()
    expect(await abreCom({ backend }, NOVA)).toBe(true)
    expect(await abreCom({ backend }, ANTIGA)).toBe(false)
  }, 180_000)
})

