/**
 * Three admins connect and disconnect ten times each in a room of 100+ members,
 * and nobody hears channel state (hotfix 1.3.12). Then a newcomer joins and one
 * old member comes back: both still get the state.
 *
 *   npx tsc -b && npm run build -w @enclave/server
 *   node --dns-result-order=ipv4first scripts/prova-religacoes-sem-estado.mjs [--membros 104] [--voltas 10]
 *
 * Counted on the server, which is the honest count: events in the room's table
 * while the admins reconnect. An admin that said its state would put ~20 events
 * there per connection (roles, 30 assignments, 4 categories, 6 rooms, banner).
 * And on a member in Node, by type, from the server (`seq >= 0`).
 *
 * ALL LOCAL: own homeserver in a temp folder, ports 8530 and 8531.
 */
import { DatabaseSync } from "node:sqlite"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { levantarServidor } from "./servidor-descartavel.mjs"

const argumento = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? Number(process.argv[i + 1]) : omissao
}
const MEMBROS = argumento("--membros", 104)
const VOLTAS = argumento("--voltas", 10)
const ESTADO = new Set(["room.created", "role.define", "role.assign", "channel.meta", "channel.category", "space.meta"])

const casa = await levantarServidor({ frente: 8530, servidor: 8531, etiqueta: "religacoes" })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (condicao()) return true
    await wait(200)
  }
  return false
}
class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(b) {
    this.bytes = b
  }
  async clear() {
    this.bytes = null
  }
}
const contas = []
async function conta(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const id = await session.createIdentity(casa.NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const c = { nome, session, address: id.address }
  contas.push(c)
  return c
}
const resultados = []
const verificar = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` (${detalhe})` : ""}`)
}
const eventosNaSala = (canal) => {
  const base = new DatabaseSync(casa.base, { readOnly: true })
  const n = base.prepare("SELECT COUNT(*) AS n FROM events WHERE channel = ? AND kind = 'application'").get(canal).n
  base.close()
  return n
}

let codigo = 0
try {
  const t0 = Date.now()
  const [dona, bruno, carla, dario] = [await conta("Dona"), await conta("Bruno"), await conta("Carla"), await conta("Dário")]
  const canal = moradaDeSala(casa.NOME)
  await dona.session.createSpaceChannel(canal, "Sala grande")
  await ate(() => dona.session.founderOf(canal) === dona.address)
  for (const quem of [bruno, carla, dario]) await dona.session.seat(canal, quem.address)
  for (let i = 0; i < MEMBROS - 4; i++) {
    const m = await conta(`m${i}`)
    await dona.session.seat(canal, m.address)
    m.session.disconnect()
  }
  await dona.session.defineRole(canal, { role: "guarda", name: "Guarda", powers: ["convidar"] })
  for (const admin of [bruno, carla]) await dona.session.assignRoles(canal, admin.address, ["admin"])
  const reais = dona.session.membersOf(canal).map(String).filter((a) => ![dona.address, bruno.address, carla.address].includes(a))
  for (const quem of reais.slice(0, 30)) await dona.session.assignRoles(canal, quem, ["guarda"])
  for (const c of ["Geral", "Jogos", "Arquivo", "Voz"]) await dona.session.upsertCategory(canal, { category: c })
  for (let i = 0; i < 6; i++) await dona.session.upsertRoom(canal, { room: `sala-${i}`, name: `sala ${i}`, category: "Geral" })
  await dona.session.updateSpaceMeta(canal, { name: "Sala grande" })
  verificar(`a sala tem ${MEMBROS} membros`, dona.session.membersOf(canal).length === MEMBROS, `${dona.session.membersOf(canal).length}`)
  await ate(() => bruno.session.mayEditChannel(canal) && carla.session.mayEditChannel(canal) && dario.session.roomsOf(canal).length === 6)
  await wait(5_000)
  console.log(`  ..  caso montado em ${Math.round((Date.now() - t0) / 1000)} s`)

  const ouvidos = []
  const outros = new Map()
  dario.session.on("message", (m) => {
    if (m.channel !== canal || m.seq < 0) return
    if (ESTADO.has(m.payload.t)) ouvidos.push(m.payload.t)
    else outros.set(m.payload.t, (outros.get(m.payload.t) ?? 0) + 1)
  })
  const quatro = [dona, bruno, carla, dario]
  const tramasAntes = quatro.map((c) => c.session.estatisticasDaSincronia.tramasDeRelato)
  const antes = eventosNaSala(canal)
  for (let volta = 0; volta < VOLTAS; volta++) {
    for (const admin of [dona, bruno, carla]) {
      admin.session.disconnect()
      await wait(150)
      await admin.session.connect()
    }
  }
  await wait(5_000)
  const depois = eventosNaSala(canal)
  const tramas = quatro.map((c, i) => `${c.nome} +${c.session.estatisticasDaSincronia.tramasDeRelato - tramasAntes[i]}`).join(", ")
  console.log(`  ..  o que o Dário ouviu que não é estado: ${JSON.stringify(Object.fromEntries(outros))}; tramas de relatos enviadas: ${tramas}`)
  // Anti-entropy reports travel as `typing` frames and are stored: they answer a difference, they are not a republish.
  verificar(`${VOLTAS * 3} ligações de administradores: nenhum evento de estado na sala`, ouvidos.length === 0, `${depois - antes} eventos no total`)

  // Converges for whoever joins: Dona invites Eva.
  const eva = await conta("Eva")
  await dona.session.seat(canal, eva.address)
  const evaOk = await ate(
    () => eva.session.founderOf(canal) === dona.address && eva.session.roomsOf(canal).length === 6 && eva.session.rolesFor(canal, reais[0]).includes("guarda"),
    45_000,
  )
  verificar("quem entra fica com fundadora, salas e cargos", evaOk)

  // And for whoever comes back after a change.
  dario.session.disconnect()
  await wait(300)
  await dona.session.upsertRoom(canal, { room: "nova", name: "nova", category: "Geral" })
  await dario.session.connect()
  verificar("quem volta fica com a sala nova", await ate(() => dario.session.roomsOf(canal).length === 7, 30_000))
} catch (erro) {
  console.error("O guião caiu:", erro?.stack ?? erro)
  codigo = 1
}
for (const c of contas) c.session.disconnect()
casa.fechar()
const passaram = resultados.filter(Boolean).length
console.log(`\n${passaram}/${resultados.length} verificações passaram`)
process.exit(codigo || (passaram === resultados.length ? 0 : 1))
