import { app, BrowserWindow, globalShortcut, ipcMain } from "electron"
import { join } from "node:path"
import { aceleradorDe, CANAIS_DE_ATALHOS, criarAtalhosGlobais } from "../src/main/atalhos.js"
import {
  CANAIS_DE_CANAL,
  LEITURAS_DE_CANAL,
  ligarCanais,
  PEDIDO_MAL_FORMADO,
  type RegistarLeitura,
  type RegistarPedido,
  type Resposta,
  type SessaoDeCanais,
} from "../src/main/canais.js"
import { embrulharErros } from "../src/main/envelope.js"
import { codigoDoErro } from "../../../packages/ui/src/lib/codigosDeErro.js"

/**
 * The IPC test suite for `apps/client`, on the main process side.
 *
 * **There was none, and that is why 37 channel operations stayed missing without
 * anyone noticing.** `vitest` test suites measure each side of the boundary
 * against a mock, and a mock passes objects by reference, always has the method
 * you ask for, and never clones anything. The real boundary does the opposite
 * of all three.
 *
 * What can only be proven here, and is everything the mocks do not touch:
 *
 *  1. **that `sendSync` works inside the sandbox**, where this `preload` runs.
 *     The whole decision for sync reads rests on this;
 *  2. **that channel names match** between the `preload` and the main process.
 *     A single letter swapped gives no compile error, it gives a button that
 *     does nothing, or a read that never gets an answer;
 *  3. **that `contextBridge` lets these forms through**: what it delivers to the
 *     renderer is a copy, and a function hung on a field does not survive;
 *  4. **that IPC `structuredClone` does not break what crosses it**, and that
 *     an answer too complex to clone arrives as a complaint, not as silence.
 *
 * Runs via `node scripts/ipc-canais-electron.mjs`, which compiles this and the
 * real `preload` and opens a hidden window. Outside `npm test` on purpose: needs
 * the Electron binary and a display session.
 *
 * The session is FAKE, no vault, no MLS, no network. What we measure is the
 * bridge, and the bridge cannot tell a real session from a fake one: that is why
 * this file can exist.
 */

/** What the session saw, so the renderer can ask back. */
const feito: string[] = []

const sala = (room: string, kind: "text" | "voice" = "text") => ({
  room,
  name: `Sala ${room}`,
  category: "geral",
  kind,
  position: 1,
})

/**
 * A fake session, with marked values.
 *
 * Marked so the renderer can compare what it got with what was said here: the
 * only way to measure what `structuredClone` does along the way, dates,
 * `undefined`, missing fields, list order.
 */
