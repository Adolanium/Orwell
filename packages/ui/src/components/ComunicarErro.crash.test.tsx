// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CorpoDoBug } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { clearDiagnostics, recordDiagnostic } from "../lib/diagnostics.js"
import { crashForReport, esquecerFalhas, registarFalha } from "../lib/falhas.js"
import { strings } from "../strings.js"
import { ComunicarErro } from "./ComunicarErro.js"
import { ErrorBoundary } from "./ErrorBoundary.js"

afterEach(() => {
  cleanup()
  esquecerFalhas()
  clearDiagnostics()
})

const bridge = { bugs: { plataforma: "pwa", suportado: async () => true, enviar: async () => {} } } as unknown as EnclaveBridge

describe("Report a bug from the crash card", () => {
  it("carries the cause and the stack, in sight in the box", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'x')")
    error.stack = "TypeError: boom\n    at Shell (https://orwell.pt/app/assets/index-AbCd.js:12:345)"
    registarFalha("screen-crash", error, "\n    at Shell")

    render(<ComunicarErro bridge={bridge} connection="offline" onClose={() => {}} initialText={crashForReport()} />)

    const box = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(box.value).toContain("reading 'x'")
    expect(box.value).toContain("12:345")
  })

  it("starts empty with no crash", () => {
    render(<ComunicarErro bridge={bridge} connection="online" onClose={() => {}} initialText={crashForReport()} />)
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("")
  })

  it("never carries the quoted part of a message: it can be somebody's text", () => {
    registarFalha("screen-crash", new SyntaxError('Unexpected token h, "hello world" is not valid JSON'))
    expect(crashForReport()).toContain("SyntaxError")
    expect(crashForReport()).not.toContain("hello world")
  })

  it.each([true, false])("sends the log it shows, only with technical details (%s)", async (included) => {
    const send = vi.fn(async (_body: { descricao: string }) => {})
    const host = { bugs: { plataforma: "pwa", suportado: async () => true, enviar: send } } as unknown as EnclaveBridge
    recordDiagnostic({ kind: "action", code: "call-disconnected" })
    render(<ComunicarErro bridge={host} connection="online" onClose={() => {}} initialText="It stopped." />)
    if (!included) fireEvent.click(screen.getAllByRole("checkbox")[0]!)
    expect(screen.queryByText(/call-disconnected/) !== null).toBe(included)
    fireEvent.submit(screen.getByRole("textbox").closest("form")!)
    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0]![0].descricao.includes("call-disconnected")).toBe(included)
  })

  it("from the Error 901 card: the stack and a full log, in a body the deployed schema takes", async () => {
    const send = vi.fn(async (_body: unknown) => {})
    const host = { bugs: { plataforma: "pwa", suportado: async () => true, enviar: send } } as unknown as EnclaveBridge
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
    for (let n = 0; n < 190; n++) recordDiagnostic({ kind: "action", code: `an-event-with-a-long-name-number-${n}` })
    const Broken = (): never => {
      throw new TypeError("Cannot read properties of undefined (reading 'x')")
    }
    render(
      <ErrorBoundary bridge={host} connection="online">
        <Broken />
      </ErrorBoundary>,
    )
    fireEvent.click(await screen.findByRole("button", { name: strings.comunicarErro.botao }))
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement
    expect(box.value).toContain("stack=")
    fireEvent.submit(box.closest("form")!)
    await waitFor(() => expect(send).toHaveBeenCalled())
    const body = CorpoDoBug.parse(send.mock.calls[0]![0])
    expect(body.descricao).toContain("reading 'x'")
    expect(body.descricao).toContain("number-189")
    expect(Buffer.byteLength(JSON.stringify(body), "utf8")).toBeLessThan(16 * 1024)
    quiet.mockRestore()
  })
})
