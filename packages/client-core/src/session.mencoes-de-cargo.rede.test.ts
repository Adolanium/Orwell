import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Payload } from "@enclave/protocol"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
import type { ReceivedMessage } from "./session.js"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Mentions of a role, people and `@all`, between real clients (12/11/2026).
 *
 * Ana founds the channel; Bruno holds the role "porteiro", Carla does not. A
 * role mention reaches Bruno as a mention of HIM (his address in `mentions` on
 * delivery), and not Carla. Without `mencionartodos`, Carla's role mention is
 * plain text, until the role is made mentionable by anyone.
 */

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

type Mensagem = Extract<Payload, { t: "message" }>

function recebidas(conta: ContaDeTeste): Mensagem[] {
  const vistas: Mensagem[] = []
  conta.session.on("message", (evento: ReceivedMessage) => {
    if (evento.payload.t === "message") vistas.push(evento.payload)
  })
  return vistas
}

const dizer = (conta: ContaDeTeste, canal: string, id: string, corpo: string, mentions: string[]): Promise<void> =>
  conta.session.send(canal, mensagemAEnviar(corpo, undefined, { mentions }, { id, sentAt: Date.now() }))

describe("menções de cargo, de pessoas e de todos", () => {
  it("o cargo chega a quem o tem como menção dele, respeitando a permissão de quem escreve", async () => {
    const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
    abertas.push(ana!, bruno!, carla!)
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await ana!.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["fixar"] })
    await ana!.session.assignRoles(canal, bruno!.address, ["porteiro"])
    for (const conta of [bruno!, carla!]) {
      await ate(() => conta.session.rolesFor(canal, bruno!.address).includes("porteiro"), `${conta.nome} sabe quem é porteiro`, 30_000)
    }
    const doBruno = recebidas(bruno!)
    const daCarla = recebidas(carla!)
    const daAna = recebidas(ana!)

    // Ana (founder, with `mencionartodos`) mentions the role, a person and everyone.
    await dizer(ana!, canal, "ana-cargo-0001", "<@&porteiro> abre a porta", ["&porteiro"])
    await dizer(ana!, canal, "ana-pessoa-001", `${carla!.address} olá`, [carla!.address])
    await dizer(ana!, canal, "ana-todos-0001", "@all reunião", ["todos"])
    await ate(() => doBruno.some((m) => m.id === "ana-todos-0001"), "o Bruno recebe as três", 30_000)
    await ate(() => daCarla.some((m) => m.id === "ana-todos-0001"), "a Carla recebe as três", 30_000)

    const doCargo = (lista: Mensagem[], id: string): string[] => lista.find((m) => m.id === id)?.mentions ?? []
    // Bruno holds the role: his own address joins the mentions.
    expect(doCargo(doBruno, "ana-cargo-0001")).toEqual(["&porteiro", bruno!.address])
    // Carla does not: the role stays, and her address does not.
    expect(doCargo(daCarla, "ana-cargo-0001")).toEqual(["&porteiro"])
    // The person mention and `@all` still work end to end.
    expect(doCargo(daCarla, "ana-pessoa-001")).toEqual([carla!.address])
    expect(doCargo(doBruno, "ana-todos-0001")).toEqual(["todos"])

    // Carla has no `mencionartodos`: her role mention mentions nobody.
    await dizer(carla!, canal, "carla-cargo-01", "<@&porteiro> ajuda", ["&porteiro"])
    await ate(() => doBruno.some((m) => m.id === "carla-cargo-01"), "o Bruno recebe a da Carla", 30_000)
    expect(doCargo(doBruno, "carla-cargo-01")).toEqual([])
    await ate(() => daAna.some((m) => m.id === "carla-cargo-01"), "a Ana recebe a da Carla", 30_000)
    expect(doCargo(daAna, "carla-cargo-01")).toEqual([])

    // The role made mentionable by anyone: now Carla's mention counts.
    await ana!.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["fixar", "mencionavel"] })
    await ate(
      () => bruno!.session.rolesOf(canal).find((cargo) => cargo.role === "porteiro")?.powers.includes("mencionavel") === true,
      "o Bruno sabe que o cargo é mencionável",
      30_000,
    )
    await dizer(carla!, canal, "carla-cargo-02", "<@&porteiro> outra vez", ["&porteiro"])
    await ate(() => doBruno.some((m) => m.id === "carla-cargo-02"), "o Bruno recebe a segunda da Carla", 30_000)
    expect(doCargo(doBruno, "carla-cargo-02")).toEqual(["&porteiro", bruno!.address])
  }, 180_000)
})