const sessao: SessaoDeCanais = {
  roomsOf: (channel) => {
    feito.push(`roomsOf:${channel}`)
    return [sala("a"), { ...sala("v", "voice"), layout: "tickets" }]
  },
  closedRoomsOf: (channel) => {
    feito.push(`closedRoomsOf:${channel}`)
    return [sala("fechada")]
  },
  removedRoomsOf: (channel) => {
    feito.push(`removedRoomsOf:${channel}`)
    return ["apagada"]
  },
  categoriesOf: (channel) => {
    feito.push(`categoriesOf:${channel}`)
    return [{ category: "geral", position: 0, roles: [] }]
  },
  fichasDosCanais: () => {
    feito.push("fichasDosCanais")
    return { "!opaca:servidor": { tipo: "directa", par: "@par:servidor" } }
  },
  spaceMeta: (channel) => {
    feito.push(`spaceMeta:${channel}`)
    /*
      No `topic` or `icon`, on purpose.

      `exactOptionalPropertyTypes` tells "missing" from "present and undefined",
      and `structuredClone` does NOT: a `topic: undefined` crosses as a key
      present with undefined value. The reader must behave the same way in both
      cases, and that is what this absence measures on the other side.
    */
    return { name: "O Canal", updatedAt: 7 }
  },
  mayEditChannel: (channel) => {
    feito.push(`mayEditChannel:${channel}`)
    return true
  },
  founderOf: (channel) => {
    feito.push(`founderOf:${channel}`)
    return "@quem:servidor"
  },
  adminsOf: (channel) => {
    feito.push(`adminsOf:${channel}`)
    return ["@outro:servidor"]
  },
  rolesOf: (channel) => {
    feito.push(`rolesOf:${channel}`)
    return [{ role: "guarda", name: "Guarda", powers: ["fixar", "atender"], colour: "brasa", position: 0 }]
  },
  adminRole: (channel) => {
    feito.push(`adminRole:${channel}`)
    return { name: "Guardiões", colour: "ambar" }
  },
  rolesFor: (channel, address) => {
    feito.push(`rolesFor:${channel}:${address}`)
    return ["guarda"]
  },
  mayManageRoles: (channel) => {
    feito.push(`mayManageRoles:${channel}`)
    return true
  },
  pinnedOf: (channel, room) => {
    feito.push(`pinnedOf:${channel}:${room}`)
    return [
      { id: "m1", sender: "@quem:servidor", body: "a cópia do texto", sentAt: 3, pinnedAt: 4, pinnedBy: "@quem:servidor" },
    ]
  },
  mayPin: (channel) => {
    feito.push(`mayPin:${channel}`)
    return true
  },
  ticketsOf: (channel, room) => {
    feito.push(`ticketsOf:${channel}:${room}`)
    return [
      {
        id: "t1",
        subject: "a porta",
        state: "working",
        opener: "@quem:servidor",
        assignee: "@outro:servidor",
        openedAt: 1,
        updatedAt: 2,
        messages: 3,
      },
    ]
  },
  mayDecideTicket: (channel, room, ticket) => {
    feito.push(`mayDecideTicket:${channel}:${room}:${ticket}`)
    return true
  },
  mayDeleteChannel: (channel) => {
    feito.push(`mayDeleteChannel:${channel}`)
    return true
  },
  mayModerate: (channel, address) => {
    feito.push(`mayModerate:${channel}:${address}`)
    return true
  },
  nicknamesOf: (channel) => {
    feito.push(`nicknamesOf:${channel}`)
    return {}
  },
  may: (channel, power) => {
    feito.push(`may:${channel}:${power}`)
    return power !== "expulsar"
  },
  categoryTombstonesOf: (channel) => {
    feito.push(`categoryTombstonesOf:${channel}`)
    return []
  },
  mayTransmit: () => true,
  mayCreatePoll: () => true,

  /*
    The 1.2 permission model (1.3.25). Each answer depends on its arguments, so
    a constant answer, or arguments swapped on the way, fail the bench: moving
    is allowed and disconnecting (no `para`) is not; the default room (`""`)
    and no place at all answer differently.
  */
  mayMoveIn: (channel, de, para) => {
    feito.push(`mayMoveIn:${channel}:${de}:${para}`)
    return para !== undefined
  },
  todosOf: (channel) => {
    feito.push(`todosOf:${channel}`)
    return { powers: ["escrever"], definido: true }
  },
  permissoesEm: (channel, address, lugar) => {
    feito.push(`permissoesEm:${channel}:${address}:${JSON.stringify(lugar)}`)
    return lugar === undefined ? ["fixar"] : ["escrever"]
  },
  mayManageRole: (channel, role) => {
    feito.push(`mayManageRole:${channel}:${role}`)
    return role === "guarda"
  },
  delegacaoDeCargos: (channel) => {
    feito.push(`delegacaoDeCargos:${channel}`)
    return true
  },
  sobreposicoesDe: (channel, lugar) => {
    feito.push(`sobreposicoesDe:${channel}:${JSON.stringify(lugar)}`)
    return [{ role: "guarda", allow: ["escrever"], deny: ["fixar"] }]
  },
  maySetSobreposicoes: (channel, lugar) => {
    feito.push(`maySetSobreposicoes:${channel}:${JSON.stringify(lugar)}`)
    return "sala" in lugar
  },
  setSobreposicoes: async (channel, lugar, perms) => {
    feito.push(`setSobreposicoes:${channel}:${JSON.stringify(lugar)}:${JSON.stringify(perms)}`)
  },
  reaccoesGuardadas: (channel) => {
    feito.push(`reaccoesGuardadas:${channel}`)
    return REACCOES_GUARDADAS
  },

  upsertRoom: async (channel, next) => {
    feito.push(`upsertRoom:${channel}:${JSON.stringify(next)}`)
  },
  upsertCategory: async (channel, next) => {
    feito.push(`upsertCategory:${channel}:${JSON.stringify(next)}`)
  },
  pinMessage: async (channel, room, message) => {
    feito.push(`pinMessage:${channel}:${room}:${JSON.stringify(message)}`)
  },
  unpinMessage: async (channel, room, id) => {
    feito.push(`unpinMessage:${channel}:${room}:${id}`)
  },
  openTicket: async (channel, room, subject) => {
    feito.push(`openTicket:${channel}:${room}:${subject}`)
    return "t-novo"
  },
  replyToTicket: async (channel, room, ticket, body) => {
    feito.push(`replyToTicket:${channel}:${room}:${ticket}:${body}`)
  },
  setTicketState: async (channel, room, ticket, state) => {
    feito.push(`setTicketState:${channel}:${room}:${ticket}:${state}`)
  },
  takeTicket: async (channel, room, ticket) => {
    feito.push(`takeTicket:${channel}:${room}:${ticket}`)
  },
  releaseTicket: async (channel, room, ticket) => {
    feito.push(`releaseTicket:${channel}:${room}:${ticket}`)
  },
  deleteTicket: async (channel, room, ticket) => {
    feito.push(`deleteTicket:${channel}:${room}:${ticket}`)
  },
  setNickname: async (channel, subject, nick) => {
    feito.push(`setNickname:${channel}:${subject}:${nick}`)
  },
  moveVoice: async (channel, subject, room, de) => {
    feito.push(`moveVoice:${channel}:${subject}:${room}${de === undefined ? "" : `:de=${de}`}`)
  },
  disconnectVoice: async (channel, subject, de) => {
    feito.push(`disconnectVoice:${channel}:${subject}${de === undefined ? "" : `:de=${de}`}`)
  },
  reorderRoles: async (channel, ordem) => {
    feito.push(`reorderRoles:${channel}:${ordem.join("+")}`)
  },
  reactToMessage: async (channel, target, emoji, remove) => {
    feito.push(`reactToMessage:${channel}:${target}:${emoji}:${remove}`)
  },
  assignRole: async (channel, subject, admin) => {
    feito.push(`assignRole:${channel}:${subject}:${admin}`)
  },
  assignRoles: async (channel, subject, roles) => {
    feito.push(`assignRoles:${channel}:${subject}:${roles.join("+")}`)
  },
  defineRole: async (channel, next) => {
    feito.push(`defineRole:${channel}:${JSON.stringify(next)}`)
  },
  deleteRole: async (channel, role) => {
    feito.push(`deleteRole:${channel}:${role}`)
  },
  claimFounder: async (channel) => {
    feito.push(`claimFounder:${channel}`)
  },
  updateSpaceMeta: async (channel, next) => {
    feito.push(`updateSpaceMeta:${channel}:${JSON.stringify(next)}`)
  },
  editMessage: async (channel, target, body) => {
    feito.push(`editMessage:${channel}:${target}:${body}`)
  },
  deleteMessage: async (channel, target) => {
    feito.push(`deleteMessage:${channel}:${target}`)
  },
  deleteChannel: async (channel) => {
    feito.push(`deleteChannel:${channel}`)
  },
}

/**
 * A session that returns what does NOT cross IPC.
 *
 * An object with a function inside, which is the real case: a core method that
 * starts returning something with methods, or a convenience `Map`. Without the
 * `provarQueAtravessa` check, cloning breaks inside Electron and the sync read
 * gets **no answer at all**, the renderer stalled, no error anywhere. The only
 * way to measure it: here, with real Electron.
 */
const sessaoImpossivel: SessaoDeCanais = {
  ...sessao,
  spaceMeta: () =>
    ({ name: "O Canal", updatedAt: 1, aoLer: () => "isto não atravessa" }) as unknown as ReturnType<
      SessaoDeCanais["spaceMeta"]
    >,
}

