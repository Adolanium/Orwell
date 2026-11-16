import { TECTOS_DO_ARMAZEM } from "@enclave/client-core"
import { describe, expect, it } from "vitest"
import {
  LADO_DA_MINIATURA,
  QUALIDADE_DA_MINIATURA,
  dimensoesDaMiniatura,
  fazerMiniatura,
  miniaturistaDaWeb,
  servirMiniaturas,
  type EscopoDasMiniaturas,
  type PortasDaMiniatura,
} from "./miniaturista.js"

/**
 * The web thumbnailer. jsdom has neither `createImageBitmap` nor
 * `OffscreenCanvas`: the browser ports are swapped for fakes that record what
 * they are asked. The arithmetic (the size, the format, the quality) is real.
 */

interface Pedido {
  w: number
  h: number
  tipo: string
  qualidade: number
}

function portasFalsas(opcoes: { largura: number; altura: number; semWebp?: boolean; naoDescodifica?: boolean }) {
  const pedidos: Pedido[] = []
  let fechadas = 0
  const portas: PortasDaMiniatura = {
    descodificar: async () =>
      opcoes.naoDescodifica ? null : { width: opcoes.largura, height: opcoes.altura, close: () => void fechadas++ },
    codificar: async (_imagem, w, h, tipo, qualidade) => {
      pedidos.push({ w, h, tipo, qualidade })
      // Safari returns PNG when it cannot do WebP.
      const feito = opcoes.semWebp && tipo === "image/webp" ? "image/png" : tipo
      return { bytes: new Uint8Array([w, h]), tipo: feito }
    },
  }
  return { portas, pedidos, fechadas: () => fechadas }
}

describe("dimensoesDaMiniatura", () => {
  it("leva o lado maior a 320 e mantém a proporção", () => {
    expect(dimensoesDaMiniatura(1000, 500, 320)).toEqual({ w: 320, h: 160 })
    expect(dimensoesDaMiniatura(600, 1200, 320)).toEqual({ w: 160, h: 320 })
  })
  it("nunca aumenta uma imagem que já é pequena", () => {
    expect(dimensoesDaMiniatura(200, 100, 320)).toEqual({ w: 200, h: 100 })
  })
  it("uma imagem muito estreita fica com 1 px, nunca 0", () => {
    expect(dimensoesDaMiniatura(10_000, 2, 320)).toEqual({ w: 320, h: 1 })
  })
})

describe("fazerMiniatura", () => {
  it("o lado da miniatura é o do núcleo, 320 px, em WebP a 0,8", () => {
    expect(LADO_DA_MINIATURA).toBe(TECTOS_DO_ARMAZEM.ladoDaMiniatura)
    expect(QUALIDADE_DA_MINIATURA).toBe(0.8)
  })

  it("faz WebP a 0,8 com o lado maior a 320 px, e fecha a imagem", async () => {
    const falsas = portasFalsas({ largura: 1600, altura: 1200 })
    const mini = await fazerMiniatura(new Uint8Array([1]), "image/jpeg", falsas.portas)
    expect(mini).toEqual({ bytes: new Uint8Array([320, 240]), tipo: "image/webp", w: 320, h: 240 })
    expect(falsas.pedidos).toEqual([{ w: 320, h: 240, tipo: "image/webp", qualidade: 0.8 }])
    expect(falsas.fechadas()).toBe(1)
  })

  it("sem WebP no browser, cai para JPEG a 0,8", async () => {
    const falsas = portasFalsas({ largura: 640, altura: 640, semWebp: true })
    const mini = await fazerMiniatura(new Uint8Array([1]), "image/png", falsas.portas)
    expect(mini?.tipo).toBe("image/jpeg")
    expect(falsas.pedidos.map((p) => p.tipo)).toEqual(["image/webp", "image/jpeg"])
  })

  it("um formato que o browser não descodifica dá nulo", async () => {
    const falsas = portasFalsas({ largura: 1, altura: 1, naoDescodifica: true })
    expect(await fazerMiniatura(new Uint8Array([1]), "image/avif", falsas.portas)).toBeNull()
    expect(falsas.pedidos).toEqual([])
  })

  it("um erro a codificar dá nulo, e a imagem fecha-se na mesma", async () => {
    const falsas = portasFalsas({ largura: 900, altura: 900 })
    falsas.portas.codificar = async () => {
      throw new Error("canvas morto")
    }
    expect(await fazerMiniatura(new Uint8Array([1]), "image/jpeg", falsas.portas)).toBeNull()
    expect(falsas.fechadas()).toBe(1)
  })
})

