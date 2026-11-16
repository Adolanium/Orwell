import { Session } from "@enclave/client-core"
import type { Payload } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  ateQue,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  mediaNoAparelho,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Channel state is said again only when someone lacks it (hotfix 1.3.12, 12/11/2026).
 *
 * Owner's report: "the app restarts on mobile for no obvious reason". Up to 1.3.10,
 * `connect()` ran `republishAuthority` and `republishRooms` for every restored
 * channel, on every connection, on every admin device. In the common room that is
 * ~176 frames per connection (one `role.assign` per person with a role, every
 * room, every category, the banner), measured in production: bursts of 176 to 207
 * events per minute, ~120 000 of the 153 000 events of the room. Each sender wrote
 * the whole vault per send, and each of the 409 members decrypted and applied the lot.
 *
 * The state reaches whoever lacks it by the paths that exist for that: the Welcome
 * portrait, the inviter's own cascade on its commit, and anti-entropy (the summary
 * shows the difference, one leaf reports, once). These tests prove both halves: no
 * frames when nothing changed, and the state still converges for whoever joins or
 * comes back.
 */

const TIPOS_DE_ESTADO = new Set(["room.created", "role.define", "role.assign", "channel.meta", "channel.category", "space.meta"])

const ICONE = "iVBORw0KGgo".repeat(8)

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 60_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

/** State frames that `quem` heard from `de`, from the server (seq >= 0). */
function ouvinte(quem: ContaDeTeste, canal: string): { de: (autor: string) => Payload[]; todos: () => Payload[]; limpar: () => void } {
  const ouvidos: { autor: string; payload: Payload }[] = []
  quem.session.on("message", (m) => {
    if (m.channel !== canal || m.seq < 0) return
    if (TIPOS_DE_ESTADO.has(m.payload.t)) ouvidos.push({ autor: m.sender, payload: m.payload })
  })
  return {
    de: (autor) => ouvidos.filter((o) => o.autor === autor).map((o) => o.payload),
    todos: () => ouvidos.map((o) => o.payload),
    limpar: () => void (ouvidos.length = 0),
  }
}

const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A founder with two officers and a member, two roles, a category and three rooms. */
async function canalArrumado(): Promise<{ ana: ContaDeTeste; bruno: ContaDeTeste; carla: ContaDeTeste; dario: ContaDeTeste; canal: string }> {
  const contas = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dário"])
  abertas.push(...contas)
  const [ana, bruno, carla, dario] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste]
  const canal = await canalComTodos(servidor, ana, [bruno, carla, dario])
  await ana.session.updateSpaceMeta(canal, { name: "Adega" })
  await ana.session.defineRole(canal, { role: "guarda", name: "Guarda", powers: ["convidar"] })
  await ana.session.assignRoles(canal, bruno.address, ["admin"])
  await ana.session.assignRoles(canal, carla.address, ["admin"])
  await ana.session.assignRoles(canal, dario.address, ["guarda"])
  await ana.session.upsertCategory(canal, { category: "Geral" })
  for (const sala of ["praca", "cozinha", "pateo"]) await ana.session.upsertRoom(canal, { room: sala, name: sala, category: "Geral" })
  await ate(() => bruno.session.mayEditChannel(canal) && carla.session.mayEditChannel(canal), "Bruno e Carla mandam no canal")
  await ate(() => dario.session.roomsOf(canal).length === 3, "Dário vê as três salas")
  // Let the joins' own cascades settle before counting.
  await esperar(3_000)
  return { ana, bruno, carla, dario, canal }
}

