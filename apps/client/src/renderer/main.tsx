import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App, aplicarTemaCedo, arrancarLingua, folhaDaAuroraPronta } from "@enclave/ui"
import "@enclave/ui/styles.css"
import { createDesktopBridge } from "./bridge.js"
import { relatarAtributoAoAnfitriao, relatarTemaAoAnfitriao } from "./tema.js"

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

// Before `render`: the first draw must go out already in the right language.
// English until the person chooses (1.3.9): the system language does not count.
document.documentElement.lang = arrancarLingua()
// And in the right colour theme: `applyPrefs` only runs after mount.
aplicarTemaCedo()
// The main process opens the windows before any page runs, so it learns the
// theme from here: now, and each time it changes (`applyPrefs` sets the same
// attribute). It keeps it for the next start (`main/tema-da-janela.ts`).
relatarTemaAoAnfitriao(document.documentElement, window.enclaveHost?.tema)
// And the language, for the one question the main process asks before any
// window: a new version, on Windows ("Ask first", `actualizacao-windows.ts`).
relatarAtributoAoAnfitriao(document.documentElement, "lang", window.enclaveHost?.lingua)

// On Aurora, its sheet before React draws: it is its own file, in the
// document only for whoever chose it (`folha-da-aurora.ts`), and from here on
// it follows the theme. Elsewhere this resolves at once.
await folhaDaAuroraPronta()

createRoot(root).render(
  <StrictMode>
    <App bridge={createDesktopBridge()} lotePorQuadro />
  </StrictMode>,
)
