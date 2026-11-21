import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile, SincroniaDoCanal } from "../../bridge.js"
import { useSincronia } from "../../hooks/useSincronia.js"
import { diasDeCalendario } from "../../lib/format.js"
import { en } from "../../linguas/en.js"
import { pt } from "../../linguas/pt.js"
import { strings } from "../../strings.js"
import { MEMBERS_SYNC_EXIT_MS, MemberPanel } from "./MemberPanel.js"

/**
 * The members column while a channel's history syncs (21/11/2026): a status
 * block at the top ("Now syncing", and the days away when there are some), the
 * rows grey and still, `aria-busy` on the panel, and the way back when the
 * sync ends.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const noop = (): void => {}
const CANAL = "!geral:localhost:8448"

function panel(overrides: Partial<React.ComponentProps<typeof MemberPanel>>): React.JSX.Element {
  return (
    <MemberPanel
      channel={CANAL}
      members={["@ana:localhost:8448", "@rui:localhost:8448"]}
      state="ready"
      onRetry={noop}
      me={null}
      directory={new Map<string, Profile>()}
      nameFor={(sender) => sender}
      onInvite={noop}
      onUserMenu={noop}
      onOpenProfile={noop}
      {...overrides}
    />
  )
}

const aside = (): HTMLElement => document.querySelector("aside.members") as HTMLElement
const lista = (): HTMLElement => document.querySelector(".member-list") as HTMLElement

describe("MemberPanel while the history syncs", () => {
  it("outside a sync: no status, no aria-busy, the rows take the pointer", () => {
    render(panel({}))
    expect(screen.queryByRole("status")).toBeNull()
    expect(aside().getAttribute("aria-busy")).toBeNull()
    expect(aside().classList.contains("syncing")).toBe(false)
    expect(lista().hasAttribute("inert")).toBe(false)
  })

  it("syncing: the status block at the top, aria-busy, and the rows inert", () => {
    render(panel({ syncing: true, daysAway: 6 }))
    const estado = screen.getByRole("status")
    expect(estado.querySelector(".members-syncing-title")?.textContent).toBe(strings.members.syncingTitle)
    expect(estado.querySelector(".members-syncing-track .members-syncing-bar")).not.toBeNull()
    expect(aside().getAttribute("aria-busy")).toBe("true")
    expect(aside().classList.contains("syncing")).toBe(true)
    expect(lista().hasAttribute("inert")).toBe(true)
    // At the top of the column: right after the header, before the list.
    expect(document.querySelector(".members-header")?.nextElementSibling).toBe(estado)
  })

  it.each([
    [0, false],
    [1, true],
    [6, true],
  ] as const)("%i days away: a subline is %s", (dias, temSubline) => {
    render(panel({ syncing: true, daysAway: dias }))
    const sub = screen.getByRole("status").querySelector(".members-syncing-away")
    expect(sub?.textContent ?? null).toBe(temSubline ? strings.members.syncingAway(dias) : null)
  })

  it("a new device (never online with this account): only \"Now syncing\"", () => {
    render(panel({ syncing: true, daysAway: null }))
    const estado = screen.getByRole("status")
    expect(estado.querySelector(".members-syncing-away")).toBeNull()
    expect(estado.textContent).toBe(strings.members.syncingTitle)
  })

  it("when the sync ends: busy goes at once, the block fades for 360 ms and then leaves", () => {
    vi.useFakeTimers()
    const { rerender } = render(panel({ syncing: true, daysAway: 2 }))
    rerender(panel({ syncing: false, daysAway: null }))
    expect(aside().getAttribute("aria-busy")).toBeNull()
    expect(aside().classList.contains("syncing")).toBe(false)
    expect(lista().hasAttribute("inert")).toBe(false)
    expect(screen.queryByRole("status")).toBeNull()
    const saindo = document.querySelector(".members-syncing")
    expect(saindo?.classList.contains("leaving")).toBe(true)
    expect(saindo?.getAttribute("aria-hidden")).toBe("true")
    act(() => vi.advanceTimersByTime(MEMBERS_SYNC_EXIT_MS - 1))
    expect(document.querySelector(".members-syncing")).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector(".members-syncing")).toBeNull()
    expect(MEMBERS_SYNC_EXIT_MS).toBe(360)
  })

  it("a sync that comes back while the block fades takes it back, live", () => {
    vi.useFakeTimers()
    const { rerender } = render(panel({ syncing: true }))
    rerender(panel({ syncing: false }))
    rerender(panel({ syncing: true }))
    act(() => vi.advanceTimersByTime(MEMBERS_SYNC_EXIT_MS * 2))
    const estado = screen.getByRole("status")
    expect(estado.classList.contains("leaving")).toBe(false)
  })
})

describe("the syncing text, in both languages", () => {
  it("English first, singular and plural", () => {
    expect(en.members!.syncingTitle).toBe("Now syncing")
    expect(en.members!.syncingAway!(1)).toBe("You have not signed in for 1 day")
    expect(en.members!.syncingAway!(6)).toBe("You have not signed in for 6 days")
  })

  it("Portuguese, with tu", () => {
    expect(pt.members.syncingTitle).toBe("A sincronizar")
    expect(pt.members.syncingAway(1)).toBe("Não entras há 1 dia")
    expect(pt.members.syncingAway(6)).toBe("Não entras há 6 dias")
  })
})

describe("diasDeCalendario: days on the local calendar", () => {
  const em = (ano: number, mes: number, dia: number, hora = 12, minuto = 0): number =>
    new Date(ano, mes - 1, dia, hora, minuto).getTime()

  it("the same day is 0, at any hour", () => {
    expect(diasDeCalendario(em(2026, 11, 21, 0, 10), em(2026, 11, 21, 23, 50))).toBe(0)
  })

  it("23:50 and 00:10 the next morning is 1 day, not 20 minutes", () => {
    expect(diasDeCalendario(em(2026, 11, 20, 23, 50), em(2026, 11, 21, 0, 10))).toBe(1)
  })

  it("6 days, across a month and across a daylight-saving change", () => {
    expect(diasDeCalendario(em(2026, 11, 15), em(2026, 11, 21))).toBe(6)
    expect(diasDeCalendario(em(2026, 10, 29), em(2026, 11, 4))).toBe(6)
    expect(diasDeCalendario(em(2026, 3, 26, 0, 30), em(2026, 4, 1, 23, 30))).toBe(6)
  })

  it("a clock that went back is the same day, never negative", () => {
    expect(diasDeCalendario(em(2026, 11, 22), em(2026, 11, 21))).toBe(0)
  })
})

describe("the same truth as the conversation marker", () => {
  const agora = Date.now()
  const base: SincroniaDoCanal = { channel: CANAL, estado: "igual", aReceber: false, progresso: [], ultimaComparacao: null }

  function ponte(lugar: { seq: number; em: number } | null): { bridge: EnclaveBridge; avisar: (estado: SincroniaDoCanal) => void } {
    let ouvinte: ((estado: SincroniaDoCanal) => void) | null = null
    const bridge = {
      sincronia: {
        estado: async () => [{ ...base, passado: true }],
        lugarEm: async () => lugar,
        previousOnlineAt: async () => agora - 3 * 86_400_000,
      },
      on: {
        sincronia: (handler: (estado: SincroniaDoCanal) => void) => {
          ouvinte = handler
          return () => {
            ouvinte = null
          }
        },
      },
    } as unknown as EnclaveBridge
    return { bridge, avisar: (estado) => ouvinte?.(estado) }
  }

  // What ChatScreen does: `aSincronizar` from the hook, for the Timeline marker and this column.
  function Coluna(): React.JSX.Element {
    const sincronia = useSincronia(CANAL)
    const dias =
      sincronia.aSincronizar && sincronia.previousOnlineAt !== null ? diasDeCalendario(sincronia.previousOnlineAt, Date.now()) : null
    return (
      <>
        <span data-marcador={sincronia.lugar !== null && sincronia.aSincronizar ? "sim" : "nao"} />
        {panel({ syncing: sincronia.aSincronizar, daysAway: dias })}
      </>
    )
  }

  const assentar = async (): Promise<void> => {
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })
  }

  it("`passado` with a known seat turns the column grey and back, and the days come from the bridge", async () => {
    const { bridge, avisar } = ponte({ seq: 5, em: 1 })
    render(
      <BridgeContext.Provider value={bridge}>
        <Coluna />
      </BridgeContext.Provider>,
    )
    await assentar()
    expect(document.querySelector("[data-marcador]")?.getAttribute("data-marcador")).toBe("sim")
    expect(aside().getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("status").querySelector(".members-syncing-away")?.textContent).toBe(
      strings.members.syncingAway(diasDeCalendario(agora - 3 * 86_400_000, Date.now())),
    )
    await act(async () => avisar({ ...base, passado: false }))
    expect(aside().getAttribute("aria-busy")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("a channel without a seat: no marker, so no syncing column either", async () => {
    const { bridge } = ponte(null)
    render(
      <BridgeContext.Provider value={bridge}>
        <Coluna />
      </BridgeContext.Provider>,
    )
    await assentar()
    expect(document.querySelector("[data-marcador]")?.getAttribute("data-marcador")).toBe("nao")
    expect(aside().getAttribute("aria-busy")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
    expect(document.querySelector(".members-syncing")).toBeNull()
  })
})
