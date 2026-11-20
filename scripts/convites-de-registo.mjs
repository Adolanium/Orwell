#!/usr/bin/env node
/**
 * Registration invite codes (1.3.25), for a server with `ENCLAVE_REGISTO=convite`.
 * A person runs it; the server never makes codes by itself.
 *
 * Usage:
 *   node scripts/convites-de-registo.mjs criar [--usos N] [--dias D]
 *   node scripts/convites-de-registo.mjs listar
 *   node scripts/convites-de-registo.mjs revogar <start of the hash>
 *   node scripts/convites-de-registo.mjs limpar
 *
 * `criar` prints the code ONCE. The database keeps only its SHA-256, so a lost
 * code is not recovered: revoke it and make another. `--usos` (1 by default, up to
 * 1000) is how many NEW accounts it lets in; `--dias` (7 by default, up to 90)
 * is when it expires. Every code expires. `listar` shows hashes and counts,
 * never codes. `revogar` deletes one code by the start of its hash (at least 8
 * hex digits, and only one may match). `limpar` deletes the codes that expired or
 * are used up.
 *
 * **Where.** By default LOCAL, and then `ORWELL_BASE` (the `enclave.sqlite`) is
 * required and must exist: nothing is created. Production only with
 * `ORWELL_ALVO=producao` and `ORWELL_SSH` (user@host); `ORWELL_SSH_KEY` chooses
 * the key, as in `denuncias.mjs`. The table exists only after the server of 1.3.25 started
 * once: before that, sqlite3 says "no such table".
 *
 * **The formats are the server's** (`apps/server/src/registo.ts` and
 * `normalizarConviteDeRegisto` in `packages/protocol/src/registo.ts`), written
 * here by hand because the script has no dependencies and does not import
 * TypeScript. The test (`apps/server/src/convites-de-registo.test.ts`) makes a
 * code with this script and logs a new account in with it on a real server:
 * if a format changes there, the test fails here.
 */
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { parseArgs } from "node:util"

const PRODUCAO = process.env.ORWELL_ALVO === "producao"
const ANFITRIAO = process.env.ORWELL_SSH ?? ""
const CHAVE = process.env.ORWELL_SSH_KEY ? ["-i", process.env.ORWELL_SSH_KEY] : []
if (PRODUCAO && !ANFITRIAO) {
  console.error("Falta ORWELL_SSH (por exemplo utilizador@anfitriao) para ir ao servidor.")
  process.exit(2)
}
const VOLUME = "/var/lib/docker/volumes/enclave_server-data/_data"

const USO = `Uso:
  node scripts/convites-de-registo.mjs criar [--usos N] [--dias D]
  node scripts/convites-de-registo.mjs listar
  node scripts/convites-de-registo.mjs revogar <início do hash>
  node scripts/convites-de-registo.mjs limpar

Local por omissão: ORWELL_BASE obrigatória. Produção: ORWELL_ALVO=producao.`

class Recusa extends Error {}

// ------------------------------------------------------------ server formats

/** `ALFABETO` from `registo.ts`: Crockford's base32. 32 symbols, so a byte & 31 is unbiased. */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** `gerarConviteDeRegisto`: 16 symbols in groups of four. */
function gerarCodigo() {
  const bytes = randomBytes(16)
  let codigo = ""
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % 4 === 0) codigo += "-"
    codigo += ALFABETO[bytes[i] & 31]
  }
  return codigo
}

/** `normalizarConviteDeRegisto`, then `hashDoConviteDeRegisto`. */
const hashDoCodigo = (codigo) =>
  createHash("sha256").update(codigo.toUpperCase().replace(/[\s-]+/g, ""), "utf8").digest("hex")

const agoraSegundo = () => Math.floor(Date.now() / 1000)
const dataDe = (segundo) => new Date(segundo * 1000).toISOString().slice(0, 16).replace("T", " ")

// ------------------------------------------------------------ the database