/** What the renderer asks this process. Outside the bridge, only for the suite. */
const CANAL_DO_RASTO = "bancada:rasto"
const CANAL_IMPOSSIVEL = "bancada:impossivel"
const CANAL_ERRO_SIMPLES = "bancada:erro-simples"
const CANAL_ERRO_FUNCAO = "bancada:erro-funcao"
/** The literal `index.ts` registers for `social.canaisSurdos` and the preload invokes. */
const CANAL_CANAIS_SURDOS = "social:canais-surdos"
/** The deaf channels, as `Session.canaisSurdos` returns them. */
const CANAIS_SURDOS = ["!surdo:servidor", "!outro-surdo:servidor"]
/** Stored chat reactions, the shape `Session.reaccoesGuardadas` returns. */
const REACCOES_GUARDADAS = [
  { seq: 5, sender: "@outro:servidor", at: 50, payload: { t: "reaction", target: "m1", emoji: "👩🏻‍❤️‍💋‍👨🏻" } },
  { seq: 6, sender: "@quem:servidor", at: 60, apos: 4, payload: { t: "reaction", target: "m1", emoji: "🔥", remove: true } },
]

/**
 * Global shortcuts (1.0.6), with a fake `globalShortcut` that stores the
 * functions: the suite presses the "key" by calling it, and measures if the
 * alert reaches the renderer through the real `preload`. The same channels that
 * `index.ts` registers.
 */
const teclasDaBancada = new Map<string, () => void>()
let janelaDosAtalhos: BrowserWindow | null = null
const atalhosDaBancada = criarAtalhosGlobais({
  porta: {
    register: (acelerador, aoCarregar) => {
      teclasDaBancada.set(acelerador, aoCarregar)
      return true
    },
    unregister: (acelerador) => {
      teclasDaBancada.delete(acelerador)
    },
    setSuspended: () => {},
  },
  plataforma: process.platform,
  temAcessibilidade: () => true,
  aoAccionar: (accao) => janelaDosAtalhos?.webContents.send(CANAIS_DE_ATALHOS.accionado, accao),
})

function registarPontes(): void {
  // With the envelope, like in the app: a request that breaks comes back as
  // `{ ok:false, chave, detalhe, nome }`, not as a rewritten exception.
  const registarPedido: RegistarPedido = (canal, ouvinte) => {
    ipcMain.handle(canal, embrulharErros((_evento, ...argumentos) => (ouvinte as (...q: unknown[]) => unknown)(...argumentos)))
  }
  // Two requests that break on purpose, to measure the envelope in real Electron:
  // one with simple `cause`, another with a `cause` that does not serialize.
  ipcMain.handle(
    CANAL_ERRO_SIMPLES,
    embrulharErros(() => {
      throw new Error("vault is locked", { cause: { n: 1 } })
    }),
  )
  ipcMain.handle(
    CANAL_ERRO_FUNCAO,
    embrulharErros(() => {
      const erro = new Error("vault storage is full", { cause: () => "não atravessa" })
      erro.name = "QuotaExceededError"
      throw erro
    }),
  )
  const registarLeitura: RegistarLeitura = (canal, ouvinte) => {
    ipcMain.on(canal, (evento, ...argumentos) => {
      evento.returnValue = (ouvinte as (...q: unknown[]) => Resposta<unknown>)(...argumentos)
    })
  }

  ligarCanais({ registarPedido, registarLeitura, sessao })

  /*
    `social.canaisSurdos` (1.3.25) is registered in `index.ts`, outside
    `ligarCanais`, with no argument: wired here by hand under the same name, so
    what is measured is the preload's name and the list crossing the clone.
  */
  ipcMain.handle(
    CANAL_CANAIS_SURDOS,
    embrulharErros(() => {
      feito.push("canaisSurdos")
      return CANAIS_SURDOS
    }),
  )

  ipcMain.handle(CANAIS_DE_ATALHOS.definir, embrulharErros((_evento, pedido: unknown) => atalhosDaBancada.definir(pedido)))
  ipcMain.handle(CANAIS_DE_ATALHOS.suspender, embrulharErros(() => ({ ok: true })))
  ipcMain.handle(CANAIS_DE_ATALHOS.abrirAcessibilidade, embrulharErros(() => ({ ok: false })))

  // The trace: what the session saw, so the renderer can compare arguments.
  ipcMain.handle(CANAL_DO_RASTO, () => [...feito])

  /*
    And the same connection again, with the impossible session, under another
    channel name so the two coexist. This is `provarQueAtravessa` measured
    against real Electron, not the `structuredClone` of Node.
  */
  ligarCanais({
    registarPedido: () => {},
    /*
      Only reading the properties, and by a name unique to this suite: the others
      are more connections on the same channel, and the first to answer won,       which is how this measurement started giving green with the wrong answer.
      */
    registarLeitura: (canal, ouvinte) => {
      if (canal !== LEITURAS_DE_CANAL.propriedades) return
      ipcMain.on(CANAL_IMPOSSIVEL, (evento, ...argumentos) => {
        evento.returnValue = (ouvinte as (...q: unknown[]) => Resposta<unknown>)(...argumentos)
      })
    },
    sessao: sessaoImpossivel,
  })
}

/** What the renderer returns: a list of proofs, each with its own verdict. */
interface Prova {
  nome: string
  passou: boolean
  detalhe: string
}