describe("republicar o estado do canal só quando alguém não o tem", () => {
  it("três administradores a ligar e desligar não mandam estado nenhum", async () => {
    const { ana, bruno, carla, dario, canal } = await canalArrumado()
    const doDario = ouvinte(dario, canal)

    for (let volta = 0; volta < 3; volta++) {
      for (const admin of [ana, bruno, carla]) {
        admin.session.disconnect()
        await esperar(200)
        await admin.session.connect()
      }
    }
    await esperar(4_000)

    expect(doDario.de(ana.address)).toHaveLength(0)
    expect(doDario.de(bruno.address)).toHaveLength(0)
    expect(doDario.de(carla.address)).toHaveLength(0)
    // And nothing was lost by staying quiet.
    expect(dario.session.roomsOf(canal)).toHaveLength(3)
    expect(dario.session.rolesFor(canal, dario.address)).toEqual(["guarda"])
  }, 120_000)

  it("quem entra recebe o estado, e só quem o convidou o manda", async () => {
    const { ana, bruno, carla, dario, canal } = await canalArrumado()
    const [eva] = await contasDeTeste(servidor, ["Eva"])
    abertas.push(eva!)
    const doDario = ouvinte(dario, canal)

    await ana.session.seat(canal, eva!.address)
    await ate(() => eva!.session.channels.includes(canal), "Eva entra")
    await ate(() => eva!.session.founderOf(canal) === ana.address, "Eva sabe quem fundou")
    await ate(() => eva!.session.roomsOf(canal).length === 3, "Eva vê as três salas")
    await ate(() => eva!.session.rolesFor(canal, dario.address).includes("guarda"), "Eva vê o cargo do Dário")
    await ate(() => eva!.session.spaceMeta(canal)?.name === "Adega", "Eva vê o nome")
    await esperar(4_000)

    // The other admins saw the channel grow and stayed quiet: the inviter covers it.
    expect(doDario.de(bruno.address)).toHaveLength(0)
    expect(doDario.de(carla.address)).toHaveLength(0)
  }, 120_000)

  it("quem entra pela mão de quem não manda no canal recebe o estado na mesma", async () => {
    const { ana, dario, canal } = await canalArrumado()
    const [eva] = await contasDeTeste(servidor, ["Eva"])
    abertas.push(eva!)
    // Dário may invite (`guarda`) but does not manage the channel: his cascade has no authority to say.
    await dario.session.seat(canal, eva!.address)
    await ate(() => eva!.session.channels.includes(canal), "Eva entra")
    await ate(() => eva!.session.founderOf(canal) === ana.address, "Eva sabe quem fundou", 30_000)
    await ate(() => eva!.session.roomsOf(canal).length === 3, "Eva vê as três salas", 30_000)
    await ate(() => eva!.session.rolesFor(canal, dario.address).includes("guarda"), "Eva vê o cargo do Dário", 30_000)
  }, 120_000)

  /*
    The defect the per-connection republish was added for (e4b01f8c, 7/8/2026):
    a member who joined before any republish existed, with no rooms and no roles in
    the vault. Faked by deleting them from Dário's vault. Anti-entropy at the end of
    his recovery finds the difference and one leaf reports it.
  */
  it("um membro antigo sem salas nem cargos no cofre recupera-os ao ligar", async () => {
    const { ana, dario, canal } = await canalArrumado()
    dario.session.disconnect()
    // On disk too, as an old vault would have it.
    await dario.vault.update((conteudo) => {
      delete conteudo.channelRooms[canal]
      delete conteudo.channelMemberRoles[canal]
      if (conteudo.channelMemberRolesAt) delete conteudo.channelMemberRolesAt[canal]
      if (conteudo.channelCategories) delete conteudo.channelCategories[canal]
    })
    expect(dario.session.roomsOf(canal)).toHaveLength(0)
    await esperar(300)
    const relatosAntes = dario.session.estatisticasDaSincronia.relatosAplicados
    await dario.session.connect()
    await ate(() => dario.session.roomsOf(canal).length === 3, "Dário volta a ter as salas", 45_000)
    await ate(() => dario.session.rolesFor(canal, dario.address).includes("guarda"), "Dário volta a ter o cargo", 45_000)
    expect(dario.session.founderOf(canal)).toBe(ana.address)
    // By anti-entropy reports, not by a republish.
    expect(dario.session.estatisticasDaSincronia.relatosAplicados).toBeGreaterThan(relatosAntes)
  }, 120_000)

  it("na sala comum, quem entra pelo cartão ouve a cascata de UM administrador, com três ligados", async () => {
    const proprio = await levantarServidor()
    try {
      const [ana, bruno, carla] = await contasDeTeste(proprio, ["Ana", "Bruno", "Carla"])
      const contas = [ana!, bruno!, carla!]
      const comum = proprio.sala
      await ana!.session.ensureCommonRoom()
      await ate(() => ana!.session.channels.includes(comum), "a Ana está na sala comum", 30_000)
      if (!ana!.session.founderOf(comum)) await ana!.session.claimFounder(comum)
      await ate(() => ana!.session.founderOf(comum) === ana!.address, "a Ana funda a sala comum")
      await ana!.session.upsertCategory(comum, { category: "Adega", position: 1 })
      await ana!.session.upsertRoom(comum, { room: "prensa", name: "prensa", category: "Adega" })
      for (const admin of [bruno!, carla!]) {
        await admin.session.ensureCommonRoom()
        await ate(() => admin.session.channels.includes(comum), `${admin.nome} entra`, 30_000)
        await ana!.session.assignRoles(comum, admin.address, ["admin"])
        await ate(() => admin.session.mayEditChannel(comum), `${admin.nome} manda`, 30_000)
      }
      await ate(() => proprio.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)
      await esperar(4_000)
      const antes = contas.map((c) => c.session.estatisticasDaArrumacao.cascatas)

      const [eva] = await contasDeTeste(proprio, ["Eva"])
      contas.push(eva!)
      await eva!.session.ensureCommonRoom()
      await ate(() => eva!.session.channels.includes(comum), "a Eva entra pelo cartão", 30_000)
      await ate(() => eva!.session.roomsOf(comum).some((sala) => sala.room === "prensa"), "a Eva vê a sala", 30_000)
      await ate(() => eva!.session.founderOf(comum) === ana!.address, "a Eva sabe quem fundou", 30_000)
      await ate(() => eva!.session.rolesFor(comum, carla!.address).includes("admin"), "a Eva sabe quem é admin", 30_000)
      await esperar(Session.ARRUMACAO_POR_VEZ_MS * Session.ARRUMACAO_VEZES + 2_000)

      const depois = contas.slice(0, 3).map((c) => c.session.estatisticasDaArrumacao.cascatas)
      expect(depois.reduce((a, b) => a + b, 0) - antes.reduce((a, b) => a + b, 0)).toBe(1)
      desligarContas(contas)
    } finally {
      await proprio.fechar()
    }
  }, 180_000)

  /*
    Review finding 1 (12/11/2026): someone joins the common room by the card with no
    admin online. Nobody says the cascade live. The founder comes back later: her
    recovery sees the growth, nobody covered it, so she says it then.
  */
  it("na sala comum, quem entra pelo cartão sem nenhum administrador ligado fica com o estado quando um volta", async () => {
    const proprio = await levantarServidor()
    try {
      const [ana, bruno] = await contasDeTeste(proprio, ["Ana", "Bruno"])
      const contas = [ana!, bruno!]
      const comum = proprio.sala
      await ana!.session.ensureCommonRoom()
      await ate(() => ana!.session.channels.includes(comum), "a Ana está na sala comum", 30_000)
      if (!ana!.session.founderOf(comum)) await ana!.session.claimFounder(comum)
      await ate(() => ana!.session.founderOf(comum) === ana!.address, "a Ana funda a sala comum")
      await ana!.session.updateSpaceMeta(comum, { name: "Praça", topic: "a sala de todos", icon: `data:image/png;base64,${ICONE}` })
      await ana!.session.upsertCategory(comum, { category: "Adega", position: 1 })
      await ana!.session.upsertRoom(comum, { room: "prensa", name: "prensa", category: "Adega" })
      await bruno!.session.ensureCommonRoom()
      await ate(() => bruno!.session.channels.includes(comum), "o Bruno entra", 30_000)
      await ana!.session.assignRoles(comum, bruno!.address, ["admin"])
      await ate(() => bruno!.session.mayEditChannel(comum), "o Bruno manda", 30_000)
      await ate(() => proprio.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)
      await esperar(2_000)

      // 03:00: no admin online.
      ana!.session.disconnect()
      bruno!.session.disconnect()
      await esperar(500)
      const [eva] = await contasDeTeste(proprio, ["Eva"])
      contas.push(eva!)
      await eva!.session.ensureCommonRoom()
      await ate(() => eva!.session.channels.includes(comum), "a Eva entra pelo cartão, sozinha", 30_000)
      await esperar(1_500)
      expect(eva!.session.founderOf(comum)).toBeNull()

      // 09:00: the founder comes back.
      await ana!.session.connect()
      await ate(() => eva!.session.founderOf(comum) === ana!.address, "a Eva sabe quem fundou", 30_000)
      await ate(() => eva!.session.rolesFor(comum, bruno!.address).includes("admin"), "a Eva sabe que o Bruno é admin", 30_000)
      await ate(() => eva!.session.spaceMeta(comum)?.name === "Praça", "a Eva vê o nome", 30_000)
      // The icon: since 1.3.15 it lives in Eva's store, and `spaceMeta` gives its reference (`iconRef`).
      const refDoIcone = (): string | undefined => eva!.session.spaceMeta(comum)?.iconRef
      await ate(() => refDoIcone() !== undefined, "a Eva tem o ícone", 30_000)
      const iconRef = refDoIcone()
      await ateQue(async () => (await mediaNoAparelho(eva!, iconRef!)).blob, "o ícone no armazém da Eva", 30_000)
      const icone = await mediaNoAparelho(eva!, iconRef!)
      expect(icone.referencia).toBe(true)
      expect(Buffer.from(icone.bytes!).equals(Buffer.from(ICONE, "base64"))).toBe(true)
      const recarregada = await recarregar(eva!)
      expect(Buffer.from((await recarregada.session.bytesDeMedia(iconRef!))!).equals(Buffer.from(ICONE, "base64"))).toBe(true)
      await ate(() => eva!.session.roomsOf(comum).some((sala) => sala.room === "prensa"), "a Eva vê a sala", 30_000)
      /*
        One from the end of the recovery. A second one shows up in about half the runs:
        a live commit right after the reconnection reads as growth in
        `#noteMembership` (memory only, see there). Noted in the 1.3.12 report.
      */
      expect(ana!.session.estatisticasDaArrumacao.cascatas).toBeGreaterThanOrEqual(1)
      expect(ana!.session.estatisticasDaArrumacao.cascatas).toBeLessThanOrEqual(2)

      // A second admin comes back: his recovery brings Ana's cascade after the growth, so he stays quiet.
      await bruno!.session.connect()
      // Since 1.3.14 the cascade after a recovery waits for the login to end: wait past it too.
      await esperar(
        Session.ARRUMACAO_DEPOIS_DO_ARRANQUE_MS + Session.ARRUMACAO_OCIOSA_TECTO_MS + Session.ARRUMACAO_POR_VEZ_MS * Session.ARRUMACAO_VEZES + 2_000,
      )
      expect(bruno!.session.estatisticasDaArrumacao.cascatas).toBe(0)
      desligarContas(contas)
    } finally {
      await proprio.fechar()
    }
  }, 180_000)

  it("quem volta depois de uma mudança fica com ela", async () => {
    const { ana, dario, canal } = await canalArrumado()
    dario.session.disconnect()
    await esperar(300)
    await ana.session.upsertRoom(canal, { room: "adega", name: "adega", category: "Geral" })
    await ana.session.assignRoles(canal, dario.address, [])
    await dario.session.connect()
    await ate(() => dario.session.roomsOf(canal).length === 4, "Dário vê a sala nova")
    await ate(() => dario.session.rolesFor(canal, dario.address).length === 0, "Dário perde o cargo")
  }, 120_000)
})

