import { ArmazemEmMemoria, Session, Vault } from "@enclave/client-core"
import { moradaDeSala, resolverProvaDeTrabalho, type DesafioDeTrabalho, type ProvaDeTrabalho } from "@enclave/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { ate, ateQue, CofreEmMemoria, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import type { ServerConfig } from "./config.js"
import { currentMinute } from "./db.js"

/**
 * The abuse brake, part 2 (1.3.26), with a real `Session` and real MLS.
 *
 * The `Session` talks from loopback, so these servers set `travaoEmLoopback`:
 * otherwise loopback is left alone, as development is.
 */

let servidor: ServidorDeTeste | undefined
const sessoes: Session[] = []
afterEach(async () => {
  for (const sessao of sessoes.splice(0)) sessao.disconnect()
  await servidor?.fechar()
  servidor = undefined
})

const TRABALHO = { trabalho: 2000, trabalhoNoPico: 2000, picoPorHora: 1000 }

async function levantar(extra: Partial<ServerConfig>): Promise<ServidorDeTeste> {
  servidor = await levantarServidor({ travaoEmLoopback: true, ...extra })
  return servidor
}

interface Conta {
  session: Session
  vault: Vault
  address: string
  avisos: { code: string | undefined; detail: string }[]
}

/** A session with a vault and an identity, not connected. `horas`: register the account that many hours ago first. */
type Resolver = (desafio: DesafioDeTrabalho, aoProgresso?: (fraccao: number) => void) => Promise<ProvaDeTrabalho>

async function nova(opcoes: { salaComum?: boolean; horas?: number; resolverProva?: Resolver } = {}): Promise<Conta> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault, { armazem: new ArmazemEmMemoria(), ...(opcoes.resolverProva ? { resolverProva: opcoes.resolverProva } : {}) })
  sessoes.push(session)
  const identidade = await session.createIdentity(servidor!.casa)
  if (opcoes.horas !== undefined) {
    servidor!.enclave.store.registarContaNoMinuto(identidade.address, identidade.signingPublicKey, currentMinute() - Math.round(opcoes.horas * 60))
  }
  await session.escolherSalaComum(opcoes.salaComum ?? false)
  const avisos: Conta["avisos"] = []
  session.on("status", (evento) => avisos.push({ code: evento.code, detail: evento.detail }))
  return { session, vault, address: identidade.address, avisos }
}

async function ligada(opcoes: Parameters<typeof nova>[0] & { nome?: string } = {}): Promise<Conta> {
  const conta = await nova(opcoes)
  await conta.session.connect()
  await conta.session.updateProfile({ displayName: opcoes.nome ?? "Conta", donations: [] })
  return conta
}

