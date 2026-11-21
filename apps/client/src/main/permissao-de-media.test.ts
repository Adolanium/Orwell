import { describe, expect, it, vi } from "vitest"
import type { EstadoDaPermissao } from "./ecra.js"
import {
  CANAIS_DA_PERMISSAO_DE_MEDIA,
  criarPermissaoDeMedia,
  DEFINICOES_DE_PRIVACIDADE,
  type PortasDaPermissaoDeMedia,
} from "./permissao-de-media.js"

/**
 * The macOS microphone and camera permission, without Electron.
 *
 * The defect it answers (1.3.25, Intel Mac): TCC refused the microphone and the
 * call started with silence and no error. See the header of `permissao-de-media.ts`.
 */

function portas(
  estados: Partial<Record<"microphone" | "camera", EstadoDaPermissao>>,
  extra: Partial<PortasDaPermissaoDeMedia> = {},
): PortasDaPermissaoDeMedia & { pedir: ReturnType<typeof vi.fn>; abrir: ReturnType<typeof vi.fn> } {
  return {
    plataforma: "darwin",
    ler: (tipo) => estados[tipo] ?? "granted",
    pedir: vi.fn(async () => true),
    abrir: vi.fn(async () => {}),
    ...extra,
  } as PortasDaPermissaoDeMedia & { pedir: ReturnType<typeof vi.fn>; abrir: ReturnType<typeof vi.fn> }
}