describe("o receptor aguenta a rajada de um cliente antigo", () => {
  it("uma republicação igual ao que já se sabe não chega à interface nem ao cofre", async () => {
    const { ana, dario, canal } = await canalArrumado()
    const vistos: string[] = []
    dario.session.on("message", (m) => {
      if (m.channel === canal && m.sender === ana.address && TIPOS_DE_ESTADO.has(m.payload.t)) vistos.push(m.payload.t)
    })
    const escritasAntes = dario.backend.escritas

    // What a 1.3.7 or 1.3.10 admin does on every connection.
    await ana.session.republishAuthority(canal)
    await ana.session.republishRooms(canal)
    // Then one real change, as a marker that the burst has been read.
    await ana.session.upsertRoom(canal, { room: "marca", name: "marca", category: "Geral" })
    await ate(() => dario.session.roomsOf(canal).length === 4, "Dário lê a rajada e a marca")
    await esperar(2_500)

    // Only the marker reaches the interface: the repeats change nothing.
    expect(vistos).toEqual(["channel.meta"])
    // And the vault is written a handful of times, not once per frame.
    expect(dario.backend.escritas - escritasAntes).toBeLessThanOrEqual(3)
    expect(dario.session.roomsOf(canal)).toHaveLength(4)
    expect(dario.session.rolesFor(canal, dario.address)).toEqual(["guarda"])
  }, 120_000)
})

