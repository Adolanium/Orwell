/**
 * Mixed versions on one server: a device on this core (1.3.27) with members and
 * siblings on the 1.3.25 and 1.3.26 cores, in both directions.
 *
 *   npm run build
 *   E2E_CORE_1325=<worktree at 1cf9f155> E2E_CORE_1326=<worktree at 00adbb5a> node scripts/e2e-mixed-versions.mjs
 *   ... --only=1.3.25|1.3.26                                 (one old version)
 *
 * The old cores come by environment, as folders on disk, never a network
 * target: `git worktree add --detach <dir> <commit>`, then `npm ci && npx tsc -b
 * packages/protocol packages/crypto packages/client-core` there. This script
 * loads `<dir>/packages/client-core/dist/index.js`, which resolves its own
 * protocol and crypto from that worktree.
 *
 * Why it exists (1.3.27). After a release, people run three versions at once
 * for days: the hotfixes of 1.3.26 changed the seat requests, the history
 * between devices, the own profile and the common room card, and every one of
 * those talks across devices and accounts.
 *
 * All accounts are core sessions here in Node: the core is what the web and
 * the desktop app run, and what is at stake is the wire between versions. For
 * each old version, two rounds on a fresh server, so each side is once the one
 * that founds the common room:
 *   round "old first": Ana on the OLD core, Bruno on THIS core;
 *   round "new first": Ana on THIS core, Bruno on the OLD core.
 * In each round:
 *  1. Common room card: Ana connects first and founds the common room; Bruno
 *     joins it by Ana's card. Both read each other there.
 *  2. Seat: Ana founds a channel and seats Bruno; Bruno founds one and seats
 *     Ana. Both read each other in both.
 *  3. History: Ana pairs a second device on the OTHER core (by link). The new
 *     device gets the conversation and both channels from Ana's first device,
 *     and its own seat (it writes, Bruno reads it).
 *  4. Profile: Ana's first device renames her; the second adopts it. Then the
 *     second renames her; the first adopts it, and Bruno sees the last name.
 * With 1.3.25 the server runs without the proof of work at registration, which
 * that app cannot solve; on a real server its accounts predate the proof.
 *
 * ALL LOCAL AND DISPOSABLE: `servidor-descartavel.mjs` (the web is not used),
 * ports 8768 and 8769 (`E2E_PORTA_DA_FRENTE`, `E2E_PORTA_DO_SERVIDOR`), one
 * server per round, 127.0.0.1 only.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as current from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]
const OLD = [
  ["1.3.25", process.env.E2E_CORE_1325],
  ["1.3.26", process.env.E2E_CORE_1326],
].filter(([version]) => !only || only === version)
for (const [version, dir] of OLD) {
  if (!dir || !existsSync(join(resolve(dir), "packages/client-core/dist/index.js"))) {
    console.error(`E2E_CORE_${version.replace(/\./g, "")} must name a built worktree of ${version}. See the header of this script.`)
    process.exit(2)
  }
}

const { check, resumo } = verificador()
const PORTS = { frente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8768), servidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8769) }
const open = []
let srv = null

async function cleanUp(code) {
  for (const s of open.splice(0)) s.disconnect()
  srv?.fechar()
  process.exit(code)
}

class MemoryVaultBackend {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(bytes) {
    this.bytes = bytes
  }
  async clear() {
    this.bytes = null
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(predicate, ms = 60_000, step = 200) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await Promise.resolve().then(predicate).catch(() => false)) return true
    await wait(step)
  }
  return false
}

const line = (body) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] })
const entries = (vault, channel) => [...(vault.contents.history?.[channel] ?? []), ...(vault.contents.estadoDoCanal?.[channel] ?? [])]
const hears = (account, channel, body) => entries(account.vault, channel).some((e) => e.payload?.t === "message" && e.payload.body === body)

/** A new account on `core` (`{ label, mod }`), in the common room, connected. */
async function account(core, name, server) {
  const vault = new core.mod.Vault(new MemoryVaultBackend())
  await vault.create("frase-passe-de-teste")
  const session = new core.mod.Session(vault, { armazem: new core.mod.ArmazemEmMemoria() })
  const identity = await session.createIdentity(server.NOME)
  await session.escolherSalaComum?.(true)
  await session.connect()
  open.push(session)
  await session.updateProfile({ displayName: name, donations: [] })
  return { name: `${name} (${core.label})`, core, session, vault, address: identity.address }
}

