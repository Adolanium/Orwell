import { fromBase64, toBase64 } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  ETIQUETA_DO_PUSH,
  cancelarNoBrowser,
  dadosDaSubscricao,
  estadoDoPushNoBrowser,
  fecharAvisosDoPush,
  subscreverNoBrowser,
  type AmbienteDoPush,
  type SubscricaoDoBrowser,
} from "./push.js"

/**
 * The browser half of Web Push, against a fake `PushManager`: subscribe with
 * the server key, reuse a subscription made with the same key, replace one
 * made with another, cancel, and close the push notices on reconnect.
 */
const CHAVE = toBase64(new Uint8Array(65).fill(4))
const OUTRA = toBase64(new Uint8Array(65).fill(5))

class SubscricaoFalsa implements SubscricaoDoBrowser {
  cancelada = false
  constructor(
    readonly endpoint: string,
    readonly chave: Uint8Array,
    readonly expirationTime: number | null = null,
  ) {}
  get options() {
    return { applicationServerKey: this.chave.buffer as ArrayBuffer }
  }
  getKey(nome: "p256dh" | "auth"): ArrayBuffer | null {
    return (nome === "p256dh" ? new Uint8Array(65).fill(4) : new Uint8Array(16).fill(1)).buffer as ArrayBuffer
  }
  async unsubscribe(): Promise<boolean> {
    this.cancelada = true
    return true
  }
}

function ambiente(opcoes: { existente?: SubscricaoFalsa; recusa?: boolean; semRegisto?: boolean } = {}) {
  let actual: SubscricaoFalsa | null = opcoes.existente ?? null
  const pedidos: { userVisibleOnly: boolean; chave: string }[] = []
  const fechados: string[] = []
  const amb: AmbienteDoPush = {
    temPushManager: true,
    ios: false,
    instalada: false,
    registo: async () =>
      opcoes.semRegisto
        ? null
        : {
            pushManager: {
              getSubscription: async () => (actual && !actual.cancelada ? actual : null),
              subscribe: async (o: PushSubscriptionOptionsInit) => {
                if (opcoes.recusa) throw new DOMException("denied", "NotAllowedError")
                const chave = new Uint8Array(o.applicationServerKey as ArrayBuffer)
                pedidos.push({ userVisibleOnly: o.userVisibleOnly === true, chave: toBase64(chave) })
                actual = new SubscricaoFalsa(`https://push.test/${pedidos.length}`, chave, 1_900_000_000_000)
                return actual
              },
            },
            getNotifications: async (filtro?: { tag?: string }) =>
              [ETIQUETA_DO_PUSH, ETIQUETA_DO_PUSH, "outra"]
                .filter((tag) => filtro?.tag === undefined || filtro.tag === tag)
                .map((tag) => ({ close: () => fechados.push(tag) })),
          },
  }
  return { amb, pedidos, fechados, actual: () => actual }
}

describe("o estado do browser", () => {
  it("pronto com PushManager; iOS fora do ecrã principal diz-se; outro browser sem PushManager não", () => {
    const base = ambiente().amb
    expect(estadoDoPushNoBrowser(base)).toBe("pronto")
    expect(estadoDoPushNoBrowser({ ...base, temPushManager: false, ios: true, instalada: false })).toBe("ios-fora-do-ecra")
    expect(estadoDoPushNoBrowser({ ...base, temPushManager: false, ios: false })).toBe("sem-browser")
    // Installed on iOS 16.4+, PushManager exists.
    expect(estadoDoPushNoBrowser({ ...base, ios: true, instalada: true })).toBe("pronto")
  })
})

describe("subscrever", () => {
  it("subscreve com userVisibleOnly e a chave do servidor em bytes", async () => {
    const { amb, pedidos } = ambiente()
    const sub = await subscreverNoBrowser(amb, CHAVE)
    expect(pedidos).toEqual([{ userVisibleOnly: true, chave: CHAVE }])
    expect(sub.endpoint).toBe("https://push.test/1")
  })

  it("reaproveita a subscrição feita com a mesma chave", async () => {
    const existente = new SubscricaoFalsa("https://push.test/velha", fromBase64(CHAVE))
    const { amb, pedidos } = ambiente({ existente })
    expect(await subscreverNoBrowser(amb, CHAVE)).toBe(existente)
    expect(pedidos).toEqual([])
  })

  it("a chave do servidor mudou: cancela a velha e subscreve de novo", async () => {
    const existente = new SubscricaoFalsa("https://push.test/velha", fromBase64(OUTRA))
    const { amb, pedidos } = ambiente({ existente })
    const nova = await subscreverNoBrowser(amb, CHAVE)
    expect(existente.cancelada).toBe(true)
    expect(nova.endpoint).toBe("https://push.test/1")
    expect(pedidos).toHaveLength(1)
  })

  it("a recusa do browser chega como o erro 791", async () => {
    const { amb } = ambiente({ recusa: true })
    await expect(subscreverNoBrowser(amb, CHAVE)).rejects.toThrow("the browser refused the notification subscription")
  })

  it("sem Service Worker activo também é 791", async () => {
    const { amb } = ambiente({ semRegisto: true })
    await expect(subscreverNoBrowser(amb, CHAVE)).rejects.toThrow("the browser refused the notification subscription")
  })

  it("os dados para o servidor: endpoint, chaves em base64url, e a validade", async () => {
    const { amb } = ambiente()
    const sub = await subscreverNoBrowser(amb, CHAVE)
    expect(dadosDaSubscricao(sub, { lingua: "en", silenciados: ["!a:b", "!a:b/sala"], calarAte: 5 })).toEqual({
      endpoint: "https://push.test/1",
      p256dh: toBase64(new Uint8Array(65).fill(4)),
      auth: toBase64(new Uint8Array(16).fill(1)),
      lingua: "en",
      // A room is inside the ciphertext: only whole channels go.
      silenciados: ["!a:b"],
      calarAte: 5,
      expiresAt: 1_900_000_000_000,
    })
  })
})

describe("cancelar e fechar", () => {
  it("cancelar desfaz a subscrição do browser", async () => {
    const existente = new SubscricaoFalsa("https://push.test/velha", fromBase64(CHAVE))
    const { amb } = ambiente({ existente })
    await cancelarNoBrowser(amb)
    expect(existente.cancelada).toBe(true)
  })

  it("ao voltar a ligar fecha só os avisos do push", async () => {
    const { amb, fechados } = ambiente()
    await fecharAvisosDoPush(amb)
    expect(fechados).toEqual([ETIQUETA_DO_PUSH, ETIQUETA_DO_PUSH])
  })
})
