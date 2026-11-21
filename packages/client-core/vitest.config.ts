import { defineConfig } from "vitest/config"

/**
 * The core runs on vitest defaults, with one exception: the vault's KDF.
 *
 * `testes/kdf-de-teste.ts` swaps Argon2id for cheap derivation that keeps all
 * the properties tests measure and drops the only one none of them measure, the
 * cost. The why, and what we lose, are written inside.
 */
export default defineConfig({
  test: {
    setupFiles: ["./testes/kdf-de-teste.ts"],
    /*
      Measured on 20/11/2026, one suite alone on a 14-core machine, without the
      `.rede` batteries: the sum of the test times was the same with 4 workers and
      with 8 (594 s and 584 s), and the suite went from 168 s to 102 s. The time
      is spent on the clock (turns, retries, deadlines), not on the CPU. A share
      of the cores and not a number, and fewer than vitest's own default (every
      core but one). A `.rede` battery still runs alone, one file at a time.
    */
    maxWorkers: "60%",
  },
})