/** A value as SQL literal, for the remote database (sqlite3 does not take parameters from the command line). */
function literal(valor) {
  if (typeof valor === "number" && Number.isSafeInteger(valor)) return String(valor)
  if (typeof valor === "string") return `'${valor.replaceAll("'", "''")}'`
  throw new Error(`valor SQL inesperado: ${valor}`)
}

async function baseLocal(caminho) {
  // node:sqlite warns it is experimental. It does not matter here.
  process.removeAllListeners("warning")
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(caminho, { timeout: 5000 })
  return {
    consultar: (sql, parametros = []) => db.prepare(sql).all(...parametros),
    executar: (sql, parametros = []) => Number(db.prepare(sql).run(...parametros).changes),
  }
}

/** A word in single quotes for the host's shell. */
const plicas = (texto) => `'${String(texto).replaceAll("'", "'\\''")}'`

function ssh(comando, entrada) {
  const familia = ANFITRIAO.slice(ANFITRIAO.indexOf("@") + 1).includes(":") ? ["-6"] : []
  return execFileSync("ssh", [...familia, ...CHAVE, ...(CHAVE.length ? ["-o", "IdentitiesOnly=yes"] : []), "-o", "BatchMode=yes", ANFITRIAO, comando], {
    encoding: "utf8",
    input: entrada,
  })
}

/**
 * The server database, over ssh, with the host's sqlite3, the same way as
 * `denuncias.mjs`: the SQL goes in base64 through the input, and the WAL files
 * go back to the database owner afterwards, so a root `-wal` never stops the
 * server from starting.
 */
function baseRemota(caminho) {
  const devolverAoDono = [
    `dono=$(stat -c %u:%g ${plicas(caminho)})`,
    `for f in ${plicas(`${caminho}-wal`)} ${plicas(`${caminho}-shm`)} ${plicas(`${caminho}-journal`)}; do [ -e "$f" ] && chown "$dono" "$f"; done`,
    "true",
  ].join("; ")
  const correr = (sql, comJson) =>
    ssh(
      [
        "set -e",
        `trap ${plicas(devolverAoDono)} EXIT`,
        `base64 -d | sqlite3 -bail ${comJson ? "-json " : ""}-cmd '.timeout 5000' ${plicas(caminho)}`,
      ].join("\n"),
      Buffer.from(sql, "utf8").toString("base64"),
    )
  const preencher = (sql, parametros) => {
    let i = 0
    return sql.replaceAll("?", () => literal(parametros[i++]))
  }
  return {
    consultar(sql, parametros = []) {
      const saida = correr(preencher(sql, parametros), true).trim()
      return saida === "" ? [] : JSON.parse(saida)
    },
    executar(sql, parametros = []) {
      const saida = correr(`${preencher(sql, parametros)};\nSELECT changes() AS n;`, true).trim()
      return saida === "" ? 0 : Number(JSON.parse(saida)[0]?.n ?? 0)
    },
  }
}

async function ligar() {
  if (PRODUCAO) return baseRemota(`${VOLUME}/enclave.sqlite`)
  const caminho = process.env.ORWELL_BASE
  if (!caminho) throw new Recusa("falta ORWELL_BASE (o enclave.sqlite local), ou ORWELL_ALVO=producao")
  // Nothing gets created: a wrong path is an error, not an empty database.
  if (!existsSync(caminho)) throw new Recusa(`a base local não existe: ${caminho}`)
  return baseLocal(caminho)
}

// ------------------------------------------------------------ commands

function inteiroEntre(texto, nome, minimo, maximo, omissao) {
  if (texto === undefined) return omissao
  if (!/^\d+$/.test(texto)) throw new Recusa(`--${nome} tem de ser um número inteiro`)
  const valor = Number(texto)
  if (valor < minimo || valor > maximo) throw new Recusa(`--${nome} tem de estar entre ${minimo} e ${maximo}`)
  return valor
}

