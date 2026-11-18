import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
// The harness server, for real, on an ephemeral port.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// From `dist`, like the harness sessions: the same `Session` class, so the static below reaches them.
import { entradasDoCanal, lerVoto, Session, type VaultContents } from "@enclave/client-core"

/**
 * Creating polls needs a role, between real clients (`votacoes`, 1.3.21).
 *
 * Ana founds the channel and turns the power on for a role she gives Bruno.
 * Bruno creates a poll and it reaches everyone as a poll. Carla has no role: the
 * app does not offer her the option, and a poll her altered client forges reaches
 * the others as plain text. Bruno deletes his poll, and it leaves the channel and
 * the votes on Carla's second device.
 *
 * The real server stamps today's minute, and today may be before the cut
 * (`PODER_DAS_VOTACOES_DESDE_MINUTO`): the test moves the cut to zero and puts it back.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const corteOriginal = Session.VOTACOES_JULGADAS_DESDE_MINUTO

beforeAll(async () => {
  servidor = await levantarServidor()
  Session.VOTACOES_JULGADAS_DESDE_MINUTO = 0
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  Session.VOTACOES_JULGADAS_DESDE_MINUTO = corteOriginal
  await servidor?.fechar()
})

const votacao = (id: string, pergunta: string) =>
  mensagemAEnviar(`${pergunta}\n1. Sim\n2. Não`, undefined, { poll: { question: pergunta, options: ["Sim", "Não"] } } as never, {
    id,
    sentAt: Date.now(),
  })

/** Message `id` as this account's interface reads it, or `undefined`. */
const noEcra = (conta: ContaDeTeste, canal: string, id: string) =>
  conta.session.history(canal).find((entrada) => entrada.payload.t === "message" && entrada.payload["id"] === id)

const apagada = (conta: ContaDeTeste, canal: string, id: string): boolean =>
  conta.session.history(canal).some((entrada) => entrada.payload.t === "redact" && entrada.payload["target"] === id)

const votosEm = (contents: VaultContents, canal: string, alvo: string): number =>
  entradasDoCanal(contents, canal).filter((entrada) => lerVoto(entrada)?.alvo === alvo).length

describe("criar votações pede um cargo, entre clientes reais", () => {
  it("o cargo dá o poder, a votação forjada chega como texto, e eliminar tira-a do outro aparelho", async () => {
    const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
    abertas.push(ana!, bruno!, carla!)
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    const telemovel = await emparelharAparelho(carla!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel da Carla entra no canal", 30_000)

    // Nobody but the founder creates polls until a role carries the power.
    expect(ana!.session.mayCreatePoll(canal)).toBe(true)
    expect(bruno!.session.mayCreatePoll(canal)).toBe(false)

    // Ana turns it on for a role, and gives it to Bruno.
    await ana!.session.defineRole(canal, { role: "sondagens", name: "Sondagens", powers: ["votacoes"], rank: 1 })
    await ana!.session.assignRoles(canal, bruno!.address, ["sondagens"])
    await ate(() => bruno!.session.mayCreatePoll(canal), "o Bruno recebe o cargo", 30_000)
    await ate(() => carla!.session.mayCreatePoll(canal, bruno!.address), "a Carla sabe do cargo do Bruno", 30_000)
    // Carla, without a role, is not offered the option (the screen asks this).
    expect(carla!.session.mayCreatePoll(canal)).toBe(false)
    await expect(carla!.session.send(canal, votacao("carla-honesta-01", "Posso?"))).rejects.toThrow("you may not create polls in this channel")

    // Bruno creates one: a poll for everyone, Carla's phone included.
    await bruno!.session.send(canal, votacao("bruno-votacao-01", "Jantar na sexta?"))
    for (const conta of [ana!, carla!, telemovel]) {
      await ate(() => noEcra(conta, canal, "bruno-votacao-01") !== undefined, `${conta.nome} recebe a votação do Bruno`, 30_000)
      expect(noEcra(conta, canal, "bruno-votacao-01")?.payload["poll"]).toMatchObject({ question: "Jantar na sexta?" })
    }

    // Carla's altered client skips its own gate: the others read plain text.
    carla!.session.mayCreatePoll = () => true
    await carla!.session.send(canal, votacao("carla-forjada-01", "Quem manda aqui?"))
    for (const conta of [ana!, bruno!]) {
      await ate(() => noEcra(conta, canal, "carla-forjada-01") !== undefined, `${conta.nome} recebe a mensagem da Carla`, 30_000)
      const linha = noEcra(conta, canal, "carla-forjada-01")
      expect(linha?.payload["poll"]).toBeUndefined()
      expect(linha?.payload["body"]).toBe("Quem manda aqui?\n1. Sim\n2. Não")
    }

    // Votes, then Bruno deletes his poll: it leaves Carla's phone, and the votes with it.
    await ana!.session.voteOnPoll(canal, "bruno-votacao-01", 0)
    await carla!.session.voteOnPoll(canal, "bruno-votacao-01", 1)
    await ate(() => votosEm(telemovel.vault.contents, canal, "bruno-votacao-01") === 2, "o telemóvel da Carla tem os dois votos", 30_000)
    await bruno!.session.deleteMessage(canal, "bruno-votacao-01")
    for (const conta of [ana!, carla!, telemovel]) {
      await ate(() => apagada(conta, canal, "bruno-votacao-01"), `${conta.nome} recebe a lápide`, 30_000)
      await ate(() => votosEm(conta.vault.contents, canal, "bruno-votacao-01") === 0, `os votos saem do cofre de ${conta.nome}`, 30_000)
    }
  }, 300_000)
})
