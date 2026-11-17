import { p256 } from "@noble/curves/nist.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SERVICOS_DE_PUSH } from "./config.js"
import { CarteiroDoPush, endpointPermitido, type TransporteDoPush } from "./push.js"
import { ServicoDePushFalso } from "../testes/servico-de-push-falso.js"

/**
 * The push sender: queue, HTTP, the headers the plan fixes, and what each
 * answer from the push service does. Against a fake push service on 127.0.0.1
 * that verifies the VAPID token and decrypts the body like a browser.
 */
const chave = (() => {
  const privateKey = p256.utils.randomSecretKey()
  return { privateKey, publicKey: p256.getPublicKey(privateKey, false) }
})()

let servico: ServicoDePushFalso

beforeAll(async () => {
  servico = new ServicoDePushFalso()
  servico.chaveDoServidor = chave.publicKey
  await servico.arrancar()
})

afterAll(async () => {
  await servico?.parar()
})

function carteiro(opcoes: { transporte?: TransporteDoPush; expirados?: string[]; reenvioMs?: number } = {}): CarteiroDoPush {
  return new CarteiroDoPush({
    chave,
    contacto: "https://casa.test",
    transporte: opcoes.transporte ?? servico.transporte,
    aoExpirar: (endpoint) => opcoes.expirados?.push(endpoint),
    reenvioMs: opcoes.reenvioMs ?? 20,
  })
}

describe("o pedido ao serviço de push", () => {
  it("leva VAPID válido, os quatro cabeçalhos, e o corpo decifra para a língua", async () => {
    const aparelho = servico.novoAparelho()
    const c = carteiro()
    c.enviar({ ...aparelho, lingua: "pt" })
    await c.ocioso()
    const [r] = servico.recebidos.filter((x) => x.id === aparelho.id)
    expect(r?.texto).toBe("pt")
    expect(r?.aud).toBe("https://push.test")
    expect(r?.sub).toBe("https://casa.test")
    // `exp` about 12 h from now, and never past the 24 h the RFC allows.
    const agora = Math.floor(Date.now() / 1000)
    expect(r?.exp).toBeGreaterThan(agora + 11 * 3600)
    expect(r?.exp).toBeLessThanOrEqual(agora + 12 * 3600 + 5)
    expect(r?.cabecalhos).toMatchObject({ ttl: "86400", urgency: "high", topic: "m", "content-encoding": "aes128gcm" })
    expect(r?.cabecalhos["content-type"]).toBe("application/octet-stream")
  })

  it("todos os pushes têm o mesmo tamanho, em pt e em en", async () => {
    const a = servico.novoAparelho()
    const b = servico.novoAparelho()
    const c = carteiro()
    c.enviar({ ...a, lingua: "pt" })
    c.enviar({ ...b, lingua: "en" })
    await c.ocioso()
    const tamanhos = servico.recebidos.filter((x) => x.id === a.id || x.id === b.id).map((x) => x.bytes)
    expect(tamanhos).toHaveLength(2)
    expect(new Set(tamanhos).size).toBe(1)
    expect(servico.recebidos.find((x) => x.id === b.id)?.texto).toBe("en")
  })
})