async function medir(janela: BrowserWindow): Promise<Prova[]> {
  const guiao = `(() => {
    const provas = []
    const prender = (nome, passou, detalhe = "") => provas.push({ nome, passou, detalhe: String(detalhe) })
    const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

    const anfitriao = window.enclaveHost
    if (!anfitriao || !anfitriao.channels) {
      prender("o preload expõe channels", false, "window.enclaveHost.channels não existe")
      return JSON.stringify(provas)
    }
    const canais = anfitriao.channels

    // ---------------------------------------------------------- a superfície
    const esperadas = ${JSON.stringify([
      "rooms",
      "closedRooms",
      "removedRooms",
      "categories",
      "setRoom",
      "setCategory",
      "meta",
      "setMeta",
      "mayEdit",
      "founder",
      "admins",
      "setAdmin",
      "claimFounder",
      "mayDelete",
      "remove",
      "roles",
      "rolesFor",
      "mayManageRoles",
      "setRoles",
      "defineRole",
      "deleteRole",
      "mayAttend",
      "mayMove",
      "mayInvite",
      "mayExpel",
      "moveVoice",
      "disconnectVoice",
      "adminRole",
      "pins",
      "mayPin",
      "pin",
      "unpin",
      "tickets",
      "mayDecideTicket",
      "openTicket",
      "replyToTicket",
      "setTicketState",
      "takeTicket",
      "releaseTicket",
      "editMessage",
      "deleteMessage",
      "mayMoveIn",
      "reaccoesGuardadas",
    ])}
    const emFalta = esperadas.filter((nome) => typeof canais[nome] !== "function")
    prender("as " + esperadas.length + " operações atravessam o contextBridge", emFalta.length === 0, emFalta.join(", "))

    // O modelo de permissões 1.2 vem aninhado, como na ponte da interface: 7 funções.
    const DO_MODELO = ["todos", "em", "mayManageRole", "delegacao", "sobreposicoes", "maySetSobreposicoes", "setSobreposicoes"]
    const permissoes = canais.permissoes
    const faltaNoModelo = permissoes ? DO_MODELO.filter((nome) => typeof permissoes[nome] !== "function") : DO_MODELO
    prender("as 7 operações de channels.permissoes atravessam o contextBridge", faltaNoModelo.length === 0, faltaNoModelo.join(", "))

    // ------------------------------------------- as leituras, pelo sendSync
    const CANAL = "!geral:servidor"
    const leituras = [
      ["rooms", () => canais.rooms(CANAL), [
        { room: "a", name: "Sala a", category: "geral", kind: "text", position: 1 },
        { room: "v", name: "Sala v", category: "geral", kind: "voice", position: 1, layout: "tickets" },
      ]],
      ["closedRooms", () => canais.closedRooms(CANAL), [
        { room: "fechada", name: "Sala fechada", category: "geral", kind: "text", position: 1 },
      ]],
      ["removedRooms", () => canais.removedRooms(CANAL), ["apagada"]],
      ["categories", () => canais.categories(CANAL), [{ category: "geral", position: 0, roles: [] }]],
      ["meta", () => canais.meta(CANAL), { name: "O Canal", updatedAt: 7 }],
      ["mayEdit", () => canais.mayEdit(CANAL), true],
      ["founder", () => canais.founder(CANAL), "@quem:servidor"],
      ["admins", () => canais.admins(CANAL), ["@outro:servidor"]],
      ["mayDelete", () => canais.mayDelete(CANAL), true],
      ["roles", () => canais.roles(CANAL), [
        { role: "guarda", name: "Guarda", powers: ["fixar", "atender"], colour: "brasa", position: 0 },
      ]],
      ["rolesFor", () => canais.rolesFor(CANAL, "@alguem:servidor"), ["guarda"]],
      ["adminRole", () => canais.adminRole(CANAL), { name: "Guardiões", colour: "ambar" }],
      ["mayManageRoles", () => canais.mayManageRoles(CANAL), true],
      ["mayAttend", () => canais.mayAttend(CANAL), true],
      ["mayMove", () => canais.mayMove(CANAL), true],
      ["mayInvite", () => canais.mayInvite(CANAL), true],
      // A sessão da bancada recusa 'expulsar' de propósito: um 'sim' constante
      // passaria neste teste com a resposta errada.
      ["mayExpel", () => canais.mayExpel(CANAL), false],
      ["pins", () => canais.pins(CANAL, "sala"), [
        { id: "m1", sender: "@quem:servidor", body: "a cópia do texto", sentAt: 3, pinnedAt: 4, pinnedBy: "@quem:servidor" },
      ]],
      ["mayPin", () => canais.mayPin(CANAL), true],
      ["tickets", () => canais.tickets(CANAL, "sala"), [
        { id: "t1", subject: "a porta", state: "working", opener: "@quem:servidor", assignee: "@outro:servidor", openedAt: 1, updatedAt: 2, messages: 3 },
      ]],
      ["mayDecideTicket", () => canais.mayDecideTicket(CANAL, "sala", "t1"), true],

      // O modelo de permissões 1.2 (1.3.25). A sessão responde conforme os argumentos.
      ["mayMoveIn mover", () => canais.mayMoveIn(CANAL, "a", "v"), true],
      ["mayMoveIn desligar", () => canais.mayMoveIn(CANAL, "a"), false],
      ["mayMoveIn para a sala de omissão", () => canais.mayMoveIn(CANAL, "a", ""), true],
      ["permissoes.todos", () => permissoes.todos(CANAL), { powers: ["escrever"], definido: true }],
      ["permissoes.em no canal", () => permissoes.em(CANAL, "@alguem:servidor"), ["fixar"]],
      ["permissoes.em na sala de omissão", () => permissoes.em(CANAL, "@alguem:servidor", { sala: "" }), ["escrever"]],
      ["permissoes.mayManageRole o seu", () => permissoes.mayManageRole(CANAL, "guarda"), true],
      ["permissoes.mayManageRole outro", () => permissoes.mayManageRole(CANAL, "porteiro"), false],
      ["permissoes.delegacao", () => permissoes.delegacao(CANAL), true],
      ["permissoes.sobreposicoes", () => permissoes.sobreposicoes(CANAL, { categoria: "geral" }), [
        { role: "guarda", allow: ["escrever"], deny: ["fixar"] },
      ]],
      ["permissoes.maySetSobreposicoes sala", () => permissoes.maySetSobreposicoes(CANAL, { sala: "a" }), true],
      ["permissoes.maySetSobreposicoes categoria", () => permissoes.maySetSobreposicoes(CANAL, { categoria: "geral" }), false],
    ]

    for (const [nome, ler, esperado] of leituras) {
      let resposta
      try {
        resposta = ler()
      } catch (erro) {
        prender("leitura " + nome, false, "atirou: " + erro.message)
        continue
      }
      if (resposta instanceof Promise) {
        // O defeito do mayExpel: uma promessa é verdadeira, e '?? false' deixa-a
        // passar inteira. Se o sendSync não funcionasse no sandbox, era aqui.
        prender("leitura " + nome, false, "respondeu com uma promessa")
        continue
      }
      if (!resposta || resposta.ok !== true) {
        prender("leitura " + nome, false, "envelope: " + JSON.stringify(resposta))
        continue
      }
      prender("leitura " + nome, igual(resposta.valor, esperado), "recebido: " + JSON.stringify(resposta.valor))
    }

    // ------------------------- argumentos recusados nas leituras (Erro 385)
    /*
      A forma que a ponte da interface não declara volta no envelope com a
      chave do Erro 385, e a sessão nunca a vê: o rasto mede essa metade.
    */
    const MAL_FORMADO = ${JSON.stringify(PEDIDO_MAL_FORMADO)}
    const recusadas = [
      ["mayMoveIn com de que não é texto", () => canais.mayMoveIn(CANAL, 7, "v")],
      ["mayMoveIn com canal vazio", () => canais.mayMoveIn("", "a", "v")],
      ["mayMoveIn com para que não é texto", () => canais.mayMoveIn(CANAL, "a", { sala: "v" })],
      ["permissoes.todos com canal que não é texto", () => permissoes.todos(42)],
      ["permissoes.em com sala e categoria", () => permissoes.em(CANAL, "@alguem:servidor", { sala: "a", categoria: "geral" })],
      ["permissoes.em com endereço vazio", () => permissoes.em(CANAL, "")],
      ["permissoes.em com lugar null", () => permissoes.em(CANAL, "@alguem:servidor", null)],
      ["permissoes.mayManageRole com cargo vazio", () => permissoes.mayManageRole(CANAL, "")],
      ["permissoes.delegacao sem canal", () => permissoes.delegacao(null)],
      ["permissoes.sobreposicoes com categoria vazia", () => permissoes.sobreposicoes(CANAL, { categoria: "" })],
      ["permissoes.sobreposicoes sem lugar", () => permissoes.sobreposicoes(CANAL)],
      ["permissoes.maySetSobreposicoes com lugar em lista", () => permissoes.maySetSobreposicoes(CANAL, ["sala"])],
    ]
    for (const [nome, ler] of recusadas) {
      let resposta
      try {
        resposta = ler()
      } catch (erro) {
        prender("recusa " + nome, false, "atirou no renderer: " + erro.message)
        continue
      }
      prender(
        "recusa " + nome,
        resposta && resposta.ok === false && resposta.erro === MAL_FORMADO,
        "recebido: " + JSON.stringify(resposta),
      )
    }

    // ------------------------------------- o que o structuredClone faz ao meio
    const meta = canais.meta(CANAL)
    prender(
      "os campos ausentes continuam ausentes depois de clonados",
      meta.ok && !("topic" in meta.valor) && !("icon" in meta.valor),
      JSON.stringify(meta.valor),
    )
    const salas = canais.rooms(CANAL)
    prender(
      "a ordem das listas sobrevive",
      salas.ok && salas.valor[0].room === "a" && salas.valor[1].room === "v",
      JSON.stringify(salas.ok && salas.valor.map((cada) => cada.room)),
    )
    const outraVez = canais.rooms(CANAL)
    prender(
      "cada leitura traz uma CÓPIA, e não a mesma referência",
      salas.ok && outraVez.ok && salas.valor !== outraVez.valor && igual(salas.valor, outraVez.valor),
      "",
    )

    // ------------------------------------------------ quanto custa perguntar
    /*
      O número que sustenta a decisão inteira das leituras síncronas.

      Cada uma destas BLOQUEIA o renderer até o outro processo responder, e a
      interface faz dezenas por render. Se cada uma custasse milissegundos, a
      memória da ponte não chegava e o desenho certo seria outro — um espelho
      empurrado, com o preço de ficar velho. Medido aqui em vez de suposto.
    */
    const VOLTAS = 200
    const comeco = performance.now()
    for (let volta = 0; volta < VOLTAS; volta += 1) canais.rooms(CANAL)
    const porLeitura = (performance.now() - comeco) / VOLTAS
    prender(
      "uma leitura síncrona custa menos de meio milissegundo",
      porLeitura < 0.5,
      porLeitura.toFixed(3) + " ms por leitura, em " + VOLTAS + " voltas",
    )

    // --------------------------------------------- os pedidos, pelo invoke
    const pedidos = (async () => {
      const feitos = []
      await canais.setRoom(CANAL, { room: "nova", name: "Nova", category: "geral", kind: "voice", position: 2, layout: "tickets", closed: false })
      feitos.push("setRoom")
      await canais.setCategory(CANAL, { category: "Voz", position: 1, roles: ["guarda"] })
      feitos.push("setCategory")
      await canais.setMeta(CANAL, { name: "Outro nome", topic: "o tópico" })
      feitos.push("setMeta")
      await canais.setAdmin(CANAL, "@alguem:servidor", true)
      feitos.push("setAdmin")
      await canais.claimFounder(CANAL)
      feitos.push("claimFounder")
      await canais.remove(CANAL)
      feitos.push("remove")
      await canais.setRoles(CANAL, "@alguem:servidor", ["guarda", "porteiro"])
      feitos.push("setRoles")
      await canais.defineRole(CANAL, { role: "guarda", name: "Guarda", powers: ["fixar"], colour: "brasa", position: 0 })
      feitos.push("defineRole")
      await canais.deleteRole(CANAL, "guarda")
      feitos.push("deleteRole")
      await canais.moveVoice(CANAL, "@alguem:servidor", "v")
      feitos.push("moveVoice")
      await canais.disconnectVoice(CANAL, "@alguem:servidor")
      feitos.push("disconnectVoice")
      await canais.pin(CANAL, "sala", { id: "m1", sender: "@quem:servidor", body: "a cópia", sentAt: 9 })
      feitos.push("pin")
      await canais.unpin(CANAL, "sala", "m1")
      feitos.push("unpin")
      const aberto = await canais.openTicket(CANAL, "sala", "a porta")
      feitos.push("openTicket:" + JSON.stringify(aberto))
      await canais.replyToTicket(CANAL, "sala", "t1", "já vou")
      feitos.push("replyToTicket")
      await canais.setTicketState(CANAL, "sala", "t1", "closed")
      feitos.push("setTicketState")
      await canais.takeTicket(CANAL, "sala", "t1")
      feitos.push("takeTicket")
      await canais.releaseTicket(CANAL, "sala", "t1")
      feitos.push("releaseTicket")
      await canais.editMessage(CANAL, "m1", "assim é que é")
      feitos.push("editMessage")
      await canais.deleteMessage(CANAL, "m1")
      feitos.push("deleteMessage")

      // 1.3.25: a origem nos gestos de voz, as sobreposições e as reacções guardadas.
      await canais.moveVoice(CANAL, "@alguem:servidor", "v", "a")
      feitos.push("moveVoice com de")
      await canais.disconnectVoice(CANAL, "@alguem:servidor", "a")
      feitos.push("disconnectVoice com de")
      const definido = await permissoes.setSobreposicoes(CANAL, { categoria: "geral" }, [
        { role: "guarda", allow: ["escrever"], deny: [] },
        { role: "porteiro", lixo: "não passa" },
      ])
      feitos.push("setSobreposicoes:" + JSON.stringify(definido))
      const guardadas = await canais.reaccoesGuardadas(CANAL)
      feitos.push("reaccoesGuardadas:" + JSON.stringify(guardadas))
      // Outside the channel operations, so outside the count: the deaf channels, no argument.
      const surdos = await anfitriao.social.canaisSurdos()

      // Pedidos recusados: o envelope traz a chave do 385 e, no detalhe, o argumento.
      const pedidosRecusados = [
        ["setSobreposicoes com allow que não é lista", () => permissoes.setSobreposicoes(CANAL, { sala: "a" }, [{ role: "guarda", allow: "escrever" }])],
        ["setSobreposicoes com 17 entradas", () => permissoes.setSobreposicoes(CANAL, { sala: "a" }, Array.from({ length: 17 }, (_, i) => ({ role: "c" + i })))],
        ["setSobreposicoes com lugar a mais", () => permissoes.setSobreposicoes(CANAL, { sala: "a", extra: 1 }, [])],
        ["setSobreposicoes sem cargo", () => permissoes.setSobreposicoes(CANAL, { sala: "a" }, [{ allow: [] }])],
        ["moveVoice com de que não é texto", () => canais.moveVoice(CANAL, "@alguem:servidor", "v", 5)],
        ["disconnectVoice com de que não é texto", () => canais.disconnectVoice(CANAL, "@alguem:servidor", { sala: "a" })],
        ["reaccoesGuardadas com canal que não é texto", () => canais.reaccoesGuardadas(42)],
        ["reaccoesGuardadas com canal vazio", () => canais.reaccoesGuardadas("")],
      ]
      const recusas = []
      for (const [nome, pedir] of pedidosRecusados) {
        let resposta
        try {
          resposta = await pedir()
        } catch (erro) {
          resposta = { rebentou: String(erro) }
        }
        recusas.push([nome, resposta])
      }
      return { feitos, recusas, surdos }
    })()

    return pedidos.then(
      ({ feitos, recusas, surdos }) => {
        prender("os 24 pedidos atravessam por invoke", feitos.length === 24, feitos.join(", "))
        prender(
          "social.canaisSurdos responde, sem argumentos, com a lista inteira",
          JSON.stringify(surdos) === ${JSON.stringify(JSON.stringify(CANAIS_SURDOS))},
          "recebido: " + JSON.stringify(surdos),
        )
        prender(
          "setSobreposicoes responde ok",
          feitos.includes('setSobreposicoes:{"ok":true}'),
          feitos.filter((cada) => cada.startsWith("setSobreposicoes")).join(""),
        )
        prender(
          "as reacções guardadas atravessam inteiras, emoji composto e campos opcionais",
          feitos.includes("reaccoesGuardadas:" + ${JSON.stringify(JSON.stringify(REACCOES_GUARDADAS))}),
          feitos.filter((cada) => cada.startsWith("reaccoesGuardadas")).join(""),
        )
        for (const [nome, resposta] of recusas) {
          prender(
            "recusa " + nome,
            resposta && resposta.ok === false && resposta.chave === MAL_FORMADO &&
              resposta.detalhe && typeof resposta.detalhe.argumento === "string" && typeof resposta.detalhe.esperado === "string",
            "recebido: " + JSON.stringify(resposta),
          )
        }
        prender(
          "abrir um ticket devolve o identificador",
          feitos.some((cada) => cada === 'openTicket:{"ok":true,"id":"t-novo"}'),
          feitos.filter((cada) => cada.startsWith("openTicket")).join(""),
        )
        return JSON.stringify(provas)
      },
      (erro) => {
        prender("os 24 pedidos atravessam por invoke", false, erro.message)
        return JSON.stringify(provas)
      },
    )
  })()`

  const cru = (await janela.webContents.executeJavaScript(guiao)) as string
  return JSON.parse(cru) as Prova[]
}

