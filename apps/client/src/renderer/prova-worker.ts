import { servirProvaDeTrabalho, type EscopoDaProva } from "@enclave/client-core/prova-worker"

/**
 * The worker where a new account's proof of work runs, in the desktop app's window (1.3.26).
 *
 * Twin of `apps/web/src/prova-worker.ts`. The search is all in
 * `@enclave/client-core/prova-worker`; what the host brings is the file the
 * bundler turns into a worker. Imported from the subpath, not the package
 * root: the worker needs the hash, not the session or the vault.
 */
servirProvaDeTrabalho(self as unknown as EscopoDaProva)