describe("a rajada da sala comum, ao tamanho real", () => {
  /*
    ~150 `role.assign` in one burst, as `!984` has. The first time they are new and
    reach the interface; the second time (an old admin reconnecting) they are repeats.
    Printed numbers go to the report.
  */
  it("150 atribuições repetidas não chegam à interface", async () => {
    const { ana, dario, canal } = await canalArrumado()
    const atribuicoes = Array.from(
      { length: 150 },
      (_, i) => ({ t: "role.assign", subject: `@pessoa${i}:${servidor.casa}`, roles: ["guarda"], assignedAt: 5_000 + i }) as Payload,
    )
    let chegaram = 0
    dario.session.on("message", (m) => {
      if (m.channel === canal && m.payload.t === "role.assign") chegaram++
    })
    const quantas = (): number => Object.keys(dario.vault.contents.channelMemberRoles[canal] ?? {}).length
    const antes = quantas()
    await ana.session.sendBatch(canal, atribuicoes)
    await ate(() => quantas() >= antes + 150, "o Dário guarda as 150", 30_000)
    await esperar(1_500)
    const primeira = chegaram
    const repetidosAntes = dario.session.estatisticasDoEstado.repetidos
    const escritasAntes = dario.backend.escritas
    const inicio = performance.now()
    await ana.session.sendBatch(canal, atribuicoes)
    await ate(() => dario.session.estatisticasDoEstado.repetidos >= repetidosAntes + 150, "o Dário reconhece as 150 repetidas", 30_000)
    const ms = performance.now() - inicio
    await esperar(1_500)
    console.log(
      `[medida] primeira rajada: ${primeira} à interface; repetida: ${chegaram - primeira} à interface, ` +
        `${dario.session.estatisticasDoEstado.repetidos - repetidosAntes} descartadas, ${dario.backend.escritas - escritasAntes} escritas do cofre, ${Math.round(ms)} ms`,
    )
    expect(primeira).toBe(150)
    expect(chegaram - primeira).toBe(0)
  }, 120_000)
})

