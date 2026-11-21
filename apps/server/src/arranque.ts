/**
 * The startup clock (1.3.26).
 *
 * The 1.3.25 deploy took 1 min 45 s to open the port and nothing in the log said
 * where the time went. Every phase on the critical path now prints one line,
 * `enclave: arranque: <phase> <ms> ms`, so the next deploy shows its own numbers.
 *
 * Only phase names and durations. No counts of accounts, channels or events: an
 * unauthenticated log line about volume is the same traffic-analysis feed the
 * health endpoint refuses to be.
 *
 * `buildServer` takes the clock as an option and writes nothing without it: the
 * test suites build hundreds of servers and must stay quiet. `main.ts` passes one.
 */
export type EscritaDoArranque = (linha: string) => void

export class RelogioDoArranque {
  readonly #escrever: EscritaDoArranque
  readonly #agora: () => number
  readonly #inicio: number

  constructor(escrever: EscritaDoArranque, agora: () => number = () => performance.now()) {
    this.#escrever = escrever
    this.#agora = agora
    this.#inicio = agora()
  }

  /** Runs `trabalho` and writes how long it took, also when it throws. */
  fase<T>(nome: string, trabalho: () => T): T {
    const inicio = this.#agora()
    let falhou = true
    try {
      const resultado = trabalho()
      falhou = false
      return resultado
    } finally {
      this.#linha(nome, this.#agora() - inicio, falhou)
    }
  }

  /** The same, for work that has to be awaited (the media engine, the listen). */
  async faseAssincrona<T>(nome: string, trabalho: () => Promise<T>): Promise<T> {
    const inicio = this.#agora()
    let falhou = true
    try {
      const resultado = await trabalho()
      falhou = false
      return resultado
    } finally {
      this.#linha(nome, this.#agora() - inicio, falhou)
    }
  }

  /** A duration measured elsewhere (module loading, which happens before this clock exists). */
  registar(nome: string, ms: number): void {
    this.#linha(nome, ms, false)
  }

  /** The total since the clock was made: the port is open and serving. */
  pronto(): void {
    this.#linha("pronto", this.#agora() - this.#inicio, false)
  }

  #linha(nome: string, ms: number, falhou: boolean): void {
    this.#escrever(`enclave: arranque: ${nome} ${Math.round(ms)} ms${falhou ? " (falhou)" : ""}`)
  }
}

/** Runs `trabalho` as phase `nome` when there is a clock, and just runs it when there is not. */
export function medir<T>(relogio: RelogioDoArranque | undefined, nome: string, trabalho: () => T): T {
  return relogio ? relogio.fase(nome, trabalho) : trabalho()
}