/** The trace on the session side: what arrived, and with what arguments. */
function provasDoRasto(): Prova[] {
  const tem = (procurado: string): boolean => feito.some((cada) => cada === procurado)
  const CANAL = "!geral:servidor"
  const esperados: [string, string][] = [
    [
      "a sala atravessa inteira, com layout e tudo",
      `upsertRoom:${CANAL}:${JSON.stringify({ room: "nova", name: "Nova", category: "geral", kind: "voice", position: 2, layout: "tickets", closed: false })}`,
    ],
    [
      "a categoria leva os papéis que a restringem",
      `upsertCategory:${CANAL}:${JSON.stringify({ category: "Voz", position: 1, roles: ["guarda"] })}`,
    ],
    [
      "a fixação leva a CÓPIA do texto, e não só o identificador",
      `pinMessage:${CANAL}:sala:${JSON.stringify({ id: "m1", sender: "@quem:servidor", body: "a cópia", sentAt: 9 })}`,
    ],
    [
      "o papel leva os poderes e a cor",
      `defineRole:${CANAL}:${JSON.stringify({ role: "guarda", name: "Guarda", powers: ["fixar"], colour: "brasa", position: 0 })}`,
    ],
    ["a lista de papéis chega como lista", `assignRoles:${CANAL}:@alguem:servidor:guarda+porteiro`],
    ["o estado do ticket chega no lugar certo", `setTicketState:${CANAL}:sala:t1:closed`],
    ["mover a voz leva a pessoa e a sala", `moveVoice:${CANAL}:@alguem:servidor:v`],
    ["desligar da voz leva a pessoa", `disconnectVoice:${CANAL}:@alguem:servidor`],
    ["emendar leva o alvo e o corpo", `editMessage:${CANAL}:m1:assim é que é`],
    // 1.3.25: the 1.2 permission model and the origin of the voice gestures.
    ["mover a voz leva a sala de origem", `moveVoice:${CANAL}:@alguem:servidor:v:de=a`],
    ["desligar da voz leva a sala de origem", `disconnectVoice:${CANAL}:@alguem:servidor:de=a`],
    ["mayMoveIn leva origem e destino por ordem", `mayMoveIn:${CANAL}:a:v`],
    ["mayMoveIn sem destino chega como desligar", `mayMoveIn:${CANAL}:a:undefined`],
    ["mayMoveIn para a sala de omissão leva o texto vazio", `mayMoveIn:${CANAL}:a:`],
    ["permissoes.em sem lugar chega sem lugar", `permissoesEm:${CANAL}:@alguem:servidor:undefined`],
    ["permissoes.em na sala de omissão leva { sala: \"\" }", `permissoesEm:${CANAL}:@alguem:servidor:${JSON.stringify({ sala: "" })}`],
    ["sobreposicoes leva a categoria", `sobreposicoesDe:${CANAL}:${JSON.stringify({ categoria: "geral" })}`],
    [
      "setSobreposicoes copia campo a campo: o lixo fica, allow e deny por omissão",
      `setSobreposicoes:${CANAL}:${JSON.stringify({ categoria: "geral" })}:${JSON.stringify([
        { role: "guarda", allow: ["escrever"], deny: [] },
        { role: "porteiro", allow: [], deny: [] },
      ])}`,
    ],
    ["as reacções guardadas levam o canal", `reaccoesGuardadas:${CANAL}`],
  ]
  const provas = esperados.map(([nome, procurado]) => ({
    nome,
    passou: tem(procurado),
    detalhe: tem(procurado) ? "" : `não veio: ${procurado}`,
  }))

  /*
    The other half of a refusal: the session never saw it. The refused calls
    use markers no valid call uses (an empty channel, 7, 42, 5, 17 overrides,
    an `extra` key); any of them in the trace means a check was skipped.
  */
  const marcasDeRecusa = [
    (cada: string) => cada.startsWith("mayMoveIn::"),
    (cada: string) => cada.startsWith(`mayMoveIn:${CANAL}:7:`),
    (cada: string) => cada.startsWith(`mayMoveIn:${CANAL}:a:[object`),
    (cada: string) => cada.startsWith("todosOf:42"),
    (cada: string) => cada.startsWith("permissoesEm:") && (cada.includes('"categoria":"geral","sala"') || cada.includes('"sala":"a","categoria"') || cada.endsWith(":null") || cada.includes(`${CANAL}::`)),
    (cada: string) => cada === `mayManageRole:${CANAL}:`,
    (cada: string) => cada.startsWith("delegacaoDeCargos:null"),
    (cada: string) => cada.startsWith("sobreposicoesDe:") && !cada.endsWith(JSON.stringify({ categoria: "geral" })),
    (cada: string) => cada.startsWith("maySetSobreposicoes:") && cada.includes("["),
    (cada: string) => cada.startsWith("setSobreposicoes:") && !cada.includes(JSON.stringify({ categoria: "geral" })),
    (cada: string) => /^(moveVoice|disconnectVoice):.*:de=(5|\[object)/.test(cada),
  ]
  const fugidas = feito.filter((cada) => marcasDeRecusa.some((marca) => marca(cada)))
  provas.push({
    nome: "nenhum argumento recusado chegou à sessão",
    passou: fugidas.length === 0,
    detalhe: fugidas.join("; "),
  })
  provas.push({
    nome: "a chave das recusas é o Erro 385",
    passou: codigoDoErro(PEDIDO_MAL_FORMADO) === 385,
    detalhe: `codigoDoErro deu ${codigoDoErro(PEDIDO_MAL_FORMADO)}`,
  })
  return provas
}

/**
 * What happens to a response that cannot be cloned.
 *
 * In another window, with the suite `preload`: asking for a raw channel is
 * something the real `preload` does not do, and should not start doing for a test.
 *
 * **With a timeout**, and the timeout is the important half of this test: if the
 * clone check disappears, Electron breaks while serializing, nobody answers, and
 * `sendSync` waits forever, the very bug we are measuring. Without a timeout,
 * the suite would hang exactly when it was right.
 */
async function medirOImpossivel(): Promise<Prova> {
  const janela = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload-bancada.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await janela.loadURL("about:blank")

  const pergunta = janela.webContents.executeJavaScript(
    `JSON.stringify(window.bancada.lerEmCru(${JSON.stringify(CANAL_IMPOSSIVEL)}) ?? null)`,
  ) as Promise<string>
  const prazo = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000))
  const cru = await Promise.race([pergunta, prazo])

  if (cru === null) {
    return {
      nome: "uma resposta que não atravessa o IPC chega como QUEIXA, não como silêncio",
      passou: false,
      detalhe: "a leitura ficou SEM RESPOSTA — é o renderer parado, que é o pior dos casos",
    }
  }
  const resposta = JSON.parse(cru) as { ok?: boolean; erro?: string } | null
  return {
    nome: "uma resposta que não atravessa o IPC chega como QUEIXA, não como silêncio",
    passou: resposta?.ok === false && String(resposta.erro).includes("does not cross the IPC"),
    detalhe: JSON.stringify(resposta),
  }
}

