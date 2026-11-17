/**
 * The microphone watchdog, with a clock on hand (4/11/2026).
 *
 * Each case is one of the ways the microphone dies silently that Chromium
 * showed in `scripts/mic-recupera-evidencia/`: the track ending, the track
 * `muted` for X seconds, the `AudioContext` suspended, the worklet with an error and the
 * worklet stopped. And the case that is NOT death: the main thread frozen.
 */
import { describe, expect, it } from "vitest"
import { sistemaSuspendeCaptura, VigiaDoMicrofone, type MorteDoMicrofone, type RelogioDaVigia, type SaudeDoMicrofone } from "./vigia-do-microfone.js"

class Relogio implements RelogioDaVigia {
  t = 0
  #tarefas: { fazer: () => void; ms: number; proxima: number }[] = []
  agora(): number {
    return this.t
  }
  repetir(fazer: () => void, ms: number): unknown {
    const tarefa = { fazer, ms, proxima: this.t + ms }
    this.#tarefas.push(tarefa)
    return tarefa
  }
  parar(marca: unknown): void {
    this.#tarefas = this.#tarefas.filter((tarefa) => tarefa !== marca)
  }
  /** Time running, with intervals firing when they come due. */
  andar(ms: number): void {
    const fim = this.t + ms
    for (;;) {
      const tarefa = [...this.#tarefas].sort((a, b) => a.proxima - b.proxima)[0]
      if (!tarefa || tarefa.proxima > fim) break
      this.t = tarefa.proxima
      tarefa.proxima += tarefa.ms
      tarefa.fazer()
    }
    this.t = fim
  }
  /** The frozen thread: time passes and no interval completes. */
  congelar(ms: number): void {
    this.t += ms
    for (const tarefa of this.#tarefas) tarefa.proxima = this.t
  }
}

function montar(saude: {
  faixa: { readyState: string; muted: boolean }
  contexto?: { state: string }
  cadeia?: { ultimoBatimento: number; rebentou: boolean }
  escondida?: boolean
}) {
  const relogio = new Relogio()
  const mortes: { morte: MorteDoMicrofone; detalhe: string }[] = []
  const vigia = new VigiaDoMicrofone(
    () => saude as SaudeDoMicrofone,
    (morte, detalhe) => mortes.push({ morte, detalhe }),
    relogio,
  )
  vigia.ligar()
  return { relogio, mortes, vigia, saude }
}

describe("a vigia do microfone", () => {
  it("um microfone de pé não morre", () => {
    const cadeia = { ultimoBatimento: 0, rebentou: false }
    const { relogio, mortes } = montar({ faixa: { readyState: "live", muted: false }, contexto: { state: "running" }, cadeia })
    for (let i = 0; i < 100; i++) {
      cadeia.ultimoBatimento = relogio.t
      relogio.andar(100)
    }
    expect(mortes).toEqual([])
  })

  it("a faixa crua a terminar é «terminou», no segundo seguinte", () => {
    const { relogio, mortes, saude, vigia } = montar({ faixa: { readyState: "live", muted: false } })
    relogio.andar(1_500)
    saude.faixa.readyState = "ended"
    relogio.andar(1_000)
    expect(mortes).toEqual([{ morte: "terminou", detalhe: "" }])
    // One death at a time: the watchdog stays off until the caller rearms it.
    expect(vigia.ligada).toBe(false)
  })

  it("a faixa muted durante 3 s é «calado»; um mute curto não é nada", () => {
    const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false } })
    saude.faixa.muted = true
    relogio.andar(2_000)
    saude.faixa.muted = false
    relogio.andar(5_000)
    expect(mortes).toEqual([])

    saude.faixa.muted = true
    relogio.andar(5_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["calado"])
  })

