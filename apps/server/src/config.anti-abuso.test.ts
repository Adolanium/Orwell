import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"

/** The abuse brake, part 2 (1.3.26), in the environment: defaults on, `0` turns a piece off, garbage stops the start. */
describe("a configuração do travão de abuso", () => {
  it("por omissão: prova de 600 000 (3 000 000 num pico acima de 50 por hora), 3 e 10 por rede, limites da conta nova, 30 entradas por hora", () => {
    const config = loadConfig({})
    expect(config.provaDeTrabalho).toEqual({ trabalho: 600_000, trabalhoNoPico: 3_000_000, picoPorHora: 50 })
    expect(config.limiteDeRede).toEqual({ porHora: 3, porDia: 10 })
    expect(config.contaNova).toEqual({
      intervaloAte24hS: 30,
      intervaloAte72hS: 10,
      maxBytesAte24h: 262_144,
      pessoasAte24h: 5,
      pessoasAte72h: 15,
      comunidades: 1,
      rooms: 12,
      // Communities plus people plus the account's own channels (wall, account channel and spares).
      canaisAte24h: 1 + 5 + 4,
      canaisAte72h: 1 + 15 + 4,
    })
    expect(config.comunidadesPorConta).toBe(5)
    expect(config.channelsPerAccount).toBe(30)
    expect(config.entradasNaSalaComumPorHora).toBe(30)
  })

  it("cada número vem do ambiente", () => {
    const config = loadConfig({
      ENCLAVE_PROVA_TRABALHO: "1000",
      ENCLAVE_PROVA_TRABALHO_NO_PICO: "5000",
      ENCLAVE_PROVA_PICO_POR_HORA: "7",
      ENCLAVE_CONTAS_POR_REDE_HORA: "2",
      ENCLAVE_CONTAS_POR_REDE_DIA: "4",
      ENCLAVE_CONTA_NOVA_INTERVALO_24H_S: "60",
      ENCLAVE_CONTA_NOVA_INTERVALO_72H_S: "20",
      ENCLAVE_CONTA_NOVA_MAX_BYTES_24H: "100000",
      ENCLAVE_CONTA_NOVA_PESSOAS_24H: "2",
      ENCLAVE_CONTA_NOVA_PESSOAS_72H: "6",
      ENCLAVE_CONTA_NOVA_COMUNIDADES: "2",
      ENCLAVE_COMUNIDADES_POR_CONTA: "9",
      ENCLAVE_ROOMS_PER_ACCOUNT: "12",
      ENCLAVE_NEW_ACCOUNT_ROOMS: "4",
      ENCLAVE_SALA_COMUM_ENTRADAS_POR_HORA: "12",
    })
    expect(config.provaDeTrabalho).toEqual({ trabalho: 1000, trabalhoNoPico: 5000, picoPorHora: 7 })
    expect(config.limiteDeRede).toEqual({ porHora: 2, porDia: 4 })
    expect(config.contaNova).toMatchObject({ intervaloAte24hS: 60, intervaloAte72hS: 20, maxBytesAte24h: 100_000, pessoasAte24h: 2, pessoasAte72h: 6, comunidades: 2, canaisAte24h: 2 + 2 + 4, canaisAte72h: 2 + 6 + 4 })
    expect(config.comunidadesPorConta).toBe(9)
    expect(config.channelsPerAccount).toBe(12)
    expect(config.contaNova?.rooms).toBe(4)
    expect(config.entradasNaSalaComumPorHora).toBe(12)
  })

  it("0 desliga cada peça; ENCLAVE_CONTA_NOVA=desligado desliga os limites da conta nova", () => {
    const config = loadConfig({
      ENCLAVE_PROVA_TRABALHO: "0",
      ENCLAVE_CONTAS_POR_REDE_HORA: "0",
      ENCLAVE_CONTAS_POR_REDE_DIA: "0",
      ENCLAVE_CONTA_NOVA: "desligado",
      ENCLAVE_SALA_COMUM_ENTRADAS_POR_HORA: "0",
      ENCLAVE_COMUNIDADES_POR_CONTA: "0",
      ENCLAVE_ROOMS_PER_ACCOUNT: "0",
    })
    expect(config.provaDeTrabalho).toBeUndefined()
    expect(config.limiteDeRede).toBeUndefined()
    expect(config.contaNova).toBeUndefined()
    expect(config.entradasNaSalaComumPorHora).toBe(0)
    expect(config.comunidadesPorConta).toBe(0)
    expect(config.channelsPerAccount).toBe(0)
  })

  it("the room caps still read their old names for one version, and the new name wins when both are set (review note 11)", () => {
    const antigos = loadConfig({ ENCLAVE_CHANNELS_PER_ACCOUNT: "7", ENCLAVE_NEW_ACCOUNT_CHANNELS: "3" })
    expect(antigos.channelsPerAccount).toBe(7)
    expect(antigos.contaNova?.rooms).toBe(3)
    const ambos = loadConfig({
      ENCLAVE_ROOMS_PER_ACCOUNT: "20",
      ENCLAVE_CHANNELS_PER_ACCOUNT: "7",
      ENCLAVE_NEW_ACCOUNT_ROOMS: "6",
      ENCLAVE_NEW_ACCOUNT_CHANNELS: "3",
    })
    expect(ambos.channelsPerAccount).toBe(20)
    expect(ambos.contaNova?.rooms).toBe(6)
    // An empty new name (compose passes every name, set or not) leaves the old one in force.
    const vazio = loadConfig({ ENCLAVE_ROOMS_PER_ACCOUNT: "", ENCLAVE_CHANNELS_PER_ACCOUNT: "7" })
    expect(vazio.channelsPerAccount).toBe(7)
    // Garbage names the variable that carries it.
    expect(() => loadConfig({ ENCLAVE_ROOMS_PER_ACCOUNT: "muitas" })).toThrow(/ENCLAVE_ROOMS_PER_ACCOUNT/)
    expect(() => loadConfig({ ENCLAVE_NEW_ACCOUNT_CHANNELS: "muitas" })).toThrow(/ENCLAVE_NEW_ACCOUNT_CHANNELS/)
  })

  it("lixo pára o arranque, com o nome da variável", () => {
    expect(() => loadConfig({ ENCLAVE_PROVA_TRABALHO: "muito" })).toThrow(/ENCLAVE_PROVA_TRABALHO/)
    expect(() => loadConfig({ ENCLAVE_CONTAS_POR_REDE_HORA: "-1" })).toThrow(/ENCLAVE_CONTAS_POR_REDE_HORA/)
    expect(() => loadConfig({ ENCLAVE_PROVA_TRABALHO: String(2 ** 41) })).toThrow(/ENCLAVE_PROVA_TRABALHO/)
    expect(() => loadConfig({ ENCLAVE_CONTA_NOVA: "talvez" })).toThrow(/ENCLAVE_CONTA_NOVA/)
    expect(() => loadConfig({ ENCLAVE_COMUNIDADES_POR_CONTA: "cinco" })).toThrow(/ENCLAVE_COMUNIDADES_POR_CONTA/)
  })

  it("o .env.example e o docker-compose falam de todas as variáveis", () => {
    const ler = (caminho: string) => readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), "utf8")
    const exemplo = ler("../../../infra/.env.example")
    const compose = ler("../../../infra/docker-compose.yml")
    for (const nome of [
      "ENCLAVE_PROVA_TRABALHO",
      "ENCLAVE_PROVA_TRABALHO_NO_PICO",
      "ENCLAVE_PROVA_PICO_POR_HORA",
      "ENCLAVE_CONTAS_POR_REDE_HORA",
      "ENCLAVE_CONTAS_POR_REDE_DIA",
      "ENCLAVE_CONTA_NOVA",
      "ENCLAVE_CONTA_NOVA_INTERVALO_24H_S",
      "ENCLAVE_CONTA_NOVA_INTERVALO_72H_S",
      "ENCLAVE_CONTA_NOVA_MAX_BYTES_24H",
      "ENCLAVE_CONTA_NOVA_PESSOAS_24H",
      "ENCLAVE_CONTA_NOVA_PESSOAS_72H",
      "ENCLAVE_CONTA_NOVA_COMUNIDADES",
      "ENCLAVE_COMUNIDADES_POR_CONTA",
      "ENCLAVE_ROOMS_PER_ACCOUNT",
      "ENCLAVE_NEW_ACCOUNT_ROOMS",
      "ENCLAVE_SALA_COMUM_ENTRADAS_POR_HORA",
    ]) {
      expect(exemplo, nome).toMatch(new RegExp(`^#?\\s*${nome}=`, "m"))
      expect(compose, nome).toContain(`${nome}: \${${nome}:-}`)
    }
    // The old room names are still passed through, so a server whose .env has them keeps its caps.
    for (const antigo of ["ENCLAVE_CHANNELS_PER_ACCOUNT", "ENCLAVE_NEW_ACCOUNT_CHANNELS"]) {
      expect(compose, antigo).toContain(`${antigo}: \${${antigo}:-}`)
      expect(exemplo, antigo).toContain(antigo)
    }
  })
})
