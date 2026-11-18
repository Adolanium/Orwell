/**
 * The colour the desktop windows open with, from the theme the person chose.
 *
 * The theme lives in the renderer (`localStorage`, `tema-cedo.ts`), and the
 * main process opens the splash and the main window before any page runs. So
 * the renderer reports the theme each time it is set (`tema:definir`), the
 * main process keeps it in `tema.json` in `userData`, and the next start reads
 * it. Without this, someone on the light theme saw a dark window for a frame,
 * and the dark splash, at every start.
 *
 * No `electron` here: `index.ts` passes what the system says, so this is
 * tested without a window.
 */

export type TemaEscolhido = "escuro" | "claro" | "sistema" | "aurora"
export type TemaVisto = "escuro" | "claro" | "aurora"

/** The file in `userData`. */
export const FICHEIRO_DO_TEMA = "tema.json"

/**
 * The window background before the page paints: `--fundo` (the body,
 * `--bg-deep`) of each theme in `tokens.css`, so nothing changes colour when
 * the page arrives. `tema-da-janela.test.ts` reads them from the sheet.
 */
export const FUNDO_DA_JANELA: Record<TemaVisto, string> = {
  escuro: "#17181b",
  claro: "#e3e5e8",
  // Aurora is the 1.3.19 skin: its `--fundo`, kept in `aurora.gen.css`.
  aurora: "#080c1a",
}

/** Anything that is not a known theme reads as the default, dark. */
export function temaValido(valor: unknown): TemaEscolhido {
  return valor === "claro" || valor === "sistema" || valor === "aurora" ? valor : "escuro"
}

/** The stored file, tolerant: missing or junk is the default. */
export function lerTemaGuardado(texto: string | null): TemaEscolhido {
  if (!texto) return "escuro"
  try {
    return temaValido((JSON.parse(texto) as { tema?: unknown } | null)?.tema)
  } catch {
    return "escuro"
  }
}

export function escreverTema(tema: TemaEscolhido): string {
  return `${JSON.stringify({ tema })}\n`
}

/** What is on screen: "sistema" follows the OS. */
export function temaVisto(tema: TemaEscolhido, sistemaEscuro: boolean): TemaVisto {
  if (tema === "sistema") return sistemaEscuro ? "escuro" : "claro"
  return tema
}
