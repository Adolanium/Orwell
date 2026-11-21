import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "./app.js"
import { RelogioDoArranque } from "./arranque.js"
import { loadConfig } from "./config.js"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * A fast start (1.3.26).
 *
 * The 1.3.25 deploy took 1 min 45 s to open the port, with a 1.6 GB database, and
 * the edge answered 502 the whole time. Measured on a copy of that database: 97 %
 * of it was `pruneSupersededWelcomes`, a correlated subquery that walked a whole
 * channel, ciphertext included, once per stored Welcome. The same query ran every
 * hour on the event loop. The rest was `inicializarEpochs` scanning every event
 * for the handful of handshakes.
 *
 * These tests hold the fix in place: the two partial indexes exist (also on a
 * database from before them), the startup queries use them instead of scanning
 * `events`, the prune still keeps exactly what it kept, and the startup prints one
 * timing line per phase, with numbers and nothing else.
 */

let pasta: string
let caminho: string

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "enclave-arranque-"))
  caminho = join(pasta, "enclave.sqlite")
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(pasta, { recursive: true, force: true })
})

/** The `events` table as every version up to 1.3.25 created it, without the new indexes. */
const EVENTS_1_3_25 = `
  CREATE TABLE events (
    channel            TEXT NOT NULL,
    seq                INTEGER NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('application','handshake','welcome')),
    ciphertext         BLOB NOT NULL,
    recipient          TEXT,
    received_minute    INTEGER NOT NULL,
    PRIMARY KEY (channel, seq)
  );
  CREATE INDEX events_by_age ON events (received_minute);
`

function plano(db: DatabaseSync, sql: string, ...args: (string | number)[]): string[] {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((linha) => linha.detail)
}

/**
 * A walk over every row of `events`, by the table or by its primary key: the thing
 * that cost the 1 min 45 s. Walking one of the two partial indexes is fine: they
 * hold only the Welcomes or only the handshakes.
 */
function varreTudo(detalhes: string[]): boolean {
  return detalhes.some((detalhe) => /^SCAN events\b/.test(detalhe) && !/events_(welcomes|handshakes)/.test(detalhe))
}

