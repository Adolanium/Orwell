import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { PROXIES_DE_CONFIANCA } from "./app.js"

/**
 * The requester's IP (NET-01, 1.2.1). Production: host nginx > docker-proxy
 * (traffic leaves from the compose network gateway, 172.18.0.1) > Caddy (172.18.0.x) >
 * server. nginx overwrites X-Forwarded-For with $remote_addr, and Caddy,
 * which trusts the gateway, appends it. The server must read the requester's public
 * IP, never a value the requester put on the left.
 */
async function ipVisto(remoteAddress: string, xff?: string): Promise<string> {
  const app = Fastify({ trustProxy: PROXIES_DE_CONFIANCA })
  app.get("/ip", async (request) => request.ip)
  const resposta = await app.inject({
    method: "GET",
    url: "/ip",
    remoteAddress,
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
  })
  await app.close()
  return resposta.body
}

describe("o IP de quem pede", () => {
  it("pelo caminho de produção, é o do cliente", async () => {
    expect(await ipVisto("172.18.0.3", "203.0.113.218, 172.18.0.1")).toBe("203.0.113.218")
  })

  it("um valor forjado à esquerda não passa, mesmo que um proxy o acumulasse", async () => {
    expect(await ipVisto("172.18.0.3", "1.2.3.4, 203.0.113.218, 172.18.0.1")).toBe("203.0.113.218")
  })

  it("quem chega sem proxy não escolhe o próprio IP pelo cabeçalho", async () => {
    expect(await ipVisto("203.0.113.218", "1.2.3.4")).toBe("203.0.113.218")
  })

  it("sem cabeçalho, é o par", async () => {
    expect(await ipVisto("127.0.0.1")).toBe("127.0.0.1")
  })

  it("o Caddy confia só na gateway da rede do compose", () => {
    const caddy = readFileSync(fileURLToPath(new URL("../../../infra/Caddyfile", import.meta.url)), "utf8")
    expect(caddy).toMatch(/\{\n\tservers \{\n\t\ttrusted_proxies static 172\.18\.0\.1\/32\n\t\}\n\}/)
    expect(caddy).not.toMatch(/trusted_proxies static private_ranges/)
  })
})

describe("o nginx da frente (infra/nginx-enclave.conf)", () => {
  const nginx = readFileSync(fileURLToPath(new URL("../../../infra/nginx-enclave.conf", import.meta.url)), "utf8")
  it("sobrescreve o X-Forwarded-For com o IP do par, e não o acumula", () => {
    expect(nginx).toContain("proxy_set_header X-Forwarded-For $remote_addr;")
    expect(nginx).toContain("proxy_set_header X-Real-IP $remote_addr;")
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for")
  })
})

/**
 * The access log keeps no IP address, and there is no error log (every nginx
 * error line carries the client's full IP). The comments are stripped first,
 * so the test reads the directives nginx runs, not the prose around them.
 */
describe("o registo de acesso do nginx não guarda o IP", () => {
  const nginx = readFileSync(fileURLToPath(new URL("../../../infra/nginx-enclave.conf", import.meta.url)), "utf8")
  const semComentarios = nginx
    .split("\n")
    .map((linha) => linha.replace(/#.*$/, ""))
    .join("\n")

  it("o formato não leva IP, user agent nem referer", () => {
    const formato = /log_format orwell_sem_ip '([^']*)'/.exec(semComentarios)?.[1]
    expect(formato).toBeDefined()
    expect(formato).not.toMatch(/\$remote_addr|\$ip_anon|\$binary_remote_addr|\$realip_remote_addr|\$http_user_agent|\$http_referer|\$http_x_forwarded_for|\$http_x_real_ip/)
  })

  it("o access_log do orwell.pt usa esse formato, e só esse", () => {
    expect(semComentarios).toMatch(/access_log\s+\S+\s+orwell_sem_ip;/)
    expect(semComentarios).not.toMatch(/access_log\s+(?!off;)\S+;/)
    expect(semComentarios).not.toMatch(/access_log\s+\S+\s+(?!orwell_sem_ip;)\S+;/)
  })

  it("não há registo de erros em disco", () => {
    const erros = [...semComentarios.matchAll(/error_log\s+([^;]+);/g)].map((achado) => achado[1]!.trim())
    expect(erros.length).toBeGreaterThan(0)
    for (const destino of erros) expect(destino).toBe("/dev/null crit")
  })
})
