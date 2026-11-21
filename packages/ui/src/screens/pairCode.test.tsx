import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge, PairEvento } from "../bridge.js"
import { ToastProvider } from "../components/Toast.js"
import { strings } from "../strings.js"
import { Emparelhar } from "./gate/Emparelhar.js"
import { AcrescentarAparelho } from "./settings/AcrescentarAparelho.js"
import { NewDeviceCode } from "./gate/NewDeviceCode.js"
import { TypeCode } from "./settings/TypeCode.js"

afterEach(cleanup)

/**
 * The two screens of the short pairing code (1.3.26, mock-up `Emparelhar`).
 * The new device shows the code as "K7P · 4QM" with its QR; the device with
 * the account has "Camera" and "Or type the code", and only a well-formed
 * code leaves the field.
 */
describe("the new device shows the code", () => {
  it("lead, QR, 'or type the code' and the code in two groups", () => {
    render(<NewDeviceCode code="K7P4QM" link="https://orwell.pt/app/emparelhar#code=K7P4QM" />)
    expect(screen.getByText(strings.shortCode.newLead)).toBeTruthy()
    expect(screen.getByRole("img", { name: strings.shortCode.qrAlt })).toBeTruthy()
    expect(screen.getByText(strings.shortCode.orType)).toBeTruthy()
    const code = screen.getByText("K7P · 4QM")
    expect(code.getAttribute("data-code")).toBe("K7P4QM")
  })
})

describe("the device with the account types the code", () => {
  it("a well-formed code goes out normalized", () => {
    const onCode = vi.fn()
    render(<TypeCode onCode={onCode} />)
    expect(screen.getByRole("button", { name: strings.shortCode.camera })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(strings.shortCode.typeLabel), { target: { value: "k7p 4qm" } })
    fireEvent.click(screen.getByRole("button", { name: strings.shortCode.continue }))
    expect(onCode).toHaveBeenCalledWith("K7P4QM")
  })

  it("anything else stays here with a message", () => {
    const onCode = vi.fn()
    render(<TypeCode onCode={onCode} />)
    fireEvent.change(screen.getByLabelText(strings.shortCode.typeLabel), { target: { value: "K0P4QM" } })
    fireEvent.click(screen.getByRole("button", { name: strings.shortCode.continue }))
    expect(onCode).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe(strings.shortCode.invalid)
  })
})

/** A bridge with the short-code calls, and a hand on `on.pair`. */
function fakeBridge() {
  let listener: ((event: PairEvento) => void) | null = null
  const pairing = {
    status: vi.fn(async () => ({ temChaveDeConta: true, servidorSuporta: true, serverKnowsShortCode: true })),
    host: vi.fn(async () => ({ pairId: "x", link: "https://orwell.pt/app/emparelhar#x" })),
    join: vi.fn(async () => ({ ok: true })),
    showCode: vi.fn(async () => ({ ok: true })),
    typeCode: vi.fn(async () => ({ ok: true })),
    confirm: vi.fn(async () => ({ ok: true })),
    refuse: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    done: vi.fn(async () => ({ ok: true })),
    seal: vi.fn(async () => ({ ok: true })),
    devices: vi.fn(),
  }
  const bridge = {
    vault: {
      status: vi.fn(async () => ({ exists: false, supportsOsProtection: false })),
      create: vi.fn(async () => ({ ok: true })),
      createProvisionalToSeal: vi.fn(async () => ({ ok: true })),
      destroy: vi.fn(async () => ({ ok: true })),
    },
    pairing,
    on: {
      pair: (fn: (event: PairEvento) => void) => {
        listener = fn
        return () => {
          listener = null
        }
      },
    },
  } as unknown as EnclaveBridge
  return { bridge, pairing, emit: (event: PairEvento) => act(() => listener?.(event)) }
}

describe("where the short code is wired in this branch", () => {
  it("Settings › Add device: the typed code goes to typeCode, and the QR's cancel is not shown as a failure", async () => {
    const { bridge, pairing, emit } = fakeBridge()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <AcrescentarAparelho onClose={() => {}} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    emit({ fase: "aguarda", pairId: "x", link: "https://orwell.pt/app/emparelhar#x" })
    const field = await screen.findByLabelText(strings.shortCode.typeLabel)
    fireEvent.change(field, { target: { value: "K7P · 4QM" } })
    fireEvent.click(screen.getByRole("button", { name: strings.shortCode.continue }))
    expect(pairing.typeCode).toHaveBeenCalledWith("K7P4QM")
    emit({ fase: "falhou", razao: "cancelado" })
    expect(screen.queryByRole("alert")).toBeNull()
    emit({ fase: "ligado" })
    emit({ fase: "sas", palavras: "um-dois-tres-quatro-cinco-seis" })
    expect(screen.getByText(strings.juntarAparelho.palavrasTitulo)).toBeTruthy()
  })

  it("the gate: 'Show a code on this device', the code on screen, then the words and the account password", async () => {
    const { bridge, pairing, emit } = fakeBridge()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <Emparelhar onDone={() => {}} onBack={() => {}} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    fireEvent.click(screen.getByRole("button", { name: strings.shortCode.showCode }))
    await waitFor(() => expect(pairing.showCode).toHaveBeenCalledTimes(1))
    // The same provisional vault as the QR path: no password before the words.
    expect(bridge.vault.createProvisionalToSeal).toHaveBeenCalledTimes(1)
    expect(bridge.vault.create).not.toHaveBeenCalled()
    expect(pairing.join).not.toHaveBeenCalled()
    emit({ fase: "code", code: "K7P4QM", link: "https://orwell.pt/app/emparelhar#code=K7P4QM" })
    expect(screen.getByText("K7P · 4QM")).toBeTruthy()
    expect(screen.getByText(strings.shortCode.newTitle)).toBeTruthy()
    emit({ fase: "ligado" })
    expect(screen.queryByText("K7P · 4QM")).toBeNull()
    expect(screen.getByText(strings.juntarAparelho.aLigar)).toBeTruthy()
    emit({ fase: "sas", palavras: "um-dois-tres" })
    expect(screen.getByText(strings.juntarAparelho.palavrasTitulo)).toBeTruthy()
    emit({ fase: "certificado", address: "a@b", palavraPasse: "conta" })
    expect(screen.getByLabelText(strings.juntarAparelho.palavraPasseDaConta)).toBeTruthy()
  })

  it("the gate: Back on the code leaves the box and goes back to the QR path", async () => {
    const { bridge, pairing, emit } = fakeBridge()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <Emparelhar onDone={() => {}} onBack={() => {}} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    fireEvent.click(screen.getByRole("button", { name: strings.shortCode.showCode }))
    await waitFor(() => expect(pairing.showCode).toHaveBeenCalledTimes(1))
    emit({ fase: "code", code: "K7P4QM", link: "https://orwell.pt/app/emparelhar#code=K7P4QM" })
    fireEvent.click(screen.getByRole("button", { name: strings.entrada.voltar }))
    await waitFor(() => expect(pairing.cancel).toHaveBeenCalled())
    expect(await screen.findByRole("button", { name: strings.juntarAparelho.lerCamara })).toBeTruthy()
  })

  it("the gate: no 'Show a code' on a host without it", () => {
    const { bridge } = fakeBridge()
    delete (bridge.pairing as { showCode?: unknown }).showCode
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <Emparelhar onDone={() => {}} onBack={() => {}} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    expect(screen.getByRole("button", { name: strings.juntarAparelho.lerCamara })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.shortCode.showCode })).toBeNull()
  })
})