describe("as respostas do serviço de push", () => {
  it.each([404, 410])("%i apaga a subscrição, sem repetir", async (codigo) => {
    const aparelho = servico.novoAparelho()
    servico.respostas.set(aparelho.id, [codigo])
    const expirados: string[] = []
    const c = carteiro({ expirados })
    c.enviar({ ...aparelho, lingua: "pt" })
    await c.ocioso()
    expect(expirados).toEqual([aparelho.endpoint])
    expect(servico.quantos(aparelho)).toBe(0)
  })

  it.each([429, 500, 503])("%i repete uma vez, e a repetição chega", async (codigo) => {
    const aparelho = servico.novoAparelho()
    servico.respostas.set(aparelho.id, [codigo])
    const c = carteiro()
    c.enviar({ ...aparelho, lingua: "pt" })
    await c.ocioso()
    expect(servico.quantos(aparelho)).toBe(1)
    expect(c.metricas.repetidos).toBeGreaterThanOrEqual(1)
  })

  it("dois 429 seguidos: desiste, e não apaga", async () => {
    const aparelho = servico.novoAparelho()
    servico.respostas.set(aparelho.id, [429, 429])
    const expirados: string[] = []
    const c = carteiro({ expirados })
    c.enviar({ ...aparelho, lingua: "pt" })
    await c.ocioso()
    expect(servico.quantos(aparelho)).toBe(0)
    expect(expirados).toEqual([])
  })

  it("um 400 não repete e não apaga", async () => {
    const pedidos: string[] = []
    const c = carteiro({
      transporte: async (url) => {
        pedidos.push(url)
        return 400
      },
    })
    const aparelho = servico.novoAparelho()
    c.enviar({ ...aparelho, lingua: "pt" })
    await c.ocioso()
    expect(pedidos).toHaveLength(1)
  })

  it("um serviço que não responde não trava a fila: falha e segue", async () => {
    let chamadas = 0
    const c = carteiro({
      transporte: async () => {
        chamadas += 1
        throw new Error("timeout")
      },
    })
    c.enviar({ ...servico.novoAparelho(), lingua: "pt" })
    await c.ocioso()
    // A network failure is one try and one repeat, like a 5xx.
    expect(chamadas).toBe(2)
  })
})

describe("a fila", () => {
  it("nunca leva mais de oito pedidos ao mesmo tempo", async () => {
    let emVoo = 0
    let maximo = 0
    const c = carteiro({
      transporte: async () => {
        emVoo += 1
        maximo = Math.max(maximo, emVoo)
        await new Promise((r) => setTimeout(r, 10))
        emVoo -= 1
        return 201
      },
    })
    for (let i = 0; i < 40; i++) c.enviar({ ...servico.novoAparelho(), lingua: "pt" })
    await c.ocioso()
    expect(maximo).toBe(CarteiroDoPush.EM_PARALELO)
    expect(c.metricas.enviados).toBe(40)
  })

  it("cheia, descarta o mais antigo", async () => {
    const enviados: string[] = []
    let soltar: () => void = () => {}
    const travado = new Promise<void>((r) => (soltar = r))
    const c = carteiro({
      transporte: async (url) => {
        await travado
        enviados.push(url)
        return 201
      },
    })
    const total = CarteiroDoPush.EM_PARALELO + CarteiroDoPush.FILA_MAX + 5
    const endpoints = Array.from({ length: total }, (_, i) => `https://push.test/fila-${i}`)
    const chaves = servico.novoAparelho()
    for (const endpoint of endpoints) c.enviar({ ...chaves, endpoint, lingua: "pt" })
    expect(c.metricas.descartados).toBe(5)
    soltar()
    await c.ocioso()
    expect(enviados).toHaveLength(total - 5)
    // The first eight were already in flight; the five dropped are the oldest still waiting.
    const descartados = endpoints.slice(CarteiroDoPush.EM_PARALELO, CarteiroDoPush.EM_PARALELO + 5)
    for (const d of descartados) expect(enviados).not.toContain(d)
    expect(enviados).toContain(endpoints[total - 1])
  })
})

describe("o endpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/QH1",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://fcm.googleapis.com:443/fcm/send/abc",
  ])("%s passa", (url) => {
    expect(endpointPermitido(url, SERVICOS_DE_PUSH)).not.toBeNull()
  })

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilfcm.googleapis.com/x",
    "https://notify.windows.com/x",
    "https://user:pass@fcm.googleapis.com/x",
    "não é url",
  ])("%s não passa", (url) => {
    expect(endpointPermitido(url, SERVICOS_DE_PUSH)).toBeNull()
  })
})
