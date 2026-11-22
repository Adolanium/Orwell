#!/usr/bin/env node
/**
 * Retention for the deploy backups on the VPS (`pre-*`, step 1 of
 * `docs/DEPLOY-WEB.md`). Run it on the machine that publishes, after each
 * deploy, once the new backup has been brought down and its sums compared.
 *
 * Usage:
 *   ORWELL_BACKUPS=<backups>/orwell node scripts/prune-deploy-backups.mjs            # dry run
 *   ORWELL_BACKUPS=<backups>/orwell ORWELL_ALVO=producao \
 *     node scripts/prune-deploy-backups.mjs --apply                                  # deletes
 *
 * Options:
 *   --keep N             how many of the most recent backups stay on the VPS (default 3, minimum 1)
 *   --local <dir>        the local copies, one folder per backup with the same name (or ORWELL_BACKUPS)
 *   --remote-root <dir>  where the `pre-*` folders live on the VPS; repeatable
 *                        (default /root/backups and /root/backups/orwell)
 *   --apply              really delete; without it nothing is touched
 *
 * **Why.** Each backup is the database plus a copy of /opt/enclave, close to 2 GB
 * and growing. On 22/11/2026 fourteen of them had filled the VPS disk to 91 %.
 *
 * **What it keeps.** The `--keep` most recent, by the timestamp in the folder name
 * (`pre-<what>-YYYYMMDD_HHMMSS`, or an older `pre-<what>-YYYYMMDD`). A folder whose
 * name has no date is never deleted: it is listed, and a person decides.
 *
 * **What it requires before deleting one.** All of these, or that backup stays:
 *   1. `<local>/<name>/SHA256SUMS` exists and lists `enclave.sqlite` and `server.key.json`;
 *   2. every file listed there matches its SHA-256 on this machine (same as `shasum -a 256 -c`);
 *   3. the VPS `SHA256SUMS` of that backup is byte for byte the local one, so the local
 *      copy is a copy of THAT backup, and not another one with the same name.
 *
 * **Where.** Only the VPS, through `ssh root@72.60.44.47` with the named key
 * (`ORWELL_SSH` and `ORWELL_SSH_KEY` change the host and the key, as in
 * `denuncias.mjs`). Listing is read only. Deleting needs `--apply` AND
 * `ORWELL_ALVO=producao`: two separate decisions, never a default.
 *
 * Never touches the live database, the volumes, the containers or the nightly
 * backups (`/var/backups/...`): only `pre-*` folders directly under the remote roots.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

const HOST = process.env.ORWELL_SSH ?? "root@72.60.44.47"
const KEY = process.env.ORWELL_SSH_KEY ?? `${process.env.HOME}/.ssh/orwell_vps`
const DEFAULT_ROOTS = ["/root/backups", "/root/backups/orwell"]
const REQUIRED_IN_SUMS = ["enclave.sqlite", "server.key.json"]
const SAFE_NAME = /^pre-[A-Za-z0-9._-]+$/
const SAFE_ROOT = /^\/[A-Za-z0-9._\/-]+$/

class Refusal extends Error {}

function ssh(command) {
  const family = HOST.slice(HOST.indexOf("@") + 1).includes(":") ? ["-6"] : ["-4"]
  return execFileSync(
    "ssh",
    [...family, "-i", KEY, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, command],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
}

/** Single quotes for the remote shell. Names are already checked against SAFE_NAME. */
function quote(text) {
  return `'${text.replaceAll("'", `'\\''`)}'`
}

/** The timestamp in the name, as a sortable string, or null. */
function stampOf(name) {
  const full = name.match(/(\d{8})[_-](\d{6})$/)
  if (full) return `${full[1]}${full[2]}`
  const day = name.match(/(\d{8})$/)
  if (day) return `${day[1]}000000`
  return null
}

function parseSums(text) {
  const entries = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/)
    if (!m) throw new Refusal(`unreadable line in SHA256SUMS: ${line}`)
    if (m[2].includes("/") || m[2].includes("..")) throw new Refusal(`path outside the folder in SHA256SUMS: ${m[2]}`)
    entries.push({ hash: m[1], file: m[2] })
  }
  return entries
}

function sha256File(path) {
  return new Promise((ok, fail) => {
    const hash = createHash("sha256")
    createReadStream(path)
      .on("error", fail)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => ok(hash.digest("hex")))
  })
}

/** Returns null when the local copy is good, or the reason it is not. */
async function checkLocalCopy(localRoot, name, remoteSums) {
  const dir = join(localRoot, name)
  const sumsPath = join(dir, "SHA256SUMS")
  if (!existsSync(dir)) return "no local copy"
  if (!existsSync(sumsPath)) return "local copy has no SHA256SUMS"
  const localSums = readFileSync(sumsPath, "utf8")
  if (localSums !== remoteSums) return "local SHA256SUMS differs from the one on the VPS"
  let entries
  try {
    entries = parseSums(localSums)
  } catch (error) {
    return error.message
  }
  for (const required of REQUIRED_IN_SUMS) {
    if (!entries.some((e) => e.file === required)) return `SHA256SUMS does not list ${required}`
  }
  for (const { hash, file } of entries) {
    const path = join(dir, file)
    if (!existsSync(path) || !statSync(path).isFile()) return `missing locally: ${file}`
    const actual = await sha256File(path)
    if (actual !== hash) return `sum FAILED: ${file}`
  }
  return null
}

function listRemote(roots) {
  const found = []
  for (const root of roots) {
    const out = ssh(`[ -d ${quote(root)} ] && find ${quote(root)} -mindepth 1 -maxdepth 1 -type d -name 'pre-*' -printf '%f\\n' || true`)
    for (const name of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
      found.push({ root, name, path: `${root}/${name}`, stamp: stampOf(name) })
    }
  }
  return found
}

async function main() {
  const { values } = parseArgs({
    options: {
      keep: { type: "string", default: "3" },
      local: { type: "string" },
      "remote-root": { type: "string", multiple: true },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  if (values.help) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0])
    return
  }

  const keep = Number.parseInt(values.keep, 10)
  if (!Number.isInteger(keep) || keep < 1) throw new Refusal("--keep must be a whole number, 1 or more")
  const localRoot = values.local ?? process.env.ORWELL_BACKUPS
  if (!localRoot) throw new Refusal("missing --local or ORWELL_BACKUPS (the folder with the local copies)")
  if (!existsSync(localRoot)) throw new Refusal(`local folder does not exist: ${localRoot}`)
  const roots = values["remote-root"] ?? DEFAULT_ROOTS
  for (const root of roots) {
    if (!SAFE_ROOT.test(root) || root.includes("..") || root === "/") throw new Refusal(`unsafe remote root: ${root}`)
  }
  if (values.apply && process.env.ORWELL_ALVO !== "producao") {
    throw new Refusal("--apply deletes on the VPS: it also needs ORWELL_ALVO=producao")
  }

  const all = listRemote(roots)
  const dated = all.filter((b) => b.stamp).sort((a, b) => b.stamp.localeCompare(a.stamp) || b.name.localeCompare(a.name))
  const undated = all.filter((b) => !b.stamp)
  const kept = dated.slice(0, keep)
  const candidates = dated.slice(keep)

  console.log(`${values.apply ? "APPLY" : "DRY RUN"} on ${HOST}; local copies in ${resolve(localRoot)}`)
  console.log(`\nKept (the ${keep} most recent):`)
  for (const b of kept) console.log(`  ${b.path}`)
  if (undated.length) {
    console.log("\nKept, no date in the name (a person decides):")
    for (const b of undated) console.log(`  ${b.path}`)
  }

  const deleted = []
  const refused = []
  const wouldDelete = []
  for (const b of candidates) {
    if (!SAFE_NAME.test(b.name)) {
      refused.push({ ...b, reason: "unsafe name" })
      continue
    }
    let remoteSums
    try {
      remoteSums = ssh(`cat ${quote(`${b.path}/SHA256SUMS`)}`)
    } catch {
      refused.push({ ...b, reason: "no SHA256SUMS on the VPS" })
      continue
    }
    const reason = await checkLocalCopy(localRoot, b.name, remoteSums)
    if (reason) {
      refused.push({ ...b, reason })
      continue
    }
    if (!values.apply) {
      wouldDelete.push(b)
      continue
    }
    ssh(`rm -rf -- ${quote(b.path)} && [ ! -e ${quote(b.path)} ]`)
    deleted.push(b)
  }

  if (!values.apply) {
    console.log("\nWould delete (local copy verified):")
    for (const b of wouldDelete) console.log(`  ${b.path}`)
  } else {
    console.log("\nDeleted (local copy verified first):")
    for (const b of deleted) console.log(`  ${b.path}`)
  }
  if (refused.length) {
    console.log("\nNOT deleted, kept on the VPS:")
    for (const b of refused) console.log(`  ${b.path}  (${b.reason})`)
  }
  if (!values.apply && wouldDelete.length) console.log("\nNothing was deleted. Run again with --apply and ORWELL_ALVO=producao.")
  if (refused.length) process.exitCode = 2
}

main().catch((error) => {
  if (error instanceof Refusal) {
    console.error(`refused: ${error.message}`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})