/** A Worker that runs `servirMiniaturas` on this thread, with the fake ports. */
function workerFalso(portas: PortasDaMiniatura): { worker: Worker; transferidos: unknown[][] } {
  const transferidos: unknown[][] = []
  const lado: { onmessage: ((e: MessageEvent) => void) | null; onerror: (() => void) | null; onmessageerror: (() => void) | null } = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  }
  const escopo: EscopoDasMiniaturas = {
    onmessage: null,
    postMessage: (dados, transferir) => {
      transferidos.push(transferir ?? [])
      setTimeout(() => lado.onmessage?.({ data: dados } as MessageEvent), 0)
    },
  }
  servirMiniaturas(escopo, portas)
  const worker = Object.assign(lado, {
    postMessage: (dados: unknown) => setTimeout(() => escopo.onmessage?.({ data: dados } as MessageEvent), 0),
    terminate: () => {},
  })
  return { worker: worker as unknown as Worker, transferidos }
}

describe("miniaturistaDaWeb", () => {
  it("pede ao worker e devolve a miniatura; os bytes de quem pede não se transferem", async () => {
    const falsas = portasFalsas({ largura: 3200, altura: 1600 })
    const { worker, transferidos } = workerFalso(falsas.portas)
    const miniaturista = miniaturistaDaWeb(() => worker)
    const original = new Uint8Array([7, 7, 7])
    const mini = await miniaturista.fazer(original, "image/jpeg")
    expect(mini).toEqual({ bytes: new Uint8Array([320, 160]), tipo: "image/webp", w: 320, h: 160 })
    expect(original).toEqual(new Uint8Array([7, 7, 7]))
    expect(transferidos[0]).toHaveLength(1)
  })

  it("vários pedidos ao mesmo tempo chegam cada um ao seu dono", async () => {
    const falsas = portasFalsas({ largura: 640, altura: 320 })
    const { worker } = workerFalso(falsas.portas)
    const miniaturista = miniaturistaDaWeb(() => worker)
    const [a, b] = await Promise.all([miniaturista.fazer(new Uint8Array([1]), "image/png"), miniaturista.fazer(new Uint8Array([2]), "image/gif")])
    expect(a?.w).toBe(320)
    expect(b?.w).toBe(320)
  })

  it("um formato que não descodifica dá nulo", async () => {
    const { worker } = workerFalso(portasFalsas({ largura: 1, altura: 1, naoDescodifica: true }).portas)
    expect(await miniaturistaDaWeb(() => worker).fazer(new Uint8Array([1]), "image/avif")).toBeNull()
  })

  it("sem Worker, ou com um worker que morre, dá nulo", async () => {
    expect(await miniaturistaDaWeb(() => null).fazer(new Uint8Array([1]), "image/png")).toBeNull()
    const morto = {
      onmessage: null,
      onerror: null as (() => void) | null,
      onmessageerror: null,
      postMessage(): void {
        setTimeout(() => this.onerror?.(), 0)
      },
      terminate: () => {},
    }
    const miniaturista = miniaturistaDaWeb(() => morto as unknown as Worker)
    expect(await miniaturista.fazer(new Uint8Array([1]), "image/png")).toBeNull()
  })

  it("um tipo que não é imagem nem chega ao worker", async () => {
    let criados = 0
    const miniaturista = miniaturistaDaWeb(() => {
      criados++
      return null
    })
    expect(await miniaturista.fazer(new Uint8Array([1]), "application/pdf")).toBeNull()
    expect(criados).toBe(0)
  })
})
