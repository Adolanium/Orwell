import { servirMiniaturas, type EscopoDasMiniaturas } from "./miniaturista.js"

/**
 * The worker where thumbnails are made, in the web app (design §3). Like
 * `cifra-worker.ts`: the logic lives in `miniaturista.ts`, and this file only
 * exists so the bundler has something to build a worker from.
 */
servirMiniaturas(self as unknown as EscopoDasMiniaturas)
