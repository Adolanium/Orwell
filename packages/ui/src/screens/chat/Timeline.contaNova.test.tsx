import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { RichText } from "../../components/RichText.js"
import { Timeline } from "./Timeline.js"

/**
 * The common room and new accounts (1.3.26). The content is end-to-end
 * encrypted, so the server cannot see a link: the app that RECEIVES shows the
 * links of an account in its first 24 hours as plain text, and hides its
 * images, files and link cards there.
 */
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
afterEach(cleanup)
const noop = (): void => {}

const IMAGEM = `data:image/png;base64,${"iVBORw0KGgo".repeat(10)}`

function mensagem(sender: string, id: string): ChatMessage {
  return {
    channel: "!sala:s",
    seq: 1,
    sender,
    payload: {
      t: "message",
      id,
      sentAt: 1,
      body: "vê https://exemplo.pt/promo",
      attachments: [{ name: "a.png", mediaType: "image/png", byteLength: 10, inline: IMAGEM }],
      links: [{ url: "https://exemplo.pt/promo", title: "Promoção" }],
    },
  } as unknown as ChatMessage
}

const timeline = (messages: ChatMessage[], autoresNovos?: ReadonlySet<string>): React.JSX.Element => (
  <Timeline
    channel="!sala:s"
    messages={messages}
    pending={[]}
    onRetry={noop}
    onDiscard={noop}
    me={null}
    nameFor={(s) => s}
    directory={new Map<string, Profile>()}
    {...(autoresNovos ? { autoresNovos } : {})}
  />
)

describe("as mensagens de uma conta nova na sala comum", () => {
  it("as ligações ficam texto, e as imagens e os cartões ficam escondidos, com a razão", () => {
    const { container } = render(timeline([mensagem("@nova:s", "mensagem-nova")], new Set(["@nova:s"])))
    expect(container.querySelector("a.linkified")).toBeNull()
    expect(container.textContent).toContain("https://exemplo.pt/promo")
    expect(container.querySelector(".message-media")).toBeNull()
    expect(screen.queryByText("Promoção")).toBeNull()
    expect(screen.getByText(strings.contaNova.anexosEscondidos)).toBeTruthy()
  })

  it("as outras contas ficam como sempre", () => {
    const { container } = render(timeline([mensagem("@antiga:s", "mensagem-velha")], new Set(["@nova:s"])))
    expect(container.querySelector("a.linkified")).not.toBeNull()
    expect(container.querySelector(".message-media")).not.toBeNull()
    expect(screen.queryByText(strings.contaNova.anexosEscondidos)).toBeNull()
  })
})

describe("RichText sem ligações", () => {
  it("desenha o endereço como texto", () => {
    const { container } = render(<RichText semLigacoes>{"vê www.exemplo.pt agora"}</RichText>)
    expect(container.querySelector("a")).toBeNull()
    expect(container.textContent).toBe("vê www.exemplo.pt agora")
  })
})