/**
 * The error envelope, measured against Electron's IPC serializer.
 *
 * `vitest` proves it with Node's `structuredClone`, which is not the same. Here
 * the request breaks in the main process and what reaches the renderer must
 * bring the key, name, and detail intact, and, with a `cause` that does not
 * serialize, the key the same and the detail as text, never a clone complaint
 * in place of the error.
 */
async function medirOEnvelope(): Promise<Prova[]> {
  const janela = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload-bancada.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await janela.loadURL("about:blank")
  const pedir = async (canal: string): Promise<Record<string, unknown> | null> => {
    const pergunta = janela.webContents.executeJavaScript(
      `window.bancada.pedirEmCru(${JSON.stringify(canal)}).then((r) => JSON.stringify(r ?? null), (e) => JSON.stringify({ rebentou: String(e) }))`,
    ) as Promise<string>
    const prazo = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000))
    const cru = await Promise.race([pergunta, prazo])
    return cru === null ? null : (JSON.parse(cru) as Record<string, unknown>)
  }
  const simples = await pedir(CANAL_ERRO_SIMPLES)
  const funcao = await pedir(CANAL_ERRO_FUNCAO)
  return [
    {
      nome: "um erro do processo principal chega ao renderer com chave, nome e detalhe",
      passou:
        simples?.ok === false &&
        simples.chave === "vault is locked" &&
        simples.nome === "Error" &&
        JSON.stringify(simples.detalhe) === JSON.stringify({ n: 1 }),
      detalhe: JSON.stringify(simples),
    },
    {
      nome: "um cause que não se serializa perde o detalhe mas guarda a chave e o nome",
      passou:
        funcao?.ok === false &&
        funcao.chave === "vault storage is full" &&
        funcao.nome === "QuotaExceededError" &&
        typeof funcao.detalhe === "string",
      detalhe: JSON.stringify(funcao),
    },
  ]
}