  it("o AudioContext suspenso mais de 2 s é «contexto-parado»", () => {
    const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false }, contexto: { state: "running" } })
    saude.contexto!.state = "suspended"
    relogio.andar(1_000)
    expect(mortes).toEqual([])
    relogio.andar(3_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["contexto-parado"])
    expect(mortes[0]!.detalhe).toContain("suspended")
  })

  it("o worklet com erro é «cadeia-rebentou»", () => {
    const { relogio, mortes, saude } = montar({
      faixa: { readyState: "live", muted: false },
      contexto: { state: "running" },
      cadeia: { ultimoBatimento: 0, rebentou: false },
    })
    saude.cadeia!.rebentou = true
    relogio.andar(1_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["cadeia-rebentou"])
  })

  it("o worklet que deixa de bater, com o contexto a dizer running, é «cadeia-parada»", () => {
    const { relogio, mortes } = montar({
      faixa: { readyState: "live", muted: false },
      contexto: { state: "running" },
      cadeia: { ultimoBatimento: 0, rebentou: false },
    })
    relogio.andar(2_500)
    expect(mortes).toEqual([])
    relogio.andar(2_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["cadeia-parada"])
  })

  it("um congelamento de 10 s da thread principal não é uma morte", () => {
    const cadeia = { ultimoBatimento: 0, rebentou: false }
    const { relogio, mortes } = montar({ faixa: { readyState: "live", muted: false }, contexto: { state: "running" }, cadeia })
    cadeia.ultimoBatimento = relogio.t
    relogio.andar(900)
    // The vault: ten seconds without the thread. Worklet messages queue up.
    relogio.congelar(10_000)
    relogio.andar(1)
    expect(mortes).toEqual([])
    // The queued messages arrive, and the worklet keeps beating.
    for (let i = 0; i < 50; i++) {
      cadeia.ultimoBatimento = relogio.t
      relogio.andar(100)
    }
    expect(mortes).toEqual([])
  })

  it("rearmada com uma captura nova, recomeça as contagens", () => {
    const { relogio, mortes, saude, vigia } = montar({ faixa: { readyState: "live", muted: false } })
    saude.faixa.readyState = "ended"
    relogio.andar(1_000)
    expect(mortes).toHaveLength(1)

    saude.faixa = { readyState: "live", muted: false }
    vigia.ligar()
    relogio.andar(10_000)
    expect(mortes).toHaveLength(1)
  })

  /*
    The locked screen. iOS mutes the capture of an installed web app in the
    background, and a phone call interrupts the context. Reopening the
    microphone there fails, and four failures stopped the watchdog for good:
    back on screen, the person was mute for the rest of the call.
  */
  describe("com a página escondida (ecrã bloqueado)", () => {
    it("uma faixa muted durante minutos não é uma morte enquanto a página está escondida", () => {
      const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false }, escondida: true })
      saude.faixa.muted = true
      relogio.andar(15 * 60_000)
      expect(mortes).toEqual([])
    })

    it("um contexto parado e uma cadeia sem batimento também esperam pela volta", () => {
      const { relogio, mortes } = montar({
        faixa: { readyState: "live", muted: false },
        contexto: { state: "interrupted" },
        cadeia: { ultimoBatimento: 0, rebentou: false },
        escondida: true,
      })
      relogio.andar(5 * 60_000)
      expect(mortes).toEqual([])
    })

    it("uma faixa que terminou escondida morre na primeira leitura depois de voltar", () => {
      const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false }, escondida: true })
      saude.faixa.readyState = "ended"
      relogio.andar(60_000)
      expect(mortes).toEqual([])
      saude.escondida = false
      relogio.andar(1_000)
      expect(mortes).toEqual([{ morte: "terminou", detalhe: "ao voltar" }])
    })

    it("uma faixa ainda muted ao voltar morre logo, sem esperar 3 s", () => {
      const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false }, escondida: true })
      saude.faixa.muted = true
      relogio.andar(60_000)
      saude.escondida = false
      relogio.andar(1_000)
      expect(mortes).toEqual([{ morte: "calado", detalhe: "ao voltar" }])
    })

    it("uma faixa que o sistema devolveu ao voltar não morre", () => {
      const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false }, escondida: true })
      saude.faixa.muted = true
      relogio.andar(60_000)
      saude.faixa.muted = false
      saude.escondida = false
      relogio.andar(10_000)
      expect(mortes).toEqual([])
    })

    it("um contexto parado ao voltar tem os 2 s de sempre para retomar", () => {
      const contexto = { state: "interrupted" }
      const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false }, contexto, escondida: true })
      relogio.andar(60_000)
      saude.escondida = false
      relogio.andar(1_000)
      contexto.state = "running"
      relogio.andar(10_000)
      expect(mortes).toEqual([])
    })
  })

  describe("sistemaSuspendeCaptura: só o telemóvel e o iOS", () => {
    it("o computador não suspende, o telemóvel e o iOS suspendem", () => {
      const rato = () => ({ matches: false })
      const toque = (consulta: string) => ({ matches: consulta === "(pointer: coarse)" })
      expect(sistemaSuspendeCaptura({ matchMedia: rato, navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Electron/39", platform: "Win32", maxTouchPoints: 0 } })).toBe(false)
      expect(sistemaSuspendeCaptura({ matchMedia: rato, navigator: { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 } })).toBe(false)
      expect(sistemaSuspendeCaptura({ matchMedia: toque, navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14)" } })).toBe(true)
      expect(sistemaSuspendeCaptura({ navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" } })).toBe(true)
      // An iPad that reports itself as a Mac.
      expect(sistemaSuspendeCaptura({ matchMedia: rato, navigator: { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 } })).toBe(true)
      expect(sistemaSuspendeCaptura({})).toBe(false)
    })
  })
})