function pairPhase(session, phase, ms = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`pairing never reached ${phase}`))
    }, ms)
    const off = session.on("pair", (event) => {
      if (event.fase === phase) {
        clearTimeout(timer)
        off()
        resolve(event)
      } else if (event.fase === "falhou") {
        clearTimeout(timer)
        off()
        reject(new Error(`pairing failed: ${event.razao}`))
      }
    })
  })
}

/** A second device of `host`'s account, on `core`, paired by link. */
async function pairDevice(host, core) {
  const vault = new core.mod.Vault(new MemoryVaultBackend())
  await vault.create("frase-do-aparelho")
  const session = new core.mod.Session(vault, { armazem: new core.mod.ArmazemEmMemoria() })
  const sasHost = pairPhase(host.session, "sas")
  const { link } = await host.session.emparelharComoAnfitriao()
  const sasGuest = pairPhase(session, "sas")
  session.emparelharComoConvidado(link)
  await Promise.all([sasHost, sasGuest])
  const certificate = pairPhase(session, "certificado")
  const done = pairPhase(host.session, "concluido", 60_000)
  await session.confirmarSas()
  await host.session.confirmarSas()
  await certificate
  const identity = session.loadIdentity()
  await session.connect()
  open.push(session)
  session.concluirEmparelhamento()
  await done
  return { name: `${host.name.split(" ")[0]} second (${core.label})`, core, session, vault, address: identity.address }
}

const cores = { current: { label: "1.3.27", mod: current } }
for (const [version, dir] of OLD) cores[version] = { label: version, mod: await import(pathToFileURL(join(resolve(dir), "packages/client-core/dist/index.js")).href) }

