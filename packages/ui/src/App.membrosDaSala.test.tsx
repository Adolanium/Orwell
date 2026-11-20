import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { compararCargos } from "@enclave/protocol"
import type { ChannelRole, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CARLA = "@carla:casa.pt"
const CANAL = "!lagar:casa.pt"

/**
 * The "People" list of a room in a restricted category (1.3.25).
 *
 * As on Discord: a room only some roles see lists only the people who see it
 * (founder, admins, whoever has one of the chosen roles). An open room lists
 * everyone. Tidying, not security: everyone in the channel has the keys.
 */

const SALAS = [
  { room: "", name: "geral", category: "", kind: "text" as const, position: 0 },
  { room: "staff", name: "bastidores", category: "Staff", kind: "text" as const, position: 1 },
]

interface Estado {
  cargos: ChannelRole[]
  cargosDe: Record<string, string[]>
  souFundador: boolean
  permissoes: boolean
  admins?: string[]
}

function ponte(estado: Estado, emitRef: { current: ((message: unknown) => void) | null }, ordenou: ReturnType<typeof vi.fn>): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: async () => ({ ok: true }),
    },
    identity: {
      load: async () => ({ address: EU, accountId: "eu" }),
      create: async () => ({ address: EU, accountId: "eu" }),
    },
    session: {
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      list: async () => [CANAL],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA, BRUNO, CARLA],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => SALAS,
      categories: () => [{ category: "Staff", position: 0, roles: ["chefe"] }],
      meta: () => null,
      setMeta: async () => ({ ok: true }),
      mayEdit: () => true,
      founder: () => (estado.souFundador ? EU : "@dona:casa.pt"),
      admins: () => estado.admins ?? [],
      roles: () => [...estado.cargos].sort(compararCargos),
      rolesFor: (_canal: string, quem: string) => estado.cargosDe[quem] ?? [],
      setRoles: async () => ({ ok: true }),
      defineRole: async () => ({ ok: true }),
      deleteRole: async () => ({ ok: true }),
      reorderRoles: async (canal: string, ordem: string[]) => {
        ordenou(canal, ordem)
        estado.cargos = estado.cargos.map((cargo) => ({
          ...cargo,
          rank: ordem.length - ordem.indexOf(cargo.role),
          position: ordem.indexOf(cargo.role),
        }))
        return { ok: true }
      },
      // The founder manages; the "chief" (me, without founding) manages by delegation.
      mayManageRoles: () => true,
      ...(estado.permissoes
        ? {
            permissoes: {
              todos: () => ({ powers: [], definido: false }),
              em: () => [],
              mayManageRole: () => estado.souFundador,
              delegacao: () => true,
              sobreposicoes: () => [],
              maySetSobreposicoes: () => false,
              setSobreposicoes: async () => ({ ok: true }),
            },
          }
        : {}),
      nicknames: () => ({}),
      editMessage: async () => ({ ok: true }),
      deleteMessage: async () => ({ ok: true }),
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: vi.fn(async () => ({ ok: true })),
      acceptFriend: vi.fn(async () => ({ ok: true })),
      declineFriend: vi.fn(async () => ({ ok: true })),
      unfriend: vi.fn(async () => ({ ok: true })),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({
        [ANA]: { displayName: "Ana", donations: [] },
        [BRUNO]: { displayName: "Bruno", donations: [] },
      }),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        emitRef.current = handler
        return () => {
          emitRef.current = null
        }
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

function estadoInicial(extra: Partial<Estado> = {}): Estado {
  return {
    cargos: [
      { role: "chefe", name: "Chefe", powers: [], rank: 2, position: 0 },
      { role: "guia", name: "Guia", powers: [], rank: 1, position: 1 },
    ],
    // Bruno has the role that sees "Staff"; Ana has another; Carla is an admin with no role.
    cargosDe: { [ANA]: ["guia"], [BRUNO]: ["chefe"] },
    souFundador: true,
    permissoes: false,
    admins: [CARLA],
    ...extra,
  }
}

