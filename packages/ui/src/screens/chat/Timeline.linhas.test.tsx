import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

/**
 * A message written with Shift+Enter shows its line breaks (20/11/2026).
 *
 * The text keeps the "\n" all the way to the line, and the sheet draws it
 * (`white-space: pre-wrap` on `.message-body p`). jsdom does not apply CSS, so
 * the rule is read from the sheet.
 */
afterEach(cleanup)
const noop = (): void => {}
const ler = (relativo: string): string =>
  readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

const mensagem: ChatMessage = {
  channel: "!canal:s",
  seq: 1,
  sender: "@abc:s",
  payload: { t: "message", id: "m-1", sentAt: 1000, body: "primeira linha\nsegunda linha" },
}

describe("as quebras de linha na conversa", () => {
  it("o texto chega à linha com a quebra", () => {
    render(
      <ToastProvider>
        <Timeline
          channel="!canal:s"
          messages={[mensagem]}
          pending={[]}
          onRetry={noop}
          onDiscard={noop}
          me={null}
          nameFor={(sender) => sender}
          directory={new Map<string, Profile>()}
        />
      </ToastProvider>,
    )
    const corpo = document.querySelector(".message-body p")
    expect(corpo?.textContent).toBe("primeira linha\nsegunda linha")
  })

  it("a folha desenha a quebra", () => {
    expect(ler("../../styles/screens.css")).toMatch(/\.message-body p\s*\{[^}]*white-space:\s*pre-wrap/)
  })
})