try {
  for (const [version] of OLD) {
    for (const round of ["old first", "new first"]) {
      const first = round === "old first" ? cores[version] : cores.current
      const second = round === "old first" ? cores.current : cores[version]
      const tag = `${version} ${round}`
      console.log(`\n=== ${tag}: Ana on ${first.label}, Bruno on ${second.label} ===`)
      /*
        A 1.3.25 app cannot solve the proof of work at registration (1.3.26), so
        with 1.3.25 the proof is off: its accounts on a real server were made
        before 1.3.26. Logging in again never asks for it.
      */
      srv = await levantarServidor({ ...PORTS, etiqueta: "mixed-versions", env: version === "1.3.25" ? { ENCLAVE_PROVA_TRABALHO: "0" } : {} })
      const COMMON = `!orwell:${srv.NOME}`

      // 1. The common room: Ana founds it, Bruno joins by her card.
      const ana = await account(first, "Ana", srv)
      check(`${tag}: Ana (${first.label}) is in the common room`, await until(() => ana.session.channels.includes(COMMON), 60_000))
      const bruno = await account(second, "Bruno", srv)
      check(`${tag}: Bruno (${second.label}) joins the common room by the card`, await until(() => bruno.session.channels.includes(COMMON), 90_000))
      await ana.session.send(COMMON, line(`sala comum da Ana ${tag}`)).catch(() => {})
      await bruno.session.send(COMMON, line(`sala comum do Bruno ${tag}`)).catch(() => {})
      check(`${tag}: Bruno reads Ana in the common room`, await until(() => hears(bruno, COMMON, `sala comum da Ana ${tag}`)))
      check(`${tag}: Ana reads Bruno in the common room`, await until(() => hears(ana, COMMON, `sala comum do Bruno ${tag}`)))

      // Friends, so each may seat the other.
      const dm = await ana.session.openDirect(bruno.address)
      await until(() => bruno.session.channels.includes(dm), 30_000)
      await ana.session.sendFriendRequest(dm)
      await until(() => bruno.session.friendTies().get(ana.address)?.link === "pedido-recebido", 30_000)
      await bruno.session.acceptFriend(dm, ana.address)
      check(`${tag}: Ana and Bruno are friends`, await until(() => ana.session.friendTies().get(bruno.address)?.link === "amigos"))
      await ana.session.send(dm, line(`directa ${tag}`))

      // 2. Seats, both ways.
      const anaChannel = moradaDeSala(srv.NOME)
      await ana.session.createSpaceChannel(anaChannel, "da-ana")
      await until(() => ana.session.founderOf(anaChannel) === ana.address, 30_000)
      await ana.session.seat(anaChannel, bruno.address)
      check(`${tag}: ${first.label} seats ${second.label}`, await until(() => bruno.session.channels.includes(anaChannel)))
      const brunoChannel = moradaDeSala(srv.NOME)
      await bruno.session.createSpaceChannel(brunoChannel, "do-bruno")
      await until(() => bruno.session.founderOf(brunoChannel) === bruno.address, 30_000)
      await bruno.session.seat(brunoChannel, ana.address)
      check(`${tag}: ${second.label} seats ${first.label}`, await until(() => ana.session.channels.includes(brunoChannel)))
      for (const [channel, label] of [[anaChannel, "Ana's channel"], [brunoChannel, "Bruno's channel"]]) {
        await ana.session.send(channel, line(`ana em ${label} ${tag}`))
        await bruno.session.send(channel, line(`bruno em ${label} ${tag}`))
        check(`${tag}: both read each other in ${label}`, (await until(() => hears(bruno, channel, `ana em ${label} ${tag}`))) && (await until(() => hears(ana, channel, `bruno em ${label} ${tag}`))))
      }

      // 3. History and seat for a second device of Ana, on the other core.
      const ana2 = await pairDevice(ana, second)
      check(`${tag}: Ana pairs a device on ${second.label}`, ana2.address === ana.address)
      check(
        `${tag}: the history comes from ${first.label} to ${second.label}`,
        await until(() => hears(ana2, dm, `directa ${tag}`) && hears(ana2, anaChannel, `bruno em Ana's channel ${tag}`) && hears(ana2, brunoChannel, `bruno em Bruno's channel ${tag}`), 180_000, 1_000),
      )
      check(`${tag}: the second device gets its seats`, await until(() => ana2.session.channels.includes(anaChannel) && ana2.session.channels.includes(brunoChannel), 120_000, 500))
      await until(async () => {
        await ana2.session.send(brunoChannel, line(`segundo aparelho ${tag}`))
        return true
      }, 60_000, 2_000)
      check(`${tag}: Bruno reads Ana's second device`, await until(() => hears(bruno, brunoChannel, `segundo aparelho ${tag}`), 90_000))

      // 4. The own profile, both ways between the siblings.
      await ana.session.updateProfile({ displayName: `Ana1 ${version.replace(/\./g, "")}`, donations: [] })
      check(`${tag}: ${second.label} adopts the profile from ${first.label}`, await until(() => ana2.vault.contents.profile?.displayName === `Ana1 ${version.replace(/\./g, "")}`, 120_000, 500))
      await wait(1_100)
      await ana2.session.updateProfile({ displayName: `Ana2 ${version.replace(/\./g, "")}`, donations: [] })
      check(`${tag}: ${first.label} adopts the profile from ${second.label}`, await until(() => ana.vault.contents.profile?.displayName === `Ana2 ${version.replace(/\./g, "")}`, 120_000, 500))
      check(
        `${tag}: Bruno sees Ana's last name`,
        await until(() => bruno.vault.contents.directory?.[ana.address]?.payload?.displayName === `Ana2 ${version.replace(/\./g, "")}`, 120_000, 500),
      )

      for (const s of open.splice(0)) s.disconnect()
      srv.fechar()
      srv = null
      await wait(500)
    }
  }
} catch (error) {
  check("the script reached the end", false, String(error?.message ?? error).split("\n")[0])
}

await cleanUp(resumo() ? 0 : 1)
