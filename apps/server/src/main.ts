import { buildServer } from "./app.js"
import { RelogioDoArranque } from "./arranque.js"
import { loadConfig } from "./config.js"

// One line per startup phase, so every deploy shows where its time went (1.3.26).
// `modulos` is everything before this line: Node itself and the imports.
const relogio = new RelogioDoArranque((linha) => void process.stderr.write(`${linha}\n`))
relogio.registar("modulos", performance.now())

const config = loadConfig()
const enclave = await buildServer(config, { relogio })

await relogio.faseAssincrona("porta", () => enclave.app.listen({ host: config.bindHost, port: config.bindPort }))
relogio.pronto()

process.stdout.write(
  [
    `enclave homeserver  ${config.serverName}`,
    `  listening         http://${config.bindHost}:${config.bindPort}`,
    `  gateway           ws://${config.bindHost}:${config.bindPort}/_enclave/gateway`,
    `  database          ${config.databasePath}`,
    `  retention         ${config.retentionDays === 0 ? "none (delivery only)" : `${config.retentionDays} days`}`,
    `  federation        ${config.allowlist.length ? `allowlist: ${config.allowlist.join(", ")}` : "open"}`,
    "",
  ].join("\n"),
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void enclave.close().then(() => process.exit(0))
  })
}