describe("os índices parciais de events", () => {
  it("aparecem ao abrir uma base de antes deles, e as linhas ficam", () => {
    const antiga = new DatabaseSync(caminho)
    antiga.exec(EVENTS_1_3_25)
    antiga.exec(
      "INSERT INTO events VALUES ('!a:x', 0, 'handshake', x'00', NULL, 1), ('!a:x', 1, 'welcome', x'01', '@ana:x', 1), ('!a:x', 2, 'application', x'02', NULL, 1)",
    )
    antiga.close()

    const db = openDatabase(caminho)
    const indices = (db.prepare("PRAGMA index_list(events)").all() as { name: string; partial: number }[])
      .filter((indice) => indice.partial === 1)
      .map((indice) => indice.name)
    expect(indices).toEqual(expect.arrayContaining(["events_welcomes", "events_handshakes"]))
    expect((db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(3)
    expect(new Store(db).pendingWelcomes("@ana:x", 10)).toHaveLength(1)
    db.close()
    // Idempotent.
    openDatabase(caminho).close()
  })

  it("as consultas do arranque e do login não varrem events", () => {
    const db = openDatabase(caminho)
    // The one inicializarEpochs runs.
    expect(
      varreTudo(
        plano(
          db,
          `SELECT channel, ciphertext FROM events
            WHERE kind = 'handshake' AND channel NOT IN (SELECT channel FROM channel_epochs)
            ORDER BY channel, seq`,
        ),
      ),
    ).toBe(false)
    // The one every login runs (pendingWelcomes).
    const welcomes = plano(
      db,
      `SELECT channel, seq, kind, ciphertext, recipient, received_minute FROM events
        WHERE recipient = ? AND kind = 'welcome' ORDER BY channel ASC, seq DESC LIMIT ?`,
      "@ana:x",
      10,
    )
    expect(varreTudo(welcomes)).toBe(false)
    expect(welcomes.join(" ")).toContain("events_welcomes")
    // The prune, read from the store itself so the test follows the real query.
    const poda = plano(db, Store.SQL_DOS_WELCOMES_A_PODAR)
    expect(varreTudo(poda)).toBe(false)
    expect(poda.join(" ")).toContain("events_welcomes")
    // The seq floor, every minute from the retention sweep: by age, not by channel.
    const piso = plano(db, Store.SQL_DO_PISO_DO_SEQ, 0, 0)
    expect(varreTudo(piso)).toBe(false)
    expect(piso.join(" ")).toContain("events_by_age")
    db.close()
  })
})

describe("o piso do seq pela consulta nova", () => {
  it("só o canal que a retenção esvazia ganha piso, e o piso só sobe", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"))
    const db = openDatabase(caminho)
    const store = new Store(db)
    const anexar = (channel: string): number =>
      (store.appendEvent({ channel, kind: "application", ciphertext: new Uint8Array([1]) }, { refundavel: false }) as {
        event: { seq: number }
      }).event.seq
    for (let i = 0; i < 3; i++) anexar("!velho:x")
    anexar("!misto:x")
    vi.setSystemTime(new Date("2026-11-15T00:00:00Z"))
    anexar("!misto:x")

    // Thirty days: the old channel loses everything, the mixed one keeps its newest.
    expect(store.expireEvents(30)).toBe(4)
    const pisos = db.prepare("SELECT channel, seq_floor FROM channel_activity ORDER BY channel").all() as {
      channel: string
      seq_floor: number | null
    }[]
    expect(pisos).toEqual([
      { channel: "!misto:x", seq_floor: null },
      { channel: "!velho:x", seq_floor: Store.SEQ_FLOOR_STEP },
    ])
    expect(anexar("!velho:x")).toBe(Store.SEQ_FLOOR_STEP)
    expect(anexar("!misto:x")).toBe(2)
    db.close()
  })
})

describe("pruneSupersededWelcomes", () => {
  it("guarda os cinco mais recentes por pessoa e canal, e não toca no resto", () => {
    const db = openDatabase(caminho)
    const store = new Store(db)
    const welcome = (channel: string, recipient: string, byte: number): number =>
      (store.appendEvent({ channel, kind: "welcome", ciphertext: new Uint8Array([byte]), recipient }, { refundavel: false }) as {
        event: { seq: number }
      }).event.seq
    const app = (channel: string): void => {
      store.appendEvent({ channel, kind: "application", ciphertext: new Uint8Array([7]) }, { refundavel: false })
    }

    // Seven for Ana in one channel, mixed with traffic: the two oldest go.
    const daAna: number[] = []
    for (let i = 0; i < 7; i++) {
      daAna.push(welcome("!a:x", "@ana:x", i))
      app("!a:x")
    }
    // Two for Ana in another channel, and seven for Rui in the first: counted apart.
    welcome("!b:x", "@ana:x", 20)
    welcome("!b:x", "@ana:x", 21)
    for (let i = 0; i < 7; i++) welcome("!a:x", "@rui:x", 30 + i)

    expect(store.pruneSupersededWelcomes()).toBe(4)

    const ficaram = store.pendingWelcomes("@ana:x", 100)
    expect(ficaram.filter((e) => e.channel === "!a:x").map((e) => e.seq)).toEqual(daAna.slice(2).reverse())
    expect(ficaram.filter((e) => e.channel === "!b:x")).toHaveLength(2)
    expect(store.pendingWelcomes("@rui:x", 100)).toHaveLength(5)
    expect((db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'application'").get() as { n: number }).n).toBe(7)
    // A second pass has nothing left to do.
    expect(store.pruneSupersededWelcomes()).toBe(0)
    db.close()
  })
})

describe("o relógio do arranque", () => {
  it("escreve uma linha por fase, só com o nome e os milissegundos", () => {
    const linhas: string[] = []
    let agora = 1000
    const relogio = new RelogioDoArranque((linha) => linhas.push(linha), () => agora)
    const valor = relogio.fase("epochs", () => {
      agora += 42
      return 7
    })
    expect(valor).toBe(7)
    relogio.fase("welcomes", () => {
      agora += 3
    })
    relogio.pronto()
    expect(linhas).toEqual([
      "enclave: arranque: epochs 42 ms",
      "enclave: arranque: welcomes 3 ms",
      "enclave: arranque: pronto 45 ms",
    ])
  })

  it("mede a fase mesmo quando ela falha, e deixa passar o erro", () => {
    const linhas: string[] = []
    const relogio = new RelogioDoArranque((linha) => linhas.push(linha), () => 0)
    expect(() =>
      relogio.fase("migracoes", () => {
        throw new Error("x")
      }),
    ).toThrow("x")
    expect(linhas).toEqual(["enclave: arranque: migracoes 0 ms (falhou)"])
  })

  it("buildServer passa por todas as fases do caminho crítico, e sem relógio fica calado", async () => {
    const linhas: string[] = []
    const config = loadConfig({ ENCLAVE_DATA_DIR: pasta, ENCLAVE_DB_PATH: caminho, ENCLAVE_CAMPANHA_GOFUNDME: "" })
    const enclave = await buildServer(config, { relogio: new RelogioDoArranque((linha) => linhas.push(linha)) })
    await enclave.close()
    const fases = linhas.map((linha) => /^enclave: arranque: (\S+) \d+ ms$/.exec(linha)?.[1])
    expect(fases).toEqual([
      "abrir-base",
      "esquema",
      "migracoes",
      "epochs",
      "chave-do-servidor",
      "http",
      "welcomes",
      "cofres",
    ])

    // Tests build servers by the hundred: with no clock, nothing is written.
    const escrita = vi.spyOn(process.stderr, "write")
    const calado = await buildServer(config)
    await calado.close()
    expect(escrita.mock.calls.some(([texto]) => String(texto).includes("arranque:"))).toBe(false)
    escrita.mockRestore()
  })
})
