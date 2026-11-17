import { Session, Vault, entradasDoCanal, shasDoPayload } from "@enclave/client-core"
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
} from "../testes/cliente-de-teste.js"

/**
 * "The person who posted the image is online, and it does not come through"
 * (12/11/2026, with 1.3.7 in production). Real server, real MLS.
 *
 * The vault keeps media bytes for the 40 newest entries per room and 4 MB in
 * all: in a busy channel most members hold only the marker. The request went
 * to the three lowest live leaves by tree index; three "I do not have it" and
 * the screen said "nobody connected has this image", with the author online
 * at a higher leaf and never asked.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sessoes: Session[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  for (const sessao of sessoes.splice(0)) sessao.disconnect()
})

afterAll(async () => {
  await servidor?.fechar()
})

const IMAGEM = `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUg".repeat(200)}`
const publicacao = (id: string) =>
  ({
    t: "post",
    id,
    postedAt: Date.now(),
    caption: "com fotografia",
    media: [{ name: "foto.png", mediaType: "image/png", byteLength: 3300, inline: IMAGEM }],
    links: [],
    tags: [],
  }) as never

const tem = (session: Session, canal: string, id: string): boolean => session.history(canal).some((e) => e.payload["id"] === id)

/** The bytes left this device's media store (its ceiling, or "Free up space"): only the reference stays. */
async function despejar(conta: ContaDeTeste, canal: string, id: string): Promise<void> {
  await conta.session.drenarArmazem()
  const entrada = entradasDoCanal(conta.vault.contents, canal).find((e) => e.payload["id"] === id)
  if (entrada) await conta.session.armazem.apagar(shasDoPayload(entrada.payload))
}

/** The image's bytes on this device, as the data URL the test sent. */
async function imagemNoAparelho(conta: ContaDeTeste, canal: string, id: string): Promise<string | null> {
  const entrada = entradasDoCanal(conta.vault.contents, canal).find((e) => e.payload["id"] === id)
  const sha = entrada ? shasDoPayload(entrada.payload)[0] : undefined
  const bytes = sha ? await conta.session.bytesDeMedia(sha) : null
  return bytes ? `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` : null
}

async function recarregar(conta: ContaDeTeste): Promise<Session> {
  conta.session.disconnect()
  const backend = new CofreEmMemoria()
  backend.bytes = conta.backend.bytes
  const vault = new Vault(backend)
  await vault.unlock("frase-passe-de-teste")
  const session = new Session(vault)
  session.loadIdentity()
  await session.connect()
  sessoes.push(session)
  return session
}

/**
 * Ana founds; Bruno, Carlos and Duarte take the next leaves; Zé, the author,
 * takes leaf 4. Zé posts, the four others lose the bytes to the dump, and
 * Eva, seated after, receives the post without bytes. Everyone stays online.
 */
async function salaComAutorAlto(): Promise<{ canal: string; id: string; ze: ContaDeTeste; eva: ContaDeTeste; outros: ContaDeTeste[] }> {
  const contas = await contasDeTeste(servidor, ["Ana", "Bruno", "Carlos", "Duarte", "Zé", "Eva"])
  abertas.push(...contas)
  const [ana, bruno, carlos, duarte, ze, eva] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste]
  const canal = await canalComTodos(servidor, ana, [bruno, carlos, duarte, ze])
  const id = crypto.randomUUID()
  await ze.session.send(canal, publicacao(id))
  const outros = [ana, bruno, carlos, duarte]
  for (const conta of outros) await ate(() => tem(conta.session, canal, id), `${conta.nome} tem a publicação`, 30_000)
  for (const conta of outros) await despejar(conta, canal, id)
  await ana.session.seat(canal, eva.address)
  await ate(() => tem(eva.session, canal, id), "a publicação chega à Eva", 60_000)
  // A small image comes with the snapshot: Eva loses it to the dump too. Seating
  // her can bring the bytes back to whoever seated her (Ana answered in a first
  // run), so the four lose them once more.
  await despejar(eva, canal, id)
  for (const conta of outros) await despejar(conta, canal, id)
  return { canal, id, ze, eva, outros }
}

