import { abrirSinal } from "@enclave/crypto"
import { fromBase64, generateDeviceKey, generateIdentity, parseServerName, signWithDevice, toBase64, type Identity } from "@enclave/protocol"
import { bytesParaBase64, guardarVideo, newVaultContents, type StoredChatMessage, type VaultContents } from "../src/vault.js"
import { TECTOS_DO_HISTORICO } from "../src/historico/conteudo.js"
import {
  HistoricoEntreAparelhos,
  TECTOS_DO_FIO_DO_HISTORICO,
  type EventoDoHistorico,
  type PortaDoArmazemDoHistorico,
  type PortaDoHistorico,
} from "../src/historico/historico.js"

/**
 * Two devices of one account wired signal to signal, for the history-between-devices
 * tests of 1.3.27 (`src/historico/media-*.test.ts`). `perder` drops a signal on the
 * way; `porta` stays on each device, so a test can build a new instance on the same
 * vault (a reload).
 */
const CASA = parseServerName("localhost")
const CANAL_DA_CONTA = "!conta:localhost"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(3) }
const portaAntiga: PortaDoArmazemDoHistorico = {
  presente: () => false,
  inflar: { payload: async (p) => p, bytes: async () => null },
  absorver: (_c, p) => p,
  guardarVideo: (c, sha, bytes, at) => guardarVideo(c, sha, bytesParaBase64(bytes), at),
}

export interface Aparelho {
  contents: VaultContents
  h: HistoricoEntreAparelhos
  porta: PortaDoHistorico
  eventos: EventoDoHistorico[]
  aparelho: string
}

/** The clear header of a signal (`k`, `id`, part `i` of `n`), or `null`. */
export function cabecalhoDe(sinal: string): { k: string; id?: string; i?: number; n?: number; f?: number[] } | null {
  const a = abrirSinal(CHAVE, CANAL_DA_CONTA, fromBase64(sinal))
  if (!a || a[0] !== 0x48) return null
  const c = new DataView(a.buffer, a.byteOffset, a.byteLength).getUint16(1, false)
  return JSON.parse(new TextDecoder().decode(a.subarray(3, 3 + c)))
}

export function doisAparelhos(perder: (sinal: string, de: Aparelho) => boolean): { a: Aparelho; b: Aparelho } {
  const conta: Identity = generateIdentity(CASA)
  const k = generateDeviceKey()
  const contaB = { ...conta, deviceSigningPrivateKey: k.privateKey, deviceSigningPublicKey: k.publicKey } as Identity
  const aps: Aparelho[] = []
  const criar = (id: Identity): Aparelho => {
    const contents = newVaultContents()
    const eu = { contents, eventos: [], aparelho: toBase64(id.deviceSigningPublicKey) } as unknown as Aparelho
    eu.porta = {
      eu: () => ({ address: conta.address, aparelho: id.deviceSigningPublicKey, assinar: (m) => signWithDevice(id, m) }),
      conteudo: () => contents,
      canalDaConta: () => CANAL_DA_CONTA,
      contaPronta: async () => true,
      folhasDaConta: () => aps.map((x) => x.aparelho),
      derivarChave: async () => CHAVE,
      podeSinalizar: () => true,
      enviarSinal: (sinal) => {
        if (perder(sinal, eu)) return
        for (const o of aps) if (o !== eu) void o.h.aoSinal({ channel: CANAL_DA_CONTA, from: conta.address, sinal })
      },
      gravar: (m) => m(contents),
      temGrupo: (c) => c in contents.history,
      bloqueado: () => false,
      lugar: () => undefined,
      emitir: (e) => eu.eventos.push(e),
      agora: () => Date.now(),
      armazem: portaAntiga,
    }
    eu.h = new HistoricoEntreAparelhos(eu.porta)
    aps.push(eu)
    return eu
  }
  return { a: criar(conta), b: criar(contaB) }
}

/** A reload of this device: the instance dies, a new one opens on the same vault. */
export function recarregar(ap: Aparelho): void {
  ap.h.aoDesligar()
  ap.h = new HistoricoEntreAparelhos(ap.porta)
  ap.h.aoLigar()
}

export async function ate(p: () => boolean, ms: number): Promise<boolean> {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (p()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return false
}

export function mensagem(seq: number, extra: Record<string, unknown> = {}): StoredChatMessage {
  return { seq, sender: "@a:x", at: 1000 + seq, payload: { t: "message", id: `m${seq}`, sentAt: 1000 + seq, body: `m${seq}`, attachments: [], mentions: [], ...extra } }
}

/** An image attachment of `bytes` random bytes, inline. */
export function imagem(nome: string, bytes: number): Record<string, unknown> {
  const b64 = toBase64(crypto.getRandomValues(new Uint8Array(bytes)))
  return { name: nome, mediaType: "image/png", byteLength: b64.length, inline: `data:image/png;base64,${b64}` }
}

/** The wire numbers scaled down so a test runs in seconds; `repor` puts them back. */
export function tectosRapidos(): { repor: () => void } {
  const fio = { ...TECTOS_DO_FIO_DO_HISTORICO }
  const conteudo = { ...TECTOS_DO_HISTORICO }
  Object.assign(TECTOS_DO_FIO_DO_HISTORICO, {
    sinaisPorMinuto: 100_000,
    passoMs: 20,
    esperaDaRespostaMs: 300,
    esperaEntreJanelasMs: 300,
    esperaDoInventarioMs: 300,
    primeiraReposicaoMs: 50,
    intervaloDaReposicaoMs: 50,
    bytesPorParte: 1_024,
    partesPorJanela: 4,
  })
  Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 5, mediaComOTexto: 1_000 })
  return {
    repor: () => {
      Object.assign(TECTOS_DO_FIO_DO_HISTORICO, fio)
      Object.assign(TECTOS_DO_HISTORICO, conteudo)
    },
  }
}

/** The plan finished: no plan, no "initial" mark. */
export function acabou(b: Aparelho): boolean {
  return b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined
}