/**
 * Global shortcuts across the IPC boundary for real: the request leaves the renderer,
 * the state comes back cloned, and a key loaded in the main process arrives at
 * the renderer's `aoAccionar`. Separately, the REAL `globalShortcut` accepts the
 * accelerators that `aceleradorDe` writes: a wrong name ("ArrowUp" instead of "Up")
 * throws, and only Electron knows how to report it.
 */
async function medirAtalhos(janela: BrowserWindow): Promise<Prova[]> {
  janelaDosAtalhos = janela
  const provas: Prova[] = []
  const cru = (await janela.webContents.executeJavaScript(`(async () => {
    const a = window.enclaveHost.atalhosGlobais
    if (!a) return JSON.stringify({ falta: true })
    window.__atalhos = []
    a.aoAccionar((accao) => window.__atalhos.push(accao))
    const estado = await a.definir({ microfone: "F13", som: "M" })
    return JSON.stringify({ estado, chaves: Object.keys(a).sort() })
  })()`)) as string
  const lido = JSON.parse(cru) as { falta?: true; estado?: unknown; chaves?: string[] }
  provas.push({
    nome: "os atalhos globais atravessam o contextBridge",
    passou: JSON.stringify(lido.chaves) === JSON.stringify(["abrirAcessibilidade", "aoAccionar", "definir", "suspender"]),
    detalhe: JSON.stringify(lido.chaves ?? lido),
  })
  provas.push({
    nome: "o estado dos globais volta clonado: F13 global, a letra só com a janela",
    passou:
      JSON.stringify(lido.estado) ===
      JSON.stringify({ globais: ["microfone"], soComAJanela: ["som"], ocupados: [], faltaAcessibilidade: [] }),
    detalhe: JSON.stringify(lido.estado),
  })
  teclasDaBancada.get("F13")?.()
  await new Promise((resolve) => setTimeout(resolve, 200))
  const recebidos = (await janela.webContents.executeJavaScript("JSON.stringify(window.__atalhos)")) as string
  provas.push({
    nome: 'carregar na tecla global chega ao renderer como "microfone"',
    passou: recebidos === JSON.stringify(["microfone"]),
    detalhe: recebidos,
  })
  const largado = (await janela.webContents.executeJavaScript(
    "window.enclaveHost.atalhosGlobais.definir(null).then((e) => JSON.stringify(e))",
  )) as string
  provas.push({
    nome: "definir(null) larga a tecla no principal",
    passou: teclasDaBancada.size === 0 && largado.includes('"globais":[]'),
    detalhe: `${teclasDaBancada.size} registadas; ${largado}`,
  })

  const recusados: string[] = []
  const tomados: string[] = []
  for (const combinacao of ["Mod+Shift+M", "Alt+Shift+F24", "F24", "`", "Alt+ArrowUp", "Mod+Shift+9", "AudioVolumeMute"]) {
    const acelerador = aceleradorDe(combinacao)
    if (!acelerador) {
      recusados.push(`${combinacao}: sem acelerador`)
      continue
    }
    try {
      // Registered and released immediately: the key is stolen from the system for milliseconds.
      if (!globalShortcut.register(acelerador, () => {})) tomados.push(acelerador)
      globalShortcut.unregister(acelerador)
    } catch (erro) {
      recusados.push(`${acelerador}: ${(erro as Error).message}`)
    }
  }
  provas.push({
    nome: "o globalShortcut verdadeiro aceita os nomes que aceleradorDe escreve",
    passou: recusados.length === 0,
    detalhe: [...recusados, ...(tomados.length > 0 ? [`já de outra app (não é falha): ${tomados.join(", ")}`] : [])].join("; "),
  })
  return provas
}

async function correr(): Promise<void> {
  await app.whenReady()
  registarPontes()

  const janela = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      // The same conditions as the installed app, not a friendly version of them:
      // the sandbox is what breaks `sendSync`, and measuring it outside the sandbox
      // measures nothing.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  await janela.loadURL("about:blank")

  const provas = [
    ...(await medir(janela)),
    ...provasDoRasto(),
    await medirOImpossivel(),
    ...(await medirOEnvelope()),
    ...(await medirAtalhos(janela)),
  ]

  const falhadas = provas.filter((prova) => !prova.passou)
  for (const prova of provas) {
    process.stdout.write(`${prova.passou ? "  ok " : "FALHA"}  ${prova.nome}${prova.detalhe ? `  — ${prova.detalhe}` : ""}\n`)
  }
  process.stdout.write(`\n${provas.length - falhadas.length}/${provas.length} provas passaram.\n`)

  app.exit(falhadas.length === 0 ? 0 : 1)
}

void correr().catch((erro: unknown) => {
  process.stderr.write(`a bancada rebentou: ${(erro as Error).stack ?? String(erro)}\n`)
  app.exit(2)
})