describe("o autor está ligado: a imagem chega", () => {
  it("o autor numa folha alta, atrás de quatro membros ligados sem os bytes", async () => {
    const { canal, id, ze, eva } = await salaComAutorAlto()
    const inicio = Date.now()
    const desfecho = await eva.session.pedirAnexo(canal, id, 0)
    const ms = Date.now() - inicio
    console.log(`[anexo-autor] autor na folha 4, 4 sem bytes antes: ${JSON.stringify({ ok: desfecho.ok, ms })}`)
    expect(desfecho).toMatchObject({ ok: true })
    expect(await imagemNoAparelho(eva, canal, id)).toBe(IMAGEM)
    expect(ze.session.estatisticasDaSincronia.anexosEnviados).toBe(1)
  }, 240_000)

  it("depois de recarregar, e com o canal a falar ao mesmo tempo", async () => {
    const { canal, id, eva, outros } = await salaComAutorAlto()
    const recarregada = await recarregar(eva)
    await ate(() => recarregada.connection === "online" && tem(recarregada, canal, id), "a Eva recarregada vê a publicação", 30_000)
    // Load: the four others talk every 150 ms while the request runs.
    let n = 0
    const conversa = setInterval(() => {
      const conta = outros[n++ % outros.length]!
      void conta.session.send(canal, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: `ruído ${n}` } as never).catch(() => {})
    }, 150)
    try {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      const inicio = Date.now()
      const desfecho = await recarregada.pedirAnexo(canal, id, 0)
      const ms = Date.now() - inicio
      console.log(`[anexo-autor] recarregada, com conversa a cada 150 ms: ${JSON.stringify({ ok: desfecho.ok, ms, mensagens: n })}`)
      expect(desfecho).toMatchObject({ ok: true })
    } finally {
      clearInterval(conversa)
    }
  }, 240_000)

  it("o autor enviou do telemóvel; o computador dele já não tem os bytes: chega pelo telemóvel", async () => {
    const contas = await contasDeTeste(servidor, ["Ana", "Bruno", "Carlos", "Zé", "Eva"])
    abertas.push(...contas)
    const [ana, bruno, carlos, ze, eva] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carlos, ze])
    const telemovel = await emparelharAparelho(ze)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel do Zé está no canal", 60_000)
    const id = crypto.randomUUID()
    await telemovel.session.send(canal, publicacao(id))
    for (const conta of [ana, bruno, carlos, ze]) await ate(() => tem(conta.session, canal, id), `${conta.nome} tem a publicação`, 30_000)
    for (const conta of [ana, bruno, carlos, ze]) await despejar(conta, canal, id)
    await ana.session.seat(canal, eva.address)
    await ate(() => tem(eva.session, canal, id), "a publicação chega à Eva", 60_000)
    await despejar(eva, canal, id)
    const desfecho = await eva.session.pedirAnexo(canal, id, 0)
    expect(desfecho).toMatchObject({ ok: true })
    expect(telemovel.session.estatisticasDaSincronia.anexosEnviados).toBe(1)
  }, 240_000)
})

describe("ninguém ligado tem a imagem: a frase diz a verdade, e a imagem chega depois", () => {
  it("o autor desligado: autorLigado é falso; o autor volta e a imagem chega", async () => {
    const { canal, id, ze, eva, outros } = await salaComAutorAlto()
    ze.session.disconnect()
    await ate(() => ze.session.connection === "offline", "o Zé desligado")
    // Presence takes a moment to reach Eva.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const antes = await eva.session.pedirAnexo(canal, id, 0)
    console.log(`[anexo-autor] autor desligado: ${JSON.stringify(antes).slice(0, 400)}`)
    expect(antes).toMatchObject({ ok: false, motivo: "ninguem", autorLigado: false, autor: ze.address })
    await ze.session.connect()
    await ate(() => ze.session.connection === "online", "o Zé ligado outra vez")
    const depois = await eva.session.pedirAnexo(canal, id, 0)
    expect(depois).toMatchObject({ ok: true })
  }, 240_000)
})