describe("a prova de trabalho na sessão", () => {
  it("uma conta criada nesta sessão resolve a prova sozinha ao ligar", async () => {
    const { enclave } = await levantar({ provaDeTrabalho: TRABALHO })
    const conta = await nova()
    await conta.session.connect()
    expect(conta.session.connection).toBe("online")
    expect(enclave.store.signingKeyOf(conta.address)).toBeDefined()
  })

  it("prepararContaNova resolve antes de ligar, diz o progresso, e o connect usa essa prova", async () => {
    await levantar({ provaDeTrabalho: TRABALHO })
    const chamadas: DesafioDeTrabalho[] = []
    const conta = await nova()
    const progresso: number[] = []
    const preparada = await conta.session.prepararContaNova({
      aoProgresso: (f) => progresso.push(f),
      resolver: (desafio, aoProgresso) => {
        chamadas.push(desafio)
        return resolverProvaDeTrabalho(desafio, { aoProgresso })
      },
    })
    expect(preparada).toBe(true)
    expect(chamadas).toHaveLength(1)
    expect(progresso.at(-1)).toBe(1)
    await conta.session.connect()
    expect(conta.session.connection).toBe("online")
    // The prepared proof was used: the connection did not solve another one.
    expect(chamadas).toHaveLength(1)
  })

  it("desafioDeRegisto dá o desafio do servidor, e null quando o servidor não pede prova", async () => {
    await levantar({ provaDeTrabalho: TRABALHO })
    const conta = await nova()
    expect((await conta.session.desafioDeRegisto(servidor!.casa))?.trabalho).toBe(2000)
    await servidor!.fechar()
    await levantar({})
    expect(await conta.session.desafioDeRegisto(servidor!.casa)).toBeNull()
  })

  it("uma conta que já existe liga sem resolver nada", async () => {
    await levantar({ provaDeTrabalho: TRABALHO })
    const primeira = await nova()
    await primeira.session.connect()
    primeira.session.disconnect()
    let resolvidas = 0
    const outra = new Session(primeira.vault, {
      armazem: new ArmazemEmMemoria(),
      resolverProva: async (desafio) => {
        resolvidas++
        return resolverProvaDeTrabalho(desafio)
      },
    })
    sessoes.push(outra)
    outra.loadIdentity()
    await outra.connect()
    expect(outra.connection).toBe("online")
    expect(resolvidas).toBe(0)
  })

  it("a rede no limite: connect lança a frase, e a sessão não volta a ligar em ciclo", async () => {
    await levantar({ provaDeTrabalho: TRABALHO, limiteDeRede: { porHora: 1, porDia: 10 } })
    await ligada()
    const segunda = await nova()
    await expect(segunda.session.connect()).rejects.toThrow("this network created many accounts today")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(segunda.session.connection).not.toBe("online")
    expect(servidor!.enclave.store.signingKeyOf(segunda.address)).toBeUndefined()
  })

  it("a rede no limite: a ligação de convite de uma comunidade real deixa entrar a conta nova, e o convite abre-se depois", async () => {
    await levantar({ provaDeTrabalho: TRABALHO, limiteDeRede: { porHora: 1, porDia: 10 } })
    const antiga = await ligada({ horas: 100, nome: "Antiga" })
    const canal = moradaDeSala(servidor!.casa)
    await antiga.session.createSpaceChannel(canal)
    const { longa, curta } = await antiga.session.criarConvite(canal)
    await ligada()
    // The network is full. Without the link: Erro 234.
    const segunda = await nova()
    await expect(segunda.session.connect()).rejects.toThrow("this network created many accounts today")
    // With the link (the short one, as the app shows it), the same account gets in.
    expect(segunda.session.definirConviteDeComunidade(curta ?? longa)).toBe(true)
    await segunda.session.connect()
    expect(segunda.session.connection).toBe("online")
    expect(servidor!.enclave.store.signingKeyOf(segunda.address)).toBeDefined()
    // The invite was not spent at registration: the redeem still works.
    await segunda.session.redeemInvite(longa)
    await ate(() => servidor!.enclave.store.listInvites(canal)[0]?.uses === 1, "o resgate gasta o uso")
  })

  it("um texto que não é uma ligação de convite não fica guardado", async () => {
    await levantar({})
    const conta = await nova()
    expect(conta.session.definirConviteDeComunidade("AAAA-BBBB-CCCC-DDDD")).toBe(false)
    expect(conta.session.definirConviteDeComunidade(null)).toBe(false)
  })
})

const LIMITES = {
  intervaloAte24hS: 2,
  intervaloAte72hS: 1,
  maxBytesAte24h: 262_144,
  pessoasAte24h: 1,
  pessoasAte72h: 3,
  comunidades: 0,
  canaisAte24h: 50,
  canaisAte72h: 50,
}

