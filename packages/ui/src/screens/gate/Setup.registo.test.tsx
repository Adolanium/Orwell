import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { strings, translateError } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { codigoDoErro } from "../../lib/codigosDeErro.js"
import { passosDoSetup, Setup } from "./Setup.js"

/**
 * The gate and the server's registration rule (1.3.25, `ENCLAVE_REGISTO`).
 *
 * After the name, the gate asks the server who may create an account
 * (`sondarRegisto`). `fechado` stops on the name page, before the vault exists;
 * `convite` adds the code page, and the code goes to the session before the
 * first connection. A server that refuses at the connection anyway (an older
 * host with no probe, or a code that is not valid) gets the code field on the
 * creation screen, and retry resumes at the connection.
 */

type Modo = "aberto" | "convite" | "fechado" | null

interface Registos {
  vaultsCriados: number
  convites: (string | null)[]
  sondados: string[]
}

let registos: Registos

beforeEach(() => {
  localStorage.clear()
  registos = { vaultsCriados: 0, convites: [], sondados: [] }
})
afterEach(() => cleanup())

function bridgeDeTeste({
  modo,
  connect = async () => ({ ok: true }),
  semSonda = false,
}: {
  modo: Modo
  connect?: () => Promise<{ ok: boolean }>
  semSonda?: boolean
}): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: false, supportsOsProtection: false }),
      create: async () => {
        registos.vaultsCriados++
        return { ok: true }
      },
      export: async () => ({ data: "ficheiro" }),
    },
    identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
    session: {
      connect,
      ...(semSonda
        ? {}
        : {
            sondarRegisto: async (servidor: string) => {
              registos.sondados.push(servidor)
              return modo
            },
          }),
      definirConviteDeRegisto: async (codigo: string | null) => {
        registos.convites.push(codigo)
        return { ok: true }
      },
    },
    profile: { set: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge
}

function montar(bridge: EnclaveBridge): void {
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridge}>
        <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
}

const campoNome = (): HTMLElement => screen.getByPlaceholderText(strings.gate.namePlaceholder)
const pergunta = (): string => screen.getByRole("heading", { level: 1 }).textContent ?? ""

describe("passosDoSetup", () => {
  it("põe a página do código logo a seguir ao nome, só em convite", () => {
    const base = ["nome", "fotografia", "chave", "confirmar"] as const
    expect(passosDoSetup(base, "convite")).toEqual(["nome", "convite", "fotografia", "chave", "confirmar"])
    expect(passosDoSetup(base, "aberto")).toEqual(base)
    expect(passosDoSetup(base, "fechado")).toEqual(base)
    expect(passosDoSetup(base, null)).toEqual(base)
  })
})

describe("Setup: quem pode criar conta no servidor", () => {
  it("fechado: diz que o servidor não aceita contas novas, fica no nome e não cria o cofre", async () => {
    const pessoa = userEvent.setup()
    montar(bridgeDeTeste({ modo: "fechado" }))
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    expect(await screen.findByText(strings.gate.registoFechado)).toBeTruthy()
    expect(pergunta()).toBe(strings.gate.askName)
    expect(registos.sondados).toEqual(["localhost:8448"])
    expect(registos.vaultsCriados).toBe(0)
  })

  it("aberto: segue para a imagem, sem página de código", async () => {
    const pessoa = userEvent.setup()
    montar(bridgeDeTeste({ modo: "aberto" }))
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await waitFor(() => expect(pergunta()).toBe(strings.gate.askPhoto))
  })

  it("convite: pede o código a seguir ao nome, e entrega-o à sessão antes de ligar", async () => {
    const pessoa = userEvent.setup()
    const ordem: string[] = []
    const bridge = bridgeDeTeste({
      modo: "convite",
      connect: async () => {
        ordem.push("connect")
        return { ok: true }
      },
    })
    const definir = bridge.session.definirConviteDeRegisto!
    bridge.session.definirConviteDeRegisto = async (codigo) => {
      ordem.push(`convite:${codigo}`)
      return definir(codigo)
    }
    montar(bridge)
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await waitFor(() => expect(pergunta()).toBe(strings.gate.askInvite))
    expect(screen.getByText(strings.gate.askInviteLead)).toBeTruthy()
    // Without a code, the button does not go on.
    expect((screen.getByRole("button", { name: strings.gate.next }) as HTMLButtonElement).disabled).toBe(true)
    await pessoa.keyboard("k7qm-2xra-9dtb-w4he{Enter}")
    expect(pergunta()).toBe(strings.gate.askPhoto)
    await pessoa.keyboard("{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await screen.findByRole("heading", { name: strings.ficheiroDaConta.titulo })
    expect(ordem).toEqual(["convite:k7qm-2xra-9dtb-w4he", "connect"])
  })

  it("sem sonda (anfitrião antigo) e servidor em convite: a recusa mostra o campo, e repetir liga com o código", async () => {
    const pessoa = userEvent.setup()
    let tentativas = 0
    montar(
      bridgeDeTeste({
        modo: null,
        semSonda: true,
        connect: async () => {
          tentativas++
          if (tentativas === 1) throw new Error("this server needs a registration invite")
          return { ok: true }
        },
      }),
    )
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")

    const campo = await screen.findByRole("textbox", { name: strings.gate.inviteCode })
    // On the screen and in the toast.
    expect(screen.getAllByText(new RegExp(String(codigoDoErro("this server needs a registration invite")))).length).toBeGreaterThan(0)
    const repetir = screen.getByRole("button", { name: strings.common.retry }) as HTMLButtonElement
    expect(repetir.disabled).toBe(true)
    await pessoa.type(campo, "AAAA-BBBB-CCCC-DDDD")
    await pessoa.click(repetir)
    await screen.findByRole("heading", { name: strings.ficheiroDaConta.titulo })
    expect(tentativas).toBe(2)
    // Retry resumed at the connection: one vault, never two.
    expect(registos.vaultsCriados).toBe(1)
    expect(registos.convites).toEqual(["AAAA-BBBB-CCCC-DDDD"])
  })

  it("a recusa de um servidor fechado à ligação diz-se com o código de erro e a frase", () => {
    expect(codigoDoErro("this server does not accept new accounts")).toBe(230)
    expect(codigoDoErro("this server needs a registration invite")).toBe(231)
    expect(codigoDoErro("the registration invite is not valid")).toBe(232)
    expect(translateError("this server does not accept new accounts")).toContain("Este servidor não aceita contas novas.")
  })
})
