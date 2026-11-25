import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { criarAtalhosGlobais } from "./atalhos.js"
import { vigiarFalaNoFundo } from "./falar-no-windows.js"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function montar() {
  const teclas = new Set<number>()
  const transicoes: boolean[] = []
  let noFundo = false
  const atalhos = criarAtalhosGlobais({
    porta: { register: () => true, unregister: () => {}, setSuspended: () => {} },
    plataforma: "win32",
    temAcessibilidade: () => true,
    aoAccionar: () => {},
    vigiarFala: (combinacao, permitido) => vigiarFalaNoFundo(
      combinacao,
      { premida: (tecla) => teclas.has(tecla), mapearCaractere: () => -1 },
      () => permitido() && noFundo,
      (premida) => transicoes.push(premida),
    ),
  })
  return {
    atalhos,
    transicoes,
    foco: (fundo: boolean) => {
      noFundo = fundo
      atalhos.relerFala()
    },
    teclas: (...premidas: number[]) => {
      teclas.clear()
      for (const tecla of premidas) teclas.add(tecla)
      vi.advanceTimersByTime(32)
    },
    definir: (falar: string) => atalhos.definir({ microfone: null, som: null, falar }),
  }
}

it("um atalho abre e fecha o microfone só no fundo e uma vez por pressão", () => {
  const app = montar()
  app.definir("F8")
  app.teclas(0x77)
  app.foco(true)
  expect(app.transicoes).toEqual([])
  app.teclas()
  app.teclas(0x77)
  app.teclas(0x77)
  app.teclas(0x78)
  expect(app.transicoes).toEqual([true, false])
  app.teclas(0x77)
  app.foco(false)
  expect(app.transicoes).toEqual([true, false, true, false])
})

it("gravar outro atalho ou sair da chamada fecha o microfone mesmo com a tecla premida", () => {
  const app = montar()
  app.foco(true)
  app.definir("F8")
  app.teclas(0x77)
  app.atalhos.suspender(true)
  app.atalhos.suspender(false)
  expect(app.transicoes).toEqual([true, false])
  app.teclas()
  app.teclas(0x77)
  app.definir("F9")
  app.teclas(0x78)
  app.atalhos.definir(null)
  app.teclas()
  app.teclas(0x78)
  expect(app.transicoes).toEqual([true, false, true, false, true, false])
})

it("largar um modificador corta a fala e a tecla do rato tem de voltar a ser premida", () => {
  const app = montar()
  app.foco(true)
  app.definir("Mod+Mouse4")
  app.teclas(0x05)
  app.teclas(0x11, 0x05)
  expect(app.transicoes).toEqual([])
  app.teclas(0x11)
  app.teclas(0x11, 0x05)
  app.teclas(0x05)
  app.teclas(0x11, 0x05)
  expect(app.transicoes).toEqual([true, false])
  app.teclas(0x11)
  app.teclas(0x11, 0x05)
  app.atalhos.libertar()
  expect(app.transicoes).toEqual([true, false, true, false])
})
