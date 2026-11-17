import type { DetalhesDoBug } from "@enclave/protocol"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"
import { linguaActual } from "../strings.js"
import { errosMostrados } from "./errosMostrados.js"
import { VERSAO_DA_APP } from "./versao.js"

/**
 * The technical details of a bug report, exactly what the form lists (12/11/2026).
 *
 * Names and versions only, read from the user agent; never the whole string,
 * which carries more than anyone reads. The sync state is a count per state
 * (`em-dia:5 atrasado:1`), never the channels it counts.
 */
export async function detalhesDoBug(bridge: EnclaveBridge, connection: ConnectionState, agente = navigator.userAgent): Promise<DetalhesDoBug> {
  return {
    versao: VERSAO_DA_APP.slice(0, 32),
    plataforma: bridge.bugs?.plataforma ?? "web",
    sistema: sistemaDe(agente),
    browser: browserDe(agente),
    lingua: linguaActual(),
    erros: errosMostrados(),
    ligacao: connection,
    sincronia: await sincroniaResumida(bridge),
  }
}

export function sistemaDe(agente: string): string {
  if (/Android (\d+)/.test(agente)) return `Android ${/Android (\d+)/.exec(agente)![1]}`
  if (/iPhone|iPad/.test(agente)) return `iOS ${(/OS (\d+)_/.exec(agente)?.[1] ?? "").trim()}`.trim()
  if (/Mac OS X/.test(agente)) return "macOS"
  if (/Windows NT 10/.test(agente)) return "Windows 10/11"
  if (/Windows/.test(agente)) return "Windows"
  if (/Linux/.test(agente)) return "Linux"
  return "?"
}

export function browserDe(agente: string): string {
  const achados: [RegExp, string][] = [
    [/Electron\/(\d+)/, "Electron"],
    [/Edg\/(\d+)/, "Edge"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+)[\d.]* .*Safari/, "Safari"],
  ]
  for (const [padrao, nome] of achados) {
    const versao = padrao.exec(agente)?.[1]
    if (versao) return `${nome} ${versao}`
  }
  return "?"
}

async function sincroniaResumida(bridge: EnclaveBridge): Promise<string> {
  try {
    const lista = (await bridge.sincronia?.estado()) ?? []
    if (lista.length === 0) return "?"
    const contagem = new Map<string, number>()
    for (const { estado } of lista) contagem.set(estado, (contagem.get(estado) ?? 0) + 1)
    return [...contagem].map(([estado, n]) => `${estado}:${n}`).join(" ").slice(0, 32)
  } catch {
    return "?"
  }
}
