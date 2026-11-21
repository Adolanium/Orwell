/**
 * A refusal by the operating system, read by the host before a capture.
 *
 * Its own file because two sides of the core throw and read it: the call
 * (`call.ts`) and the voice chain (`audio/controlo.ts`), and the second one
 * cannot import the first.
 */

/** The device the operating system refuses to the app. See `permissaoDoSistema`. */
export type DispositivoRecusado = "microfone" | "camara"

/**
 * The error keys of a refusal by the system, one for each device.
 *
 * Different from "the browser or the system did not allow this" on purpose:
 * that one is a `NotAllowedError` from the engine, and its remedy is in the
 * browser. This one comes from the host, which read the system state, and its
 * remedy is one panel in System Settings that the phrase names.
 */
export const CHAVES_DA_RECUSA_DO_SISTEMA: Readonly<Record<DispositivoRecusado, string>> = {
  microfone: "the system does not allow the microphone",
  camara: "the system does not allow the camera",
}

/** The capture did not start because the system refuses a device. */
export class RecusaDoSistema extends Error {
  readonly dispositivo: DispositivoRecusado

  constructor(dispositivo: DispositivoRecusado) {
    super(CHAVES_DA_RECUSA_DO_SISTEMA[dispositivo])
    this.name = "RecusaDoSistema"
    this.dispositivo = dispositivo
  }
}
