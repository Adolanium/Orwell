// The strings module alone, not the package index: the index pulls the Aurora
// sheet as a `?url` asset, which Vite refuses to serve to a setup file when the
// suite runs from the repository root (`npm test`, `vitest --root apps/client`).
import { definirLingua } from "../../../packages/ui/src/strings.js"

/**
 * The renderer tests of this app read the interface in Portuguese.
 *
 * Since 20/11/2026 `@enclave/ui` starts in English, the default language. The
 * assertions here that go through the catalog (`translateError`) are written
 * against Portuguese, so they ask for it, like `packages/ui` does.
 */
definirLingua("pt")
