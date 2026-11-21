import { definirLingua } from "../strings.js"
import { postLoginHold } from "../hooks/usePostLoginHold.js"

/**
 * The tests of this package read Portuguese.
 *
 * Since 20/11/2026 the module starts in English, the default language. The
 * suite has some twenty-seven hundred assertions written against Portuguese
 * text, and they keep reading Portuguese because this file ASKS for it, before
 * each test file. Not because of the machine that runs them: `arrancarLingua()`
 * is never called here, so the system of the machine does not count.
 *
 * The tests that measure the default itself (`lingua.test.ts`) look at
 * `LINGUA_BASE`, not at what this file sets.
 */
definirLingua("pt")

/*
  The opening hold after entering (`usePostLoginHold`) is off here: the fake
  bridges of the App tests never go online, and each would sit on the opening
  for the whole ceiling. `App.postLoginHold.test.tsx` turns it on and measures it.
*/
postLoginHold.capMs = 0
