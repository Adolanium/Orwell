import type { load } from "koffi"

interface TecladoDoWindows {
  premida: (tecla: number) => boolean
  mapearCaractere: (caractere: string) => number
}

const MODIFICADORES = [
  { nome: "Shift", tecla: 0x10 },
  { nome: "Mod", tecla: 0x11 },
  { nome: "Alt", tecla: 0x12 },
]
const TECLAS_COM_NOME = new Map([
  ["Space", 0x20], ["PageUp", 0x21], ["PageDown", 0x22], ["End", 0x23], ["Home", 0x24],
  ["ArrowLeft", 0x25], ["ArrowUp", 0x26], ["ArrowRight", 0x27], ["ArrowDown", 0x28],
  ["PrintScreen", 0x2c], ["Insert", 0x2d], ["NumLock", 0x90], ["ScrollLock", 0x91],
  ["Mouse4", 0x05], ["Mouse5", 0x06], ["Pause", 0x13],
  ["AudioVolumeMute", 0xad], ["AudioVolumeDown", 0xae], ["AudioVolumeUp", 0xaf],
  ["MediaTrackNext", 0xb0], ["MediaTrackPrevious", 0xb1], ["MediaStop", 0xb2], ["MediaPlayPause", 0xb3],
])

function lerCombinacao(combinacao: string, teclado: TecladoDoWindows): (() => {
  teclaPremida: boolean
  combinacaoPremida: boolean
}) | null {
  const partes = combinacao.split("+")
  const tecla = partes.pop()
  if (!tecla || partes.some((parte) => !MODIFICADORES.some(({ nome }) => nome === parte))) return null
  if (new Set(partes).size !== partes.length) return null

  const funcao = /^F([1-9]|1[0-9]|2[0-4])$/.exec(tecla)
  const codigo = TECLAS_COM_NOME.get(tecla) ?? (
    funcao ? 0x6f + Number(funcao[1]) :
      /^[A-Z0-9]$/.test(tecla) ? tecla.charCodeAt(0) :
        tecla.length === 1 ? teclado.mapearCaractere(tecla) : -1
  )
  if (codigo <= 0 || codigo > 0xfe) return null

  return () => {
    const teclaPremida = teclado.premida(codigo) ||
      (codigo >= 0x30 && codigo <= 0x39 && teclado.premida(codigo + 0x30))
    return {
      teclaPremida,
      combinacaoPremida: teclaPremida &&
        MODIFICADORES.every(({ nome, tecla }) => teclado.premida(tecla) === partes.includes(nome)),
    }
  }
}

export interface VigiaDaFala {
  reler: () => void
  parar: () => void
}

/**
 * The focused renderer owns its own shortcut, including the rule for text fields.
 * Outside Orwell, sample only the bound key and its modifiers. Never reserve the
 * key or send keyboard input to the renderer. A key already held on focus change,
 * resume or rebind needs a fresh press before it can open the microphone.
 */
export function vigiarFalaNoFundo(
  combinacao: string,
  teclado: TecladoDoWindows,
  permitido: () => boolean,
  aoMudar: (premida: boolean) => void,
): VigiaDaFala | null {
  const ler = lerCombinacao(combinacao, teclado)
  if (!ler) return null

  let disponivel = false
  let teclaAnterior = false
  let aFalar = false
  const emitir = (premida: boolean): void => {
    if (premida === aFalar) return
    aFalar = premida
    aoMudar(premida)
  }
  const reler = (): void => {
    if (!permitido()) {
      disponivel = false
      emitir(false)
      return
    }
    const { teclaPremida, combinacaoPremida } = ler()
    const novaPressao = disponivel && teclaPremida && !teclaAnterior
    teclaAnterior = teclaPremida
    disponivel = true
    emitir(combinacaoPremida && (aFalar || novaPressao))
  }

  reler()
  const relogio = setInterval(reler, 16)
  relogio.unref()
  return {
    reler,
    parar: () => {
      clearInterval(relogio)
      emitir(false)
    },
  }
}

/** Load the optional native binding only in the Windows main process. */
export function abrirTecladoDoWindows(): TecladoDoWindows | null {
  try {
    const koffi: { load: typeof load } = require("koffi")
    const user32 = koffi.load("user32.dll")
    const getAsyncKeyState: (tecla: number) => number = user32.func("int16 __stdcall GetAsyncKeyState(int)")
    const getForegroundWindow: () => bigint | null = user32.func("void * __stdcall GetForegroundWindow()")
    const getWindowThreadProcessId: (janela: bigint, processo: null) => number =
      user32.func("uint32 __stdcall GetWindowThreadProcessId(void *, void *)")
    const getKeyboardLayout: (thread: number) => bigint = user32.func("void * __stdcall GetKeyboardLayout(uint32)")
    const vkKeyScanExW: (caractere: number, teclado: bigint) => number =
      user32.func("int16 __stdcall VkKeyScanExW(uint16, void *)")
    return {
      // The low bit records an earlier press and is shared with other apps.
      premida: (tecla) => (getAsyncKeyState(tecla) & 0x8000) !== 0,
      mapearCaractere: (caractere) => {
        const janela = getForegroundWindow()
        const layout = getKeyboardLayout(janela === null ? 0 : getWindowThreadProcessId(janela, null))
        const mapeada = vkKeyScanExW(caractere.charCodeAt(0), layout)
        return mapeada === -1 ? -1 : mapeada & 0xff
      },
    }
  } catch {
    return null
  }
}
