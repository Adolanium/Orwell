/**
 * The macOS permission for the microphone and the camera, asked before a call.
 *
 * **Why this exists (1.3.26).** macOS keeps its own permission for each device
 * (TCC), outside the app. When TCC refuses, Chromium's `getUserMedia` does NOT
 * fail: it gives a live track that carries only silence. The call starts, the
 * light is on, and nobody hears the person. Nothing on the screen says why.
 *
 * That is what an Intel Mac saw with the 1.3.25 universal app: its x86_64 slice
 * had no code signature at all, and `tccd` refuses an unsigned app without
 * asking ("Policy disallows prompt"). The build now signs ad hoc
 * (`electron-builder.yml`), and with a signature macOS asks. This file is the
 * second half: it asks before the capture, and when the answer is no, the call
 * says so with a phrase and a button to the right panel, instead of silence.
 *
 * Nothing here imports `electron`, like `ecra.ts`: ports come as parameters,
 * `index.ts` wires them to `systemPreferences` and `shell`, and the bench
 * (`testes/bancada-ipc.ts`) wires them to fakes.
 */
import type { EstadoDaPermissao } from "./ecra.js"

/** The IPC channels, shared by `index.ts`, the `preload` and the bench. */
export const CANAIS_DA_PERMISSAO_DE_MEDIA = {
  pedir: "permissao-de-media:pedir",
  abrirDefinicoes: "permissao-de-media:abrir-definicoes",
} as const

/** A device as the core names it. See `DispositivoRecusado` in `@enclave/client-core`. */
export type DispositivoDeMedia = "microfone" | "camara"

/** The name `systemPreferences` uses for each device. */
type TipoDoSistema = "microphone" | "camera"

const TIPO_DO_SISTEMA: Readonly<Record<DispositivoDeMedia, TipoDoSistema>> = {
  microfone: "microphone",
  camara: "camera",
}

/**
 * The System Settings panel for each device. Constants, like
 * `DEFINICOES_DE_GRAVACAO_DE_ECRA`: the renderer names a device, never an address.
 */
export const DEFINICOES_DE_PRIVACIDADE: Readonly<Record<DispositivoDeMedia, string>> = {
  microfone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  camara: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
}

/**
 * How long to wait for the person to answer the system dialog.
 *
 * Long, because a person reads the dialog. Not forever, because an app without
 * a valid signature gets an `askForMediaAccess` that never resolves (measured
 * on macOS 26.5 with an unsigned x86_64 Electron 43): the call must not hang
 * on it. When the time ends, the capture goes on as before.
 */
export const PRAZO_DO_PEDIDO_MS = 60_000

export interface PortasDaPermissaoDeMedia {
  plataforma: string
  /** `systemPreferences.getMediaAccessStatus`. */
  ler: (tipo: TipoDoSistema) => EstadoDaPermissao
  /** `systemPreferences.askForMediaAccess`: opens the system dialog if TCC has no answer yet. */
  pedir: (tipo: TipoDoSistema) => Promise<boolean>
  /** `shell.openExternal`, only ever with an address from `DEFINICOES_DE_PRIVACIDADE`. */
  abrir: (endereco: string) => Promise<void>
  prazoMs?: number
}

export interface PermissaoDeMedia {
  /** Ask for the microphone, and the camera when `video`. Answers the device the system refuses. */
  pedir: (video: unknown) => Promise<{ recusado: DispositivoDeMedia | null }>
  /** Open the System Settings panel of one device. macOS only. */
  abrirDefinicoes: (dispositivo: unknown) => Promise<{ ok: boolean }>
}

export function criarPermissaoDeMedia(portas: PortasDaPermissaoDeMedia): PermissaoDeMedia {
  const prazoMs = portas.prazoMs ?? PRAZO_DO_PEDIDO_MS
  const noMac = portas.plataforma === "darwin"

  /**
   * One system question per device for the life of the process.
   *
   * Several captures can ask together while the state is `not-determined`: the
   * preview of the voice chain and the entry into a call, two windows, a double
   * click. Each `askForMediaAccess` is its own request to `tccd`. So the first
   * question is kept, and every later one waits for its answer instead of
   * asking again.
   *
   * Kept after it settles too, not only while in flight. A state still
   * `not-determined` after the person answered means TCC cannot hold the answer
   * for this build: measured on 20/11/2026 with the 1.3.25 bundle (only the
   * linker's ad hoc signature, `codesign --verify` fails), `tccd` stores each
   * "Allow" and then fails `SecStaticCodeCheckValidity` against it ("Failed to
   * match existing code requirement"), so every new capture opened ANOTHER
   * dialog. Asking again there only adds dialogs. A state the system does know
   * (`granted`, `denied`) is read first and always wins over the kept answer,
   * so turning the device on or off in System Settings still counts.
   */
  const perguntas = new Map<DispositivoDeMedia, Promise<boolean>>()

  /** `true` granted or no answer in time; `false` refused. */
  async function concede(dispositivo: DispositivoDeMedia): Promise<boolean> {
    const tipo = TIPO_DO_SISTEMA[dispositivo]
    const estado = portas.ler(tipo)
    if (estado === "denied" || estado === "restricted") return false
    // `granted`, and `unknown` (no gate to read): the capture decides.
    if (estado !== "not-determined") return true
    let pergunta = perguntas.get(dispositivo)
    if (!pergunta) {
      pergunta = perguntar(tipo)
      perguntas.set(dispositivo, pergunta)
    }
    return pergunta
  }

  /** The system dialog, with a time limit. Never rejects. */
  async function perguntar(tipo: TipoDoSistema): Promise<boolean> {
    let prazo: ReturnType<typeof setTimeout> | undefined
    const resposta = await Promise.race([
      portas.pedir(tipo).catch(() => true),
      new Promise<true>((resolver) => {
        prazo = setTimeout(() => resolver(true), prazoMs)
      }),
    ])
    clearTimeout(prazo)
    return resposta
  }

  return {
    async pedir(video) {
      // Windows and Linux have no gate the app can ask: the capture decides, as before.
      if (!noMac) return { recusado: null }
      // In order: the microphone first, because a call without voice is no call.
      if (!(await concede("microfone"))) return { recusado: "microfone" }
      if (video === true && !(await concede("camara"))) return { recusado: "camara" }
      return { recusado: null }
    },
    async abrirDefinicoes(dispositivo) {
      if (!noMac) return { ok: false }
      if (dispositivo !== "microfone" && dispositivo !== "camara") return { ok: false }
      await portas.abrir(DEFINICOES_DE_PRIVACIDADE[dispositivo])
      return { ok: true }
    },
  }
}
