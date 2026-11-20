/**
 * The real App on a bridge in memory, for the pinned bar captures (fixadas-topo, 20/11/2026).
 * No server, no network: 500 messages in the default room, the 10th pinned.
 *
 *   ?tema=escuro|claro|aurora   the theme (written to the prefs before the App starts)
 *   ?fixadas=1|3                one pin, or three (the newest with a small image)
 */
import { createRoot } from "react-dom/client"
import { App, folhaDaAuroraPronta } from "@enclave/ui"
import "@enclave/ui/styles.css"

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CANAL = "!lagar:casa.pt"
const AGORA = Date.now() - 600 * 60_000
const params = new URLSearchParams(location.search)
const tema = params.get("tema") ?? "escuro"
const quantas = Number(params.get("fixadas") ?? "1")

try {
  localStorage.setItem("enclave.prefs", JSON.stringify({ tema }))
} catch {}
document.documentElement.dataset.theme = tema

function miniatura(): string {
  const tela = document.createElement("canvas")
  tela.width = 64
  tela.height = 64
  const g = tela.getContext("2d")!
  const grad = g.createLinearGradient(0, 0, 64, 64)
  grad.addColorStop(0, "#c98f3a")
  grad.addColorStop(1, "#2f5d50")
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return tela.toDataURL("image/png")
}

const frases = ["Bom dia a todos.", "Alguém viu a encomenda?", "Já cheguei.", "Amanhã há reunião às dez.", "Obrigado!"]
const historia = Array.from({ length: 500 }, (_, i) => {
  const sender = i % 3 === 0 ? BRUNO : ANA
  const body =
    i === 9
      ? "O código do portão é 4417. A chave da arrecadação está no vaso ao lado da porta, por baixo da pedra.\nSegunda linha que não aparece."
      : `${frases[i % frases.length]} (${i + 1})`
  return { seq: i + 1, sender, at: AGORA + i * 60_000, payload: { t: "message", id: `m${i + 1}`, sentAt: AGORA + i * 60_000, body } }
})

const fixadas = [
  { id: "m10", sender: BRUNO, body: historia[9]!.payload.body, sentAt: AGORA + 9 * 60_000, pinnedAt: AGORA, pinnedBy: BRUNO },
  ...(quantas >= 3
    ? [
        { id: "m120", sender: historia[119]!.sender, body: historia[119]!.payload.body, sentAt: AGORA + 119 * 60_000, pinnedAt: AGORA + 1, pinnedBy: BRUNO },
        {
          id: "m480",
          sender: historia[479]!.sender,
          body: historia[479]!.payload.body,
          sentAt: AGORA + 479 * 60_000,
          pinnedAt: AGORA + 2,
          pinnedBy: BRUNO,
          attachments: [{ name: "planta-do-armazem.png", kind: "image", mediaType: "image/png", byteLength: 48213, thumbnail: miniatura() }],
        },
      ]
    : []),
]

const nada = async (): Promise<{ ok: true }> => ({ ok: true })
const bridge = {
  vault: { status: async () => ({ exists: true, supportsOsProtection: true }), unlock: nada, create: nada, lock: nada, destroy: nada },
  identity: { load: async () => ({ address: EU, accountId: "eu" }), create: async () => ({ address: EU, accountId: "eu" }) },
  session: { connect: nada, capabilities: async () => ["mls"], setVisible: nada },
  channels: {
    list: async () => [CANAL],
    create: nada,
    invite: nada,
    channelInvites: async () => [],
    acceptChannelInvite: nada,
    declineChannelInvite: nada,
    send: nada,
    typing: nada,
    buzz: nada,
    members: async () => [EU, ANA, BRUNO],
    history: async () => historia,
    forget: nada,
    safetyNumber: async () => null,
    rooms: () => [],
    meta: () => null,
    editMessage: nada,
    deleteMessage: nada,
    mayPin: () => true,
    pins: () => [...fixadas],
  },
  invites: { create: async () => "enclave://join/x/y#z", redeem: nada, list: async () => [], revoke: nada },
  social: {
    post: nada,
    acceptFollower: nada,
    acceptFriend: nada,
    declineFriend: nada,
    unfriend: nada,
    repairInvite: async () => ({ invited: true }),
    deadWelcomes: async () => [],
    feedChannel: async () => "!mural-eu:casa.pt",
  },
  profile: {
    get: async () => ({ displayName: "Vera", donations: [] }),
    set: nada,
    directory: async () => ({ [ANA]: { displayName: "Ana", donations: [] }, [BRUNO]: { displayName: "Bruno", donations: [] } }),
  },
  notifications: { list: async () => [], save: nada },
  on: {
    message: () => () => {},
    epoch: () => () => {},
    status: () => () => {},
    connection: () => () => {},
    channels: () => () => {},
    presence: () => () => {},
    typing: () => () => {},
    buzz: () => () => {},
    callActivity: () => () => {},
  },
  call: { on: () => () => {}, setMuted: () => {} },
}

await folhaDaAuroraPronta()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
createRoot(document.getElementById("root")!).render(<App bridge={bridge as any} />)