describe("os limites da conta nova na sessão", () => {
  it("a sessão sabe que a conta é nova (auth.ok), e uma conta antiga não", async () => {
    await levantar({ contaNova: LIMITES })
    const recente = await ligada()
    expect(recente.session.contaNova?.intervaloAte24hS).toBe(2)
    expect(recente.session.faseDaContaNova).toBe("24h")
    const antiga = await ligada({ horas: 100 })
    expect(antiga.session.contaNova).toBeNull()
    expect(antiga.session.faseDaContaNova).toBeNull()
  })

  it("a sessão avisa uma vez por sessão, no primeiro dia: 'new-account'", async () => {
    await levantar({ contaNova: LIMITES })
    const recente = await ligada()
    expect(recente.avisos.filter((a) => a.code === "new-account")).toHaveLength(1)
    recente.session.disconnect()
    await recente.session.connect()
    expect(recente.avisos.filter((a) => a.code === "new-account")).toHaveLength(1)
    const media = await ligada({ horas: 30 })
    expect(media.avisos.some((a) => a.code === "new-account")).toBe(false)
  })

  it("a device that imports the file of an old account is not a new account: the age is the account's (hotfix 1.3.26-2)", async () => {
    await levantar({ contaNova: LIMITES })
    const antiga = await ligada({ horas: 100 })
    await antiga.session.flush()
    const ficheiro = await antiga.vault.exportVault()
    // The new device, born now, with a device key the server never saw.
    const vault = new Vault(new CofreEmMemoria())
    const session = new Session(vault, { armazem: new ArmazemEmMemoria() })
    sessoes.push(session)
    const avisos: string[] = []
    session.on("status", (evento) => {
      if (evento.code) avisos.push(evento.code)
    })
    await vault.importVault(ficheiro, "frase-passe-de-teste", { passagem: (pedido) => session.passagemDoImportar(pedido) })
    await vault.unlock("frase-passe-de-teste")
    session.loadIdentity()
    await session.connect()
    expect(session.contaNova).toBeNull()
    expect(session.faseDaContaNova).toBeNull()
    expect(avisos).not.toContain("new-account")
    // And the signed age, as every member reads it, is the account's, not the new device's.
    const criadaEm = await session.idadeDaConta(antiga.address)
    expect(criadaEm).not.toBeNull()
    expect(Date.now() - criadaEm!).toBeGreaterThan(3 * 24 * 60 * 60 * 1000)
  })

  it("a terceira pessoa num dia (limite 1 por dia): abrir a conversa lança o aviso da conta nova", async () => {
    await levantar({ contaNova: LIMITES })
    const conta = await ligada()
    const a = await ligada({ horas: 100, nome: "A" })
    const b = await ligada({ horas: 100, nome: "B" })
    await conta.session.openDirect(a.address)
    await expect(conta.session.openDirect(b.address)).rejects.toThrow("this new account added all the people it can today")
  })

  it("mensagem directa a quem não é amigo: recusada nas primeiras 72 h; o pedido de amizade passa", async () => {
    await levantar({ contaNova: LIMITES })
    const conta = await ligada()
    const outra = await ligada({ horas: 100, nome: "Outra" })
    const canal = await conta.session.openDirect(outra.address)
    await expect(
      conta.session.send(canal, { t: "message", id: "mensagem-1", sentAt: Date.now(), body: "olá", attachments: [], links: [], mentions: [] } as never),
    ).rejects.toThrow("this new account must send a friend request first")
    await conta.session.sendFriendRequest(canal)
  })

  it("autorNovoAte: o fim do primeiro dia de uma conta nova; null para uma conta antiga", async () => {
    await levantar({ contaNova: LIMITES })
    const antiga = await ligada({ horas: 100, nome: "Antiga", salaComum: true })
    const recente = await ligada({ nome: "Recente", salaComum: true })
    await ate(() => antiga.session.channels.includes(servidor!.sala) && recente.session.channels.includes(servidor!.sala), "as duas na sala comum")
    const ateQuando = await antiga.session.autorNovoAte(recente.address)
    expect(ateQuando).not.toBeNull()
    expect(ateQuando! - Date.now()).toBeGreaterThan(22 * 3_600_000)
    expect(await recente.session.autorNovoAte(antiga.address)).toBeNull()
  })

  it("na sala comum, a recusa por ritmo da conta nova só faz esperar a sala comum", async () => {
    await levantar({ contaNova: LIMITES })
    const antiga = await ligada({ horas: 100, nome: "Antiga", salaComum: true })
    const recente = await ligada({ nome: "Recente", salaComum: true })
    await ate(() => antiga.session.channels.includes(servidor!.sala) && recente.session.channels.includes(servidor!.sala), "as duas na sala comum")
    const outro = await antiga.session.openDirect(recente.address)
    await ate(() => recente.session.channels.includes(outro), "a conversa chega")
    const mensagem = (id: string) => ({ t: "message", id, sentAt: Date.now(), body: id, attachments: [], links: [], mentions: [] }) as never
    const visto = (canal: string, id: string) => antiga.session.history(canal).some((e) => e.payload["id"] === id)
    // A friend request first: direct messages to a non-friend wait 72 hours.
    await recente.session.sendFriendRequest(outro)
    await ate(() => antiga.session.openFriendRequests().length > 0, "o pedido chega")
    await antiga.session.sendFriendRequest(outro)
    await ate(() => recente.session.friendTies().get(antiga.address)?.link === "amigos", "amigas")

    const inicio = Date.now()
    // The slack of 3 goes first (with whatever the app itself sent there), then the interval applies.
    for (const id of ["sala-001", "sala-002", "sala-003", "sala-004", "sala-005"]) void recente.session.send(servidor!.sala, mensagem(id))
    await recente.session.send(outro, mensagem("directa-1"))
    await ate(() => visto(outro, "directa-1"), "a directa chega logo")
    expect(Date.now() - inicio).toBeLessThan(1_500)
    await ate(() => visto(servidor!.sala, "sala-005"), "a última da sala comum chega depois", 15_000)
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1_500)
    expect(recente.avisos.some((a) => a.code === "new-account-slow")).toBe(true)
  }, 20_000)
})

