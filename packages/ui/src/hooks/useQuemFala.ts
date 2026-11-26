import { useEffect, useRef, useState } from "react"
import { obterContextoDeAudio } from "../lib/contextoDeAudio.js"
import { ChaoDeRuido, dbDeRms, inicioDaEscala, nivelDaVoz } from "../lib/medidorDeDb.js"
import { criarDetectorDeFala, mesmoConjunto } from "../lib/quemFala.js"

export interface VozDaChamada {
  id: string
  stream: MediaStream | null
  micCalado: boolean
  /** The local input meter, when supplied by the capture chain. */
  db?: () => number | null
}

const SEM_FALA: ReadonlySet<string> = new Set()
const PERIODO_MS = 100

function ligarMedidor(faixas: readonly MediaStreamTrack[]) {
  const contexto = obterContextoDeAudio()
  if (!contexto) return null
  const clones = faixas.map((faixa) => faixa.clone())
  for (const clone of clones) clone.enabled = true
  try {
    const fonte = contexto.createMediaStreamSource(new MediaStream(clones))
    const analisador = contexto.createAnalyser()
    analisador.fftSize = 512
    fonte.connect(analisador)
    return {
      analisador,
      desligar() {
        fonte.disconnect()
        analisador.disconnect()
        for (const clone of clones) clone.stop()
      },
    }
  } catch {
    for (const clone of clones) clone.stop()
    return null
  }
}

function lerDb(no: AnalyserNode, amostras: Float32Array<ArrayBuffer>, bytes: Uint8Array<ArrayBuffer>): number {
  let soma = 0
  if (typeof no.getFloatTimeDomainData === "function") {
    no.getFloatTimeDomainData(amostras)
    for (const valor of amostras) soma += valor * valor
  } else {
    no.getByteTimeDomainData(bytes)
    for (const valor of bytes) {
      const desvio = (valor - 128) / 128
      soma += desvio * desvio
    }
  }
  return dbDeRms(Math.sqrt(soma / amostras.length))
}

function entradaAberta(faixas: readonly MediaStreamTrack[]): boolean {
  return faixas.some((faixa) => faixa.enabled !== false && faixa.readyState !== "ended")
}

function criarMedidor(faixas: MediaStreamTrack[], instante: number) {
  return { faixas, entrada: ligarMedidor(faixas), chao: new ChaoDeRuido(instante), detector: criarDetectorDeFala() }
}

/** One speaking snapshot for the joined call. The timer still runs without animation frames in the game overlay. */
export function useQuemFala(sala: string | null, vozes: readonly VozDaChamada[]): ReadonlySet<string> {
  const [medida, setMedida] = useState<{ sala: string; falam: ReadonlySet<string> } | null>(null)
  const fontes = useRef(vozes)
  const salaActual = useRef(sala)
  const fluxosAnteriores = useRef(new Set<MediaStream>())
  if (sala !== salaActual.current) {
    // The view may select a new room before the call engine clears the old roster.
    fluxosAnteriores.current = sala === null ? new Set() : new Set(fontes.current.flatMap((voz) => voz.stream && !voz.db ? [voz.stream] : []))
    salaActual.current = sala
  }
  fontes.current = vozes

  useEffect(() => {
    if (sala === null) {
      setMedida(null)
      return
    }
    const medidores = new Map<string, ReturnType<typeof criarMedidor>>()
    const amostras = new Float32Array(512)
    const bytes = new Uint8Array(512)

    const medir = (): void => {
      const instante = performance.now()
      const activos = new Set<string>()
      const falam = new Set<string>()
      for (const voz of fontes.current) {
        if (voz.micCalado || !voz.stream || fluxosAnteriores.current.has(voz.stream)) continue
        const faixas = voz.stream.getAudioTracks()
        if (!entradaAberta(faixas)) continue
        activos.add(voz.id)
        let medidor = medidores.get(voz.id)
        if (!medidor || medidor.faixas.length !== faixas.length || medidor.faixas.some((faixa, i) => faixa !== faixas[i])) {
          medidor?.entrada?.desligar()
          medidor = criarMedidor(faixas, instante)
          medidores.set(voz.id, medidor)
        }
        const db = voz.db?.() ?? (medidor.entrada ? lerDb(medidor.entrada.analisador, amostras, bytes) : -120)
        medidor.chao.observar(db, instante)
        const nivel = nivelDaVoz(db, inicioDaEscala(medidor.chao.valor(instante)))
        if (medidor.detector.observar(nivel, instante)) falam.add(voz.id)
      }
      for (const [id, medidor] of medidores) {
        if (activos.has(id)) continue
        medidor.entrada?.desligar()
        medidores.delete(id)
      }
      setMedida((antes) => (antes?.sala === sala && mesmoConjunto(antes.falam, falam) ? antes : { sala, falam }))
    }

    const relogio = setInterval(medir, PERIODO_MS)
    return () => {
      clearInterval(relogio)
      for (const medidor of medidores.values()) medidor.entrada?.desligar()
    }
  }, [sala])

  if (sala === null || medida?.sala !== sala || medida.falam.size === 0) return SEM_FALA
  // A mute or departure is visible in the very same render, before the next sample.
  const audiveis = vozes.filter((voz) => !voz.micCalado && voz.stream && medida.falam.has(voz.id))
  return audiveis.length === medida.falam.size ? medida.falam : new Set(audiveis.map((voz) => voz.id))
}