describe("a ficha do canal numa escrita adiada (revisão, achado 3)", () => {
  /*
    Since 1.3.12 a live event keeps the MLS group for the next write instead of
    serializing it now. The channel card that rode with the group (`registarFicha`)
    must not wait with it: an old vault with no card for a direct deduces it from
    the tree, and until then the direct reads as a room.
  */
  it("uma directa sem ficha no cofre ganha-a logo com o evento ao vivo, antes da escrita", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const dm = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno tem a directa")
    await esperar(2_500)
    expect(bruno!.vault.contents.fichasDosCanais?.[dm]?.tipo).toBe("directa")
    // An old vault: no card for this direct.
    delete bruno!.vault.contents.fichasDosCanais![dm]
    await ana!.session.send(dm, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: "olá", attachments: [], mentions: [], links: [] } as Payload)
    await ate(() => bruno!.session.history(dm).some((m) => (m.payload as { body?: string }).body === "olá"), "o Bruno recebe")
    // The write is deferred (up to a second); the card is not.
    expect(bruno!.vault.gravacaoAdiada).toBe(true)
    expect(bruno!.vault.contents.fichasDosCanais?.[dm]?.tipo).toBe("directa")
  }, 60_000)
})

describe("os grupos adiados não sobrevivem ao reset (revisão, achado 4)", () => {
  /*
    `reset()` (a lock, an account switch) drops the session's groups. A group kept
    for a deferred write must go with them: the next write after the reset would
    otherwise put a group from before it into the vault.
  */
  it("depois do reset, a escrita seguinte não leva o grupo adiado", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const dm = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno tem a directa")
    await esperar(2_500)
    const noCofre = bruno!.vault.contents.groups[dm]
    await ana!.session.send(dm, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: "olá", attachments: [], mentions: [], links: [] } as Payload)
    await ate(() => bruno!.session.history(dm).some((m) => (m.payload as { body?: string }).body === "olá"), "o Bruno recebe")
    expect(bruno!.vault.gravacaoAdiada).toBe(true)
    bruno!.session.reset()
    await bruno!.vault.update(() => {})
    expect(bruno!.vault.contents.groups[dm]).toBe(noCofre)
  }, 60_000)
})