describe("a permissão de media do macOS antes da captura", () => {
  it("fora do macOS não lê nem pede nada: a captura decide, como antes", async () => {
    const ler = vi.fn(() => "denied" as const)
    const p = portas({}, { plataforma: "win32", ler })
    const permissao = criarPermissaoDeMedia(p)
    expect(await permissao.pedir(true)).toEqual({ recusado: null })
    expect(ler).not.toHaveBeenCalled()
    expect(p.pedir).not.toHaveBeenCalled()
  })

  it("concedido não abre o diálogo do sistema", async () => {
    const p = portas({ microphone: "granted", camera: "granted" })
    expect(await criarPermissaoDeMedia(p).pedir(true)).toEqual({ recusado: null })
    expect(p.pedir).not.toHaveBeenCalled()
  })

  it("denied e restricted dizem qual o aparelho recusado, sem pedir de novo", async () => {
    for (const estado of ["denied", "restricted"] as const) {
      const p = portas({ microphone: estado })
      expect(await criarPermissaoDeMedia(p).pedir(false)).toEqual({ recusado: "microfone" })
      expect(p.pedir).not.toHaveBeenCalled()
    }
  })

  it("not-determined abre o diálogo; um não da pessoa é uma recusa", async () => {
    const p = portas({ microphone: "not-determined" })
    p.pedir.mockResolvedValueOnce(false)
    expect(await criarPermissaoDeMedia(p).pedir(false)).toEqual({ recusado: "microfone" })
    expect(p.pedir).toHaveBeenCalledWith("microphone")
  })

  it("a câmara só se pede com vídeo, e depois do microfone", async () => {
    const p = portas({ microphone: "not-determined", camera: "denied" })
    expect(await criarPermissaoDeMedia(p).pedir(false)).toEqual({ recusado: null })
    expect(await criarPermissaoDeMedia(p).pedir(true)).toEqual({ recusado: "camara" })
    expect(p.pedir.mock.calls.map((chamada) => chamada[0])).toEqual(["microphone", "microphone"])
  })

  it("um pedido que nunca responde não prende a chamada", async () => {
    // Measured: unsigned, `askForMediaAccess` never resolves. The capture goes on.
    vi.useFakeTimers()
    try {
      const p = portas({ microphone: "not-determined" }, { prazoMs: 1000 })
      p.pedir.mockReturnValueOnce(new Promise(() => {}))
      const resposta = criarPermissaoDeMedia(p).pedir(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await resposta).toEqual({ recusado: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it("um pedido que rebenta não é uma recusa", async () => {
    const p = portas({ microphone: "not-determined" })
    p.pedir.mockRejectedValueOnce(new Error("no"))
    expect(await criarPermissaoDeMedia(p).pedir(false)).toEqual({ recusado: null })
  })

  it("só true literal pede a câmara: o que vem do renderer não decide mais do que isso", async () => {
    const p = portas({ camera: "denied" })
    expect(await criarPermissaoDeMedia(p).pedir("sim")).toEqual({ recusado: null })
  })
})

describe("um só pedido ao sistema de cada vez (1.3.25, Mac M1: vários diálogos seguidos)", () => {
  it("N pedidos em paralelo com o estado por decidir fazem uma só chamada ao sistema", async () => {
    let responder: (valor: boolean) => void = () => {}
    const p = portas({ microphone: "not-determined" })
    p.pedir.mockImplementation(() => new Promise<boolean>((resolver) => (responder = resolver)))
    const permissao = criarPermissaoDeMedia(p)
    const respostas = Array.from({ length: 5 }, () => permissao.pedir(false))
    await Promise.resolve()
    expect(p.pedir).toHaveBeenCalledTimes(1)
    responder(true)
    expect(await Promise.all(respostas)).toEqual(Array.from({ length: 5 }, () => ({ recusado: null })))
    expect(p.pedir).toHaveBeenCalledTimes(1)
  })

  it("o microfone e a câmara em paralelo: uma chamada por aparelho", async () => {
    const p = portas({ microphone: "not-determined", camera: "not-determined" })
    const permissao = criarPermissaoDeMedia(p)
    await Promise.all([permissao.pedir(true), permissao.pedir(true), permissao.pedir(false)])
    expect(p.pedir.mock.calls.map((chamada) => chamada[0]).sort()).toEqual(["camera", "microphone"])
  })

  it("depois da resposta não volta a perguntar, mesmo com o estado ainda por decidir", async () => {
    // Measured with the 1.3.25 bundle: TCC cannot hold the answer, the state stays
    // `not-determined`, and every new question is a new dialog.
    const p = portas({ microphone: "not-determined" })
    const permissao = criarPermissaoDeMedia(p)
    await permissao.pedir(false)
    await permissao.pedir(false)
    await permissao.pedir(false)
    expect(p.pedir).toHaveBeenCalledTimes(1)
  })

  it("o que o sistema sabe vence a resposta guardada", async () => {
    const estados: Record<"microphone" | "camera", EstadoDaPermissao> = { microphone: "not-determined", camera: "granted" }
    const p = portas({}, { ler: (tipo) => estados[tipo] })
    const permissao = criarPermissaoDeMedia(p)
    expect(await permissao.pedir(false)).toEqual({ recusado: null })
    // The person turns the microphone off in System Settings.
    estados.microphone = "denied"
    expect(await permissao.pedir(false)).toEqual({ recusado: "microfone" })
    expect(p.pedir).toHaveBeenCalledTimes(1)
  })

  it("um pedido sem resposta a tempo também se guarda: o segundo não espera outro prazo", async () => {
    vi.useFakeTimers()
    try {
      const p = portas({ microphone: "not-determined" }, { prazoMs: 1000 })
      p.pedir.mockReturnValue(new Promise(() => {}))
      const permissao = criarPermissaoDeMedia(p)
      const primeira = permissao.pedir(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await primeira).toEqual({ recusado: null })
      expect(await permissao.pedir(false)).toEqual({ recusado: null })
      expect(p.pedir).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("o atalho para as Definições do Sistema", () => {
  it("abre o painel do aparelho, por um endereço constante", async () => {
    const p = portas({})
    const permissao = criarPermissaoDeMedia(p)
    expect(await permissao.abrirDefinicoes("microfone")).toEqual({ ok: true })
    expect(await permissao.abrirDefinicoes("camara")).toEqual({ ok: true })
    expect(p.abrir.mock.calls).toEqual([[DEFINICOES_DE_PRIVACIDADE.microfone], [DEFINICOES_DE_PRIVACIDADE.camara]])
    expect(DEFINICOES_DE_PRIVACIDADE.microfone).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    )
  })

  it("recusa o que não é um aparelho, e tudo fora do macOS", async () => {
    const p = portas({})
    expect(await criarPermissaoDeMedia(p).abrirDefinicoes("https://exemplo.pt")).toEqual({ ok: false })
    expect(await criarPermissaoDeMedia({ ...p, plataforma: "linux" }).abrirDefinicoes("microfone")).toEqual({ ok: false })
    expect(p.abrir).not.toHaveBeenCalled()
  })

  it("os canais têm nomes próprios", () => {
    expect(Object.values(CANAIS_DA_PERMISSAO_DE_MEDIA)).toEqual([
      "permissao-de-media:pedir",
      "permissao-de-media:abrir-definicoes",
    ])
  })
})
