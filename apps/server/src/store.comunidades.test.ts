import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * The count behind the cap on channels (communities) one account creates
 * (1.3.26): which claims count, and when a place is free again.
 */

let dataDir: string
let store: Store
let db: ReturnType<typeof openDatabase>

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-comunidades-"))
  db = openDatabase(join(dataDir, "test.sqlite"))
  store = new Store(db)
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-20T20:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

const ANA = "@ana:localhost"
const BENTO = "@bento:localhost"
const passar = (segundos: number) => vi.setSystemTime(new Date(Date.now() + segundos * 1000))

describe("comunidadesCriadasPor", () => {
  it("conta só as reclamações marcadas como comunidade, da própria conta", () => {
    store.claimChannel("!a", ANA, true)
    store.claimChannel("!b", ANA, true)
    // A direct message, the feed, the account channel: not a community.
    store.claimChannel("!directa", ANA)
    store.claimChannel("!c", BENTO, true)
    expect(store.comunidadesCriadasPor(ANA)).toBe(2)
    expect(store.comunidadesCriadasPor(BENTO)).toBe(1)
    expect(store.claimComunidade("!a")).toBe(true)
    expect(store.claimComunidade("!directa")).toBe(false)
    expect(store.claimComunidade("!nenhum")).toBeNull()
  })

  it("um canal com membros conta para sempre; um canal que todos deixaram liberta o lugar", () => {
    store.claimChannel("!a", ANA, true)
    store.subscribe("!a", ANA)
    store.subscribe("!a", BENTO)
    passar(3600)
    expect(store.comunidadesCriadasPor(ANA)).toBe(1)
    // The founder leaves; the channel still exists with Bento in it.
    store.unsubscribe("!a", ANA)
    expect(store.comunidadesCriadasPor(ANA)).toBe(1)
    // Everyone left.
    store.unsubscribe("!a", BENTO)
    expect(store.comunidadesCriadasPor(ANA)).toBe(0)
  })

  it("uma reclamação ainda sem membros conta durante a carência (o canal está a nascer), e depois não", () => {
    store.claimChannel("!a", ANA, true)
    expect(store.comunidadesCriadasPor(ANA)).toBe(1)
    passar(Store.CLAIM_GRACE_SECONDS + 1)
    expect(store.comunidadesCriadasPor(ANA)).toBe(0)
  })

  it("uma reclamação feita pelo subscribe recebe a marca quando a app diz a seguir que é comunidade", () => {
    expect(store.claimChannel("!a", ANA)).toBe(ANA)
    expect(store.claimComunidade("!a")).toBe(false)
    store.claimChannel("!a", ANA, true)
    expect(store.claimComunidade("!a")).toBe(true)
    // Another account's claim does not take the mark.
    store.claimChannel("!b", ANA)
    store.claimChannel("!b", BENTO, true)
    expect(store.claimComunidade("!b")).toBe(false)
  })

  it("marcarComunidade passa a contar um canal que uma app antiga criou", () => {
    store.claimChannel("!a", ANA)
    store.subscribe("!a", ANA)
    expect(store.comunidadesCriadasPor(ANA)).toBe(0)
    store.marcarComunidade("!a")
    expect(store.comunidadesCriadasPor(ANA)).toBe(1)
  })

  it("uma base de dados de antes da coluna abre, e as reclamações antigas nunca contam", () => {
    db.close()
    const caminho = join(dataDir, "antiga.sqlite")
    const antiga = new DatabaseSync(caminho)
    antiga.exec("CREATE TABLE channel_claims (channel TEXT PRIMARY KEY, owner TEXT NOT NULL, at_second INTEGER NOT NULL)")
    antiga.prepare("INSERT INTO channel_claims (channel, owner, at_second) VALUES (?, ?, ?)").run("!velho", ANA, Math.floor(Date.now() / 1000))
    antiga.close()
    db = openDatabase(caminho)
    store = new Store(db)
    store.subscribe("!velho", ANA)
    expect(store.claimComunidade("!velho")).toBeNull()
    expect(store.comunidadesCriadasPor(ANA)).toBe(0)
  })
})

describe("roomsCreatedBy (1.3.26)", () => {
  it("counts the rooms an account created while their channel has a member; a release frees the place", () => {
    store.subscribe("!a", ANA)
    store.countRoom("!a", "t-1", ANA)
    store.countRoom("!a", "t-2", ANA)
    // The same room again keeps its first creator.
    store.countRoom("!a", "t-2", BENTO)
    store.countRoom("!a", "t-3", BENTO)
    expect(store.roomsCreatedBy(ANA)).toBe(2)
    expect(store.roomsCreatedBy(BENTO)).toBe(1)
    expect(store.roomIsCounted("!a", "t-1")).toBe(true)
    store.releaseRoom("!a", "t-1")
    expect(store.roomsCreatedBy(ANA)).toBe(1)
    expect(store.roomIsCounted("!a", "t-1")).toBe(false)
  })

  it("a channel all members left takes its rooms with it", () => {
    store.subscribe("!a", ANA)
    store.countRoom("!a", "t-1", ANA)
    store.unsubscribe("!a", ANA)
    expect(store.roomsCreatedBy(ANA)).toBe(0)
  })
})
