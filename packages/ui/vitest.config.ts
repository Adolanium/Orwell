import { defineConfig } from "vitest/config"

// The UI is React, so tests need a DOM and the automatic JSX runtime — the
// other packages run on vitest's node defaults and need no config at all.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    /*
      Threads, not the default forks, and more of them. Measured on 20/11/2026,
      452 files, one suite alone on a 14-core machine: forks with 4 workers 90 s,
      threads with 4 workers 80 s, threads with 8 workers 43 s. Most of a file's
      cost here is starting it (jsdom, the language setup, importing the core),
      not the test itself, so the suite scales with workers. A share of the cores
      and not a number, so a smaller machine is not oversubscribed. A
      `--maxWorkers` on the command line still wins over this.
    */
    pool: "threads",
    maxWorkers: "60%",
    // Portuguese for the assertions, asked for and not inherited: see inside.
    setupFiles: ["./src/testes/lingua-de-teste.ts"],
  },
})