async function abrir(estado: Estado): Promise<{
  user: ReturnType<typeof userEvent.setup>
  emitir: (message: unknown) => Promise<void>
}> {
  const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
  const user = userEvent.setup()
  render(<App bridge={ponte(estado, emitRef, vi.fn())} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  let seq = 1
  const emitir = async (message: unknown): Promise<void> => {
    await act(async () => {
      emitRef.current?.(message)
      await Promise.resolve()
    })
  }
  for (const [quem, nome] of [[ANA, "Ana"], [BRUNO, "Bruno"], [CARLA, "Carla"]] as const) {
    await emitir({ channel: CANAL, seq: seq++, sender: quem, payload: { t: "profile", displayName: nome, updatedAt: 1 } })
    await emitir({ channel: CANAL, seq: seq++, sender: quem, payload: { t: "message", id: `m-${nome}`, sentAt: Date.now(), body: `olá de ${nome}` } })
  }
  return { user, emitir }
}

const nomesNaLista = (): string[] =>
  [...document.querySelectorAll(".member-list .member-row .member-name")].map((n) => n.textContent ?? "").filter((t) => t !== "")

async function abrirSala(user: ReturnType<typeof userEvent.setup>, nome: string): Promise<void> {
  const linha = [...document.querySelectorAll<HTMLElement>(".room-name")].find((el) => el.textContent === nome)
  if (!linha) throw new Error(`a sala ${nome} não está na barra`)
  await user.click(linha)
}

describe("a lista de pessoas de uma sala que só alguns cargos vêem", () => {
  it("a sala aberta mostra toda a gente", async () => {
    await abrir(estadoInicial())
    await vi.waitFor(() => expect(nomesNaLista().join(" ")).toMatch(/Ana/))
    const nomes = nomesNaLista().join(" ")
    for (const nome of ["Ana", "Bruno", "Carla"]) expect(nomes).toContain(nome)
  })

  it("a sala privada mostra só quem a vê: o fundador, a admin e quem tem o cargo", async () => {
    const { user } = await abrir(estadoInicial())
    await vi.waitFor(() => expect(nomesNaLista().join(" ")).toMatch(/Ana/))
    await abrirSala(user, "bastidores")

    await vi.waitFor(() => expect(nomesNaLista().join(" ")).not.toMatch(/Ana/))
    const nomes = nomesNaLista().join(" ")
    expect(nomes).toContain("Bruno")
    expect(nomes).toContain("Carla")
    // The founder (this account) sees every room.
    expect(nomes).toContain("Vera")
  })

  it("dar o cargo a alguém noutro aparelho chega como mensagem, e a lista acrescenta-o", async () => {
    const estado = estadoInicial()
    const { user, emitir } = await abrir(estado)
    await vi.waitFor(() => expect(nomesNaLista().join(" ")).toMatch(/Ana/))
    await abrirSala(user, "bastidores")
    await vi.waitFor(() => expect(nomesNaLista().join(" ")).not.toMatch(/Ana/))

    estado.cargosDe[ANA] = ["guia", "chefe"]
    await emitir({ channel: CANAL, seq: 99, sender: EU, payload: { t: "role.assign", subject: ANA, roles: ["guia", "chefe"], at: Date.now() } })

    await vi.waitFor(() => expect(nomesNaLista().join(" ")).toMatch(/Ana/))
  })

  it("voltar à sala aberta mostra toda a gente outra vez", async () => {
    const { user } = await abrir(estadoInicial())
    await vi.waitFor(() => expect(nomesNaLista().join(" ")).toMatch(/Ana/))
    await abrirSala(user, "bastidores")
    await vi.waitFor(() => expect(nomesNaLista().join(" ")).not.toMatch(/Ana/))
    await abrirSala(user, "geral")
    await vi.waitFor(() => expect(nomesNaLista().join(" ")).toMatch(/Ana/))
  })
})
