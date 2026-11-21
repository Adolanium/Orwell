import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ContaNaLista } from "@enclave/client-core"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { CartaoDaSessao } from "../settings/CartaoDaSessao.js"
import { pagina } from "./MudarDeConta.js"
import { Unlock } from "./Unlock.js"

/**
 * "Switch account": the sheet, the link in the gate (only with another account),
 * and the button in the "Session" card.
 */

const recarregar = vi.fn()
const original = pagina.recarregar
beforeEach(() => {
  recarregar.mockReset()
  pagina.recarregar = recarregar
})
afterEach(() => {
  pagina.recarregar = original
  cleanup()
})

const ANA: ContaNaLista = { id: "principal", nome: "Ana", activa: true, temCofre: true, memorizada: true }
const BRUNO: ContaNaLista = { id: "b0b", nome: "Bruno", activa: false, temCofre: true, memorizada: false }
const DORA: ContaNaLista = { id: "d0", nome: "", activa: false, temCofre: true, memorizada: true }

function ponte(contas: ContaNaLista[], extra: Partial<NonNullable<EnclaveBridge["contas"]>> = {}): EnclaveBridge & { chamadas: string[] } {
  const chamadas: string[] = []
  return {
    chamadas,
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: false, versao: "orwv2", protection: "passphrase" }),
      unlock: async (secret: string | null) => {
        if (secret === null) throw new Error("this vault needs a passphrase")
        return { ok: true }
      },
      lock: async () => ({ ok: true }),
      destroy: async () => {
        chamadas.push("destroy")
        return { ok: true }
      },
    },
    contas: {
      listar: async () => ({ contas }),
      mudar: async (id: string) => {
        chamadas.push(`mudar ${id}`)
        return { ok: true }
      },
      acrescentar: async () => {
        chamadas.push("acrescentar")
        return { ok: true }
      },
      ...extra,
    },
    identity: { load: async () => ({ address: "@ana:orwell.pt", accountId: "ana" }) },
    session: { connect: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge & { chamadas: string[] }
}

function noPortao(bridge: EnclaveBridge): void {
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridge}>
        <Unlock onDone={vi.fn()} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
}

describe('"Mudar de conta" no portão', () => {
  it("com uma conta só, o portão fica igual: sem ligação nenhuma", async () => {
    noPortao(ponte([ANA]))
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole("button", { name: strings.contas.mudar })).toBeNull()
  })

  it("com outra conta, a ligação abre a folha; escolher muda e recarrega", async () => {
    const bridge = ponte([ANA, BRUNO, DORA])
    noPortao(bridge)
    fireEvent.click(await screen.findByRole("button", { name: strings.contas.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contas.titulo })
    // The others, by name; one without a name says it has none; and what each one requests.
    expect(within(folha).queryByRole("button", { name: "Ana" })).toBeNull()
    expect(within(folha).getByRole("button", { name: "Bruno" })).toBeTruthy()
    expect(within(folha).getByRole("button", { name: strings.contas.semNome })).toBeTruthy()
    expect(within(folha).getByText(strings.contas.pedeFrase)).toBeTruthy()
    expect(within(folha).getByText(strings.contas.abreSozinha)).toBeTruthy()

    fireEvent.click(within(folha).getByRole("button", { name: "Bruno" }))
    await waitFor(() => expect(recarregar).toHaveBeenCalled())
    expect(bridge.chamadas).toEqual(["mudar b0b"])
  })

  it("uma falha a mudar diz-se, com código, e não recarrega", async () => {
    const bridge = ponte([ANA, BRUNO], {
      mudar: async () => {
        throw new Error("there is no such account on this device")
      },
    })
    noPortao(bridge)
    fireEvent.click(await screen.findByRole("button", { name: strings.contas.mudar }))
    fireEvent.click(await screen.findByRole("button", { name: "Bruno" }))
    expect(await screen.findByText(/Esta conta já não está neste aparelho/)).toBeTruthy()
    expect(recarregar).not.toHaveBeenCalled()
  })

  it("o portão nunca apaga uma conta para mudar de conta (21/11/2026)", async () => {
    const bridge = ponte([ANA, BRUNO])
    noPortao(bridge)
    await screen.findByRole("button", { name: strings.contas.mudar })
    expect(screen.queryByRole("button", { name: /apagar|Criar conta nova/i })).toBeNull()
  })
})

describe('"Usar outra conta" no portão', () => {
  it("acrescenta uma conta vazia e recarrega para a entrada; esta fica", async () => {
    const bridge = ponte([ANA])
    noPortao(bridge)
    fireEvent.click(await screen.findByRole("button", { name: strings.entrada.outraConta }))
    await waitFor(() => expect(recarregar).toHaveBeenCalled())
    expect(bridge.chamadas).toEqual(["acrescentar"])
  })
})

describe('"Mudar de conta" no cartão "Sessão"', () => {
  it("está lá mesmo com uma conta só: é por aqui que se acrescenta a segunda", async () => {
    const bridge = ponte([ANA])
    render(
      <ToastProvider>
        <BridgeContext.Provider value={bridge}>
          <CartaoDaSessao onLock={vi.fn()} bloqueioAutomatico={15} onBloqueioAutomatico={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    fireEvent.click(await screen.findByRole("button", { name: strings.contas.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contas.titulo })
    expect(within(folha).getByText(strings.contas.nenhumaOutra)).toBeTruthy()
    fireEvent.click(within(folha).getByRole("button", { name: strings.contas.acrescentar }))
    await waitFor(() => expect(recarregar).toHaveBeenCalled())
    expect(bridge.chamadas).toEqual(["acrescentar"])
  })

  it("uma ponte sem contas não mostra o botão", async () => {
    const bridge = ponte([ANA])
    delete (bridge as { contas?: unknown }).contas
    render(
      <ToastProvider>
        <BridgeContext.Provider value={bridge}>
          <CartaoDaSessao onLock={vi.fn()} bloqueioAutomatico={15} onBloqueioAutomatico={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    await screen.findByRole("button", { name: strings.settings.lockNow })
    expect(screen.queryByRole("button", { name: strings.contas.mudar })).toBeNull()
  })
})
