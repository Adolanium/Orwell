import { servirSelo, type EscopoDoSelo } from "@enclave/client-core/selo-worker"

/**
 * The worker where the vault seal runs, in the web app.
 *
 * The cipher and the base64 of each batched vault write, off the page thread.
 * All the logic is in `@enclave/client-core/selo-worker`; this file only gives
 * the bundler a Worker entry, and imports only the seal, not the session.
 */
servirSelo(self as unknown as EscopoDoSelo)