describe("a fila da sala comum na sessão", () => {
  it("quem fica na fila recebe 'common-room-queued' e a sessão sabe o lugar", async () => {
    await levantar({ entradasNaSalaComumPorHora: 1 })
    const fundadora = await ligada({ horas: 200, nome: "Fundadora", salaComum: true })
    await ate(() => fundadora.session.channels.includes(servidor!.sala), "a sala comum existe")
    const primeira = await ligada({ horas: 200, nome: "Primeira", salaComum: true })
    await ate(() => primeira.session.channels.includes(servidor!.sala), "a primeira entra")
    const segunda = await ligada({ horas: 200, nome: "Segunda", salaComum: true })
    await ate(() => segunda.avisos.some((a) => a.code === "common-room-queued"), "a segunda fica na fila")
    expect(segunda.session.filaDaSalaComum?.posicao).toBe(1)
    expect(segunda.session.channels.includes(servidor!.sala)).toBe(false)
  })
})

describe("o tecto de canais na sessão (1.3.26)", () => {
  it("criarCanais diz a contagem; o canal a mais lança o erro antes de criar o grupo; o mural e as directas não contam", async () => {
    await levantar({ comunidadesPorConta: 2 })
    const conta = await ligada({ horas: 100 })
    const outra = await ligada({ horas: 100, nome: "Outra" })
    expect(await conta.session.criarCanais()).toEqual({ criados: 0, maximo: 2, contaNova: false })
    await conta.session.createSpace(moradaDeSala(servidor!.casa), Session.SALAS_INICIAIS, "Um")
    await conta.session.openDirect(outra.address)
    await conta.session.createSpace(moradaDeSala(servidor!.casa), Session.SALAS_INICIAIS, "Dois")
    expect(await conta.session.criarCanais()).toEqual({ criados: 2, maximo: 2, contaNova: false })
    const terceiro = moradaDeSala(servidor!.casa)
    const erro = await conta.session.createSpace(terceiro, Session.SALAS_INICIAIS, "Três").catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).toBe("this account created all the channels it can")
    expect((erro as Error).cause).toMatchObject({ maximo: 2, contaNova: false })
    expect(conta.session.channels).not.toContain(terceiro)
  })

  it("uma conta com menos de 72 h: 1 canal, e o erro diz que é a conta nova", async () => {
    await levantar({ comunidadesPorConta: 5, contaNova: { ...LIMITES, comunidades: 1 } })
    const conta = await ligada({ horas: 30 })
    expect(await conta.session.criarCanais()).toEqual({ criados: 0, maximo: 1, contaNova: true })
    await conta.session.createSpace(moradaDeSala(servidor!.casa), Session.SALAS_INICIAIS, "Um")
    const erro = await conta.session.createSpace(moradaDeSala(servidor!.casa), Session.SALAS_INICIAIS, "Dois").catch((e: unknown) => e)
    expect((erro as Error).cause).toMatchObject({ contaNova: true })
  })

  it("num servidor sem tecto, criarCanais é null e cria-se como dantes", async () => {
    await levantar({})
    const conta = await ligada({ horas: 100 })
    expect(await conta.session.criarCanais()).toBeNull()
    for (let i = 0; i < 3; i++) await conta.session.createSpace(moradaDeSala(servidor!.casa), Session.SALAS_INICIAIS, `C${i}`)
  })
})

describe("the cap on rooms in the session (1.3.26)", () => {
  it("the rooms a channel is born with do not count; New room counts; the room past the cap throws; deleting frees", async () => {
    await levantar({ channelsPerAccount: 2 })
    const conta = await ligada({ horas: 100 })
    const canal = moradaDeSala(servidor!.casa)
    await conta.session.createSpace(canal, Session.SALAS_INICIAIS, "Um")
    expect(await conta.session.roomQuota()).toEqual({ created: 0, max: 2 })
    await conta.session.upsertRoom(canal, { room: "t-um", name: "um" })
    await conta.session.upsertRoom(canal, { room: "t-dois", name: "dois" })
    // Renaming a room that exists is not a new room.
    await conta.session.upsertRoom(canal, { room: "t-um", name: "um outra vez" })
    expect(await conta.session.roomQuota()).toEqual({ created: 2, max: 2 })
    const erro = await conta.session.upsertRoom(canal, { room: "t-tres", name: "três" }).catch((e: unknown) => e)
    expect((erro as Error).message).toBe("this account created all the rooms it can")
    expect((erro as Error).cause).toMatchObject({ max: 2 })
    await conta.session.upsertRoom(canal, { room: "t-um", name: "um", removed: true })
    await ateQue(async () => (await conta.session.roomQuota())?.created === 1, "the deleted room frees its place")
    await conta.session.upsertRoom(canal, { room: "t-tres", name: "três" })
  })
})
