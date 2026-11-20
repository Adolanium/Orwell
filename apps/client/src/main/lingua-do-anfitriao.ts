/**
 * The language of the main process, and the words it shows itself.
 *
 * This process does not load the UI catalog: it opens windows, the tray and a
 * few dialogs before (or beside) any page. Its words live here, in both
 * languages, English first.
 *
 * Which language: the one the page last showed (`lingua.json`, reported by
 * `lingua:definir`), and before any page, the system by the same rule as the
 * interface (`linguaDoSistema` in `escolha-da-lingua.ts`): Portuguese only when
 * the first system language is Portuguese, English for everything else.
 *
 * No `electron` here, so the rule and the words are measured in a test.
 */
import { linguaDoSistema } from "../../../../packages/ui/src/escolha-da-lingua.js"

export type LinguaDoAnfitriao = "pt" | "en"

/** The language for this process: what the page said last, else the system. */
export function linguaDoAnfitriao(guardada: string | null, sistema: readonly string[]): LinguaDoAnfitriao {
  if (guardada === "pt" || guardada === "en") return guardada
  return linguaDoSistema(sistema)
}

/** The system languages, most preferred first, from what Electron offers. */
export function linguasDoSistemaElectron(app: {
  getPreferredSystemLanguages?: () => string[]
  getLocale: () => string
}): string[] {
  try {
    const lista = app.getPreferredSystemLanguages?.() ?? []
    if (lista.length > 0) return lista
  } catch {
    // Older Electron, or a system that does not answer: the locale below.
  }
  try {
    const locale = app.getLocale()
    return locale ? [locale] : []
  } catch {
    return []
  }
}

/** The words of this process, in short active sentences (STE100). */
export interface TextosDoAnfitriao {
  arranque: {
    aProcurar: string
    aDescarregar: (versao: string) => string
    recebidos: (recebidos: string, total: string) => string
    aPedirAutorizacao: (versao: string) => string
    carregaEmSim: string
    aInstalar: (versao: string) => string
    abreDeNovo: string
  }
  bandeja: {
    porLer: (n: number) => string
    abrir: string
    arrancarComOSistema: string
    sair: string
  }
  sairComPendentes: {
    sairNaMesma: string
    ficar: string
    mensagem: string
    detalhe: string
  }
}

const EN: TextosDoAnfitriao = {
  arranque: {
    aProcurar: "Looking for updates",
    aDescarregar: (versao) => `Downloading version ${versao}`,
    recebidos: (recebidos, total) => `${recebidos} of ${total}`,
    aPedirAutorizacao: (versao) => `Windows will ask for permission to install version ${versao}.`,
    carregaEmSim: 'Click "Yes" to continue.',
    aInstalar: (versao) => `Installing version ${versao}`,
    abreDeNovo: "The app opens again when it finishes.",
  },
  bandeja: {
    porLer: (n) => `Orwell (${n} unread)`,
    abrir: "Open Orwell",
    arrancarComOSistema: "Start with the system",
    sair: "Quit",
  },
  sairComPendentes: {
    sairNaMesma: "Quit anyway",
    ficar: "Stay",
    mensagem: "Some messages are not sent yet. Quit anyway?",
    detalhe: "Messages that wait for a connection are lost when you quit.",
  },
}

const PT: TextosDoAnfitriao = {
  arranque: {
    aProcurar: "A procurar actualizações",
    aDescarregar: (versao) => `A descarregar a versão ${versao}`,
    recebidos: (recebidos, total) => `${recebidos} de ${total}`,
    aPedirAutorizacao: (versao) => `O Windows vai pedir autorização para instalar a versão ${versao}.`,
    carregaEmSim: 'Carrega em "Sim" para continuar.',
    aInstalar: (versao) => `A instalar a versão ${versao}`,
    abreDeNovo: "A aplicação abre de novo quando terminar.",
  },
  bandeja: {
    porLer: (n) => `Orwell (${n} por ler)`,
    abrir: "Abrir o Orwell",
    arrancarComOSistema: "Arrancar com o sistema",
    sair: "Sair",
  },
  sairComPendentes: {
    sairNaMesma: "Sair na mesma",
    ficar: "Ficar",
    mensagem: "Há mensagens por enviar. Sair na mesma?",
    detalhe: "As mensagens à espera de ligação perdem-se ao sair.",
  },
}

/** The words in a language. Anything that is not "pt" is English. */
export function textosDoAnfitriao(lingua: string | null | undefined): TextosDoAnfitriao {
  return lingua === "pt" ? PT : EN
}
