import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Call, type Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import type { UserAddress } from "@enclave/protocol"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

/**
 * The screen button for whoever lacks `transmitir` (12/11/2026): grey, still
 * focusable, with the reason on hover, focus and tap, and a tap never shares.
 */

afterEach(cleanup)

// jsdom has no media pipeline; the boxes only need `play()` not to crash.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

/** A stream with a video track, which is what a shared screen is. */
function fluxoDeEcra(id: string): MediaStream {
  const faixa = { kind: "video", enabled: true, stop: () => {} }
  return {
    id,
    getTracks: () => [faixa],
    getVideoTracks: () => [faixa],
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

/**
 * A full participant, with no `as` cast.
 *
 * The `as Participant` that was here was a type conversion, and a conversion is
 * a silent compiler: two new fields in the type, `ecraOferecido` and
 * `aVerONossoEcra`, slipped in without complaint, and the assertions passed
 * because a missing field reads as `undefined`, which happened to be what they
 * expected. Without the `as`, the field that the type gains tomorrow will break
 * here, and that is exactly where it should break.
 *
 * The only `as` that stays is on the address, and it is a different thing:
 * `UserAddress` is a branded string, and a brand only comes from whoever
 * validates it, writing a literal address in a test either goes through here
 * or through a `parse`, and a `parse` would only measure itself.
 */
function participante(address: string, extra: Partial<Participant> = {}): Participant {
  return {
    address: address as UserAddress,
    connected: true,
    stream: null,
    screen: null,
    video: false,
    encrypted: true,
    micMuted: false,
    ecraOferecido: false,
    aVerONossoEcra: false,
    ...extra,
  }
}

/**
 * The call engine, with the two values the panel asks it for.
 *
 * `tectoDePartilha` is the second, and it is not decoration: the number depends
 * on the ENGINE of the call, six in the mesh, where the screen goes directly
 * to each person, and the cap of the SFU when there is a media server
 * replicating it. A tuple that did not give this would make the panel read
 * `undefined` and always draw the button as off.
 */
function motor(podePartilharEcra = true, tectoDePartilha = Call.LIMITE_DE_PARTILHA): EnclaveBridge["call"] {
  return {
    setMuted: () => {},
    setCameraOff: () => {},
    podePartilharEcra,
    tectoDePartilha,
  } as unknown as EnclaveBridge["call"]
}

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={motor()}
      channel="!geral:s"
      participants={[participante("@ana:s")]}
      localStream={null}
      screenStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={() => "Ana"}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
      {...overrides}
    />
  )
}


const botaoDeEcra = (): HTMLElement => document.querySelector<HTMLElement>('.call-controls [data-ecra="1"]')!

describe("CallPanel sem transmitir", () => {
  it("o botão fica, cinzento, com aria-disabled e a frase na dica e no aria-describedby", () => {
    render(painel({ semTransmitir: true }))
    const botao = botaoDeEcra()
    expect(botao.getAttribute("aria-disabled")).toBe("true")
    expect(botao.hasAttribute("disabled")).toBe(false)
    expect(botao.getAttribute("data-tip")).toBe(strings.call.semTransmitir)
    const descrito = document.getElementById(botao.getAttribute("aria-describedby") ?? "")
    expect(descrito?.textContent).toBe(strings.call.semTransmitir)
  })

  it("tocar abre a dica e não partilha", () => {
    const partilhar = vi.fn()
    render(painel({ semTransmitir: true, onShareScreen: partilhar }))
    fireEvent.click(botaoDeEcra())
    expect(partilhar).not.toHaveBeenCalled()
    expect(botaoDeEcra().classList.contains("dica-aberta")).toBe(true)
  })

  it("com a permissão, o botão é o de sempre e partilha", () => {
    const partilhar = vi.fn()
    render(painel({ semTransmitir: false, onShareScreen: partilhar }))
    expect(botaoDeEcra().getAttribute("aria-disabled")).toBeNull()
    fireEvent.click(botaoDeEcra())
    expect(partilhar).toHaveBeenCalledTimes(1)
  })
})

describe("CallPanel — quem está na chamada, por cima do ecrã (12/11/2026)", () => {
  const ecraDaAna = (): MediaStream =>
    ({ id: "e", getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream

  it("só nomes, no canto de cima, com o microfone desligado marcado", () => {
    render(painel({ participants: [participante("@ana:s", { screen: ecraDaAna(), micMuted: true })], micMuted: false }))
    const lista = document.querySelector(".call-palco .call-palco-presentes .call-presentes")
    expect(lista).not.toBeNull()
    const nomes = [...(lista?.querySelectorAll(".call-presente-nome") ?? [])].map((n) => n.textContent)
    expect(nomes).toEqual(["Eu", "Ana"])
    expect(lista?.querySelector("img, .avatar")).toBeNull()
    expect(screen.getAllByRole("img", { name: strings.call.presenteCalado })).toHaveLength(1)
  })

  it("esconde-se com o rato parado e volta com o movimento", () => {
    vi.useFakeTimers()
    render(painel({ participants: [participante("@ana:s", { screen: ecraDaAna() })] }))
    const palco = document.querySelector<HTMLElement>(".call-palco")!
    fireEvent.pointerMove(palco)
    expect(palco.classList.contains("parado")).toBe(false)
    act(() => {
      vi.advanceTimersByTime(3100)
    })
    expect(palco.classList.contains("parado")).toBe(true)
    fireEvent.pointerMove(palco)
    expect(palco.classList.contains("parado")).toBe(false)
    vi.useRealTimers()
  })
})