function criar(base, usos, dias) {
  const codigo = gerarCodigo()
  const agora = agoraSegundo()
  const expira = agora + dias * 86_400
  base.executar(
    "INSERT INTO registration_invites (code_hash, max_uses, uses, expires_second, created_second) VALUES (?, ?, 0, ?, ?)",
    [hashDoCodigo(codigo), usos, expira, agora],
  )
  console.log(`Código: ${codigo}`)
  console.log(`Deixa entrar ${usos} ${usos === 1 ? "conta nova" : "contas novas"} até ${dataDe(expira)} UTC.`)
  console.log("Guarda-o agora: o servidor só tem o hash, e este código não volta a aparecer.")
}

function listar(base) {
  const linhas = base.consultar(
    "SELECT code_hash, uses, max_uses, expires_second FROM registration_invites ORDER BY created_second",
  )
  if (linhas.length === 0) {
    console.log("Nenhum código de convite.")
    return
  }
  const agora = agoraSegundo()
  for (const linha of linhas) {
    const estado =
      linha.expires_second <= agora ? "expirado" : linha.uses >= linha.max_uses ? "gasto" : "válido"
    console.log(`${linha.code_hash.slice(0, 12)}  ${linha.uses}/${linha.max_uses}  até ${dataDe(linha.expires_second)} UTC  ${estado}`)
  }
}

function revogar(base, prefixo) {
  if (!/^[0-9a-f]{8,64}$/.test(prefixo)) throw new Recusa("o início do hash tem de ter 8 a 64 dígitos hexadecimais (minúsculas)")
  const iguais = base.consultar("SELECT code_hash FROM registration_invites WHERE substr(code_hash, 1, ?) = ?", [
    prefixo.length,
    prefixo,
  ])
  if (iguais.length === 0) throw new Recusa(`nenhum código começa por ${prefixo}`)
  if (iguais.length > 1) throw new Recusa(`${iguais.length} códigos começam por ${prefixo}: escreve mais dígitos`)
  base.executar("DELETE FROM registration_invites WHERE code_hash = ?", [iguais[0].code_hash])
  console.log(`Revogado: ${iguais[0].code_hash.slice(0, 12)}`)
}

function limpar(base) {
  const n = base.executar("DELETE FROM registration_invites WHERE expires_second <= ? OR uses >= max_uses", [agoraSegundo()])
  console.log(`Apagados: ${n}`)
}

async function principal() {
  const [subcomando, ...resto] = process.argv.slice(2)
  if (!["criar", "listar", "revogar", "limpar"].includes(subcomando)) {
    console.error(USO)
    process.exit(1)
  }
  let parsed
  try {
    parsed = parseArgs({
      args: resto,
      options: subcomando === "criar" ? { usos: { type: "string" }, dias: { type: "string" } } : {},
      allowPositionals: true,
      strict: true,
    })
  } catch (erro) {
    throw new Recusa(`${erro.message}\n\n${USO}`)
  }
  const quantos = subcomando === "revogar" ? 1 : 0
  if (parsed.positionals.length !== quantos) throw new Recusa(`"${subcomando}" leva ${quantos} argumento(s) sem nome\n\n${USO}`)

  // Arguments validate BEFORE connecting: a typo never reaches the server.
  let accao
  if (subcomando === "criar") {
    const usos = inteiroEntre(parsed.values.usos, "usos", 1, 1000, 1)
    const dias = inteiroEntre(parsed.values.dias, "dias", 1, 90, 7)
    accao = (base) => criar(base, usos, dias)
  } else if (subcomando === "listar") accao = listar
  else if (subcomando === "limpar") accao = limpar
  else {
    const prefixo = parsed.positionals[0]
    accao = (base) => revogar(base, prefixo)
  }
  if (!PRODUCAO) console.log(`Local: ${process.env.ORWELL_BASE ?? "(sem base)"}`)
  accao(await ligar())
}

try {
  await principal()
} catch (erro) {
  console.error(erro instanceof Recusa ? `Recusado: ${erro.message}` : `Erro: ${erro?.stack ?? erro}`)
  process.exit(1)
}
