import { describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"

/**
 * What startup accepts from the environment, and what it refuses loudly.
 *
 * Retention is the case that matters: the value goes into `hello.ok` as
 * `retentionDays`, whose schema requires an integer. A `1.5` accepted here
 * would mean a server that starts fine and sends everyone a frame no client can read.
 */
describe("ENCLAVE_RETENTION_DAYS", () => {
  const com = (valor: string | undefined) =>
    loadConfig({ ...(valor === undefined ? {} : { ENCLAVE_RETENTION_DAYS: valor }) } as NodeJS.ProcessEnv).retentionDays

  it("ausente ou vazio é trinta, e zero é só entrega", () => {
    expect(com(undefined)).toBe(30)
    expect(com("")).toBe(30)
    expect(com("  ")).toBe(30)
    expect(com("0")).toBe(0)
    expect(com(" 7 ")).toBe(7)
  })

  it("dias inteiros, e mais nada", () => {
    expect(() => com("1.5")).toThrow(/whole number/)
    expect(() => com("thirty")).toThrow(/whole number/)
    expect(() => com("-1")).toThrow(/whole number/)
    expect(() => com("Infinity")).toThrow(/whole number/)
  })
})

/** The output budget of the media engine, in Mbit/s. See `orcamento-de-saida.ts`. */
describe("ENCLAVE_ORCAMENTO_VIDEO_MBPS e ENCLAVE_RESERVA_VOZ_MBPS", () => {
  const com = (env: Record<string, string>) => loadConfig(env as NodeJS.ProcessEnv).orcamentoDeSaida

  it("ausentes ou vazios são 300 e 40", () => {
    expect(com({})).toEqual({ videoMbps: 300, reservaDaVozMbps: 40 })
    expect(com({ ENCLAVE_ORCAMENTO_VIDEO_MBPS: " ", ENCLAVE_RESERVA_VOZ_MBPS: "" })).toEqual({ videoMbps: 300, reservaDaVozMbps: 40 })
  })

  it("lê o que o operador escreveu, zero incluído", () => {
    expect(com({ ENCLAVE_ORCAMENTO_VIDEO_MBPS: "250.5", ENCLAVE_RESERVA_VOZ_MBPS: "0" })).toEqual({ videoMbps: 250.5, reservaDaVozMbps: 0 })
  })

  it("recusa lixo e negativos no arranque", () => {
    expect(() => com({ ENCLAVE_ORCAMENTO_VIDEO_MBPS: "3OO" })).toThrow(/ENCLAVE_ORCAMENTO_VIDEO_MBPS/)
    expect(() => com({ ENCLAVE_RESERVA_VOZ_MBPS: "-1" })).toThrow(/ENCLAVE_RESERVA_VOZ_MBPS/)
    expect(() => com({ ENCLAVE_ORCAMENTO_VIDEO_MBPS: "Infinity" })).toThrow(/Mbit/)
  })
})

/** The video cutoff near the monthly quota. See `quota-mensal.ts`. */
describe("ENCLAVE_QUOTA_*", () => {
  const com = (env: Record<string, string>) => loadConfig(env as NodeJS.ProcessEnv).quota

  it("sem ficheiro a vigia fica desligada, com 8 TB e 50 Mbit/s por omissão", () => {
    expect(com({})).toEqual({ ficheiro: "", mensalTb: 8, videoReduzidoMbps: 50 })
  })

  it("lê o que o operador escreveu, e recusa lixo", () => {
    expect(
      com({ ENCLAVE_QUOTA_FICHEIRO: " /quota/x.json ", ENCLAVE_QUOTA_MENSAL_TB: "4", ENCLAVE_ORCAMENTO_VIDEO_REDUZIDO_MBPS: "30" }),
    ).toEqual({ ficheiro: "/quota/x.json", mensalTb: 4, videoReduzidoMbps: 30 })
    expect(() => com({ ENCLAVE_QUOTA_MENSAL_TB: "oito" })).toThrow(/ENCLAVE_QUOTA_MENSAL_TB must be a non-negative number of TB/)
  })
})

describe("ENCLAVE_PUSH, ENCLAVE_PUSH_CONTACTO e ENCLAVE_PUSH_SERVICOS", () => {
  const com = (env: Record<string, string>) => loadConfig(env as NodeJS.ProcessEnv).push

  it("desligado por omissão: ausente, vazio ou off", () => {
    expect(com({})).toBeUndefined()
    expect(com({ ENCLAVE_PUSH: "" })).toBeUndefined()
    expect(com({ ENCLAVE_PUSH: "off" })).toBeUndefined()
    expect(com({ ENCLAVE_PUSH: " OFF " })).toBeUndefined()
  })

  it("on liga, com os quatro serviços de push conhecidos e sem contacto", () => {
    expect(com({ ENCLAVE_PUSH: "on" })).toEqual({
      contacto: "",
      servicos: ["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com", "*.notify.windows.com"],
    })
    expect(com({ ENCLAVE_PUSH: " On " })).toBeDefined()
  })

  it("lixo é um erro no arranque", () => {
    expect(() => com({ ENCLAVE_PUSH: "talvez" })).toThrow(/ENCLAVE_PUSH/)
  })

  it("o contacto é mailto: ou https:, e mais nada", () => {
    expect(com({ ENCLAVE_PUSH: "on", ENCLAVE_PUSH_CONTACTO: " mailto:ops@exemplo.pt " })?.contacto).toBe("mailto:ops@exemplo.pt")
    expect(com({ ENCLAVE_PUSH: "on", ENCLAVE_PUSH_CONTACTO: "https://exemplo.pt" })?.contacto).toBe("https://exemplo.pt")
    expect(() => com({ ENCLAVE_PUSH: "on", ENCLAVE_PUSH_CONTACTO: "ops@exemplo.pt" })).toThrow(/ENCLAVE_PUSH_CONTACTO/)
  })

  it("os serviços extra juntam-se aos conhecidos, em minúsculas", () => {
    expect(com({ ENCLAVE_PUSH: "on", ENCLAVE_PUSH_SERVICOS: " Push.Exemplo.pt , *.outro.pt,," })?.servicos.slice(4)).toEqual(["push.exemplo.pt", "*.outro.pt"])
    expect(() => com({ ENCLAVE_PUSH: "on", ENCLAVE_PUSH_SERVICOS: "https://push.exemplo.pt" })).toThrow(/ENCLAVE_PUSH_SERVICOS/)
  })
})

describe("a chave VAPID", () => {
  it("nasce no primeiro arranque com modo 0600, e a mesma volta no segundo", async () => {
    const { mkdtempSync, rmSync, statSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { loadOrCreatePushKey } = await import("./config.js")
    const dir = mkdtempSync(join(tmpdir(), "enclave-vapid-"))
    try {
      const um = loadOrCreatePushKey(dir)
      expect(um.publicKey.length).toBe(65)
      expect(um.publicKey[0]).toBe(4)
      expect(statSync(join(dir, "push.key.json")).mode & 0o777).toBe(0o600)
      const dois = loadOrCreatePushKey(dir)
      expect(Buffer.from(dois.privateKey).toString("hex")).toBe(Buffer.from(um.privateKey).toString("hex"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
