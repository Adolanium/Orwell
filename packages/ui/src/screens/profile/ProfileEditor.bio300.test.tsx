import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { en } from "../../linguas/en.js"
import { pt } from "../../linguas/pt.js"
import { ProfileEditor } from "./ProfileEditor.js"
import { ProfileBody } from "./ProfileBody.js"

/**
 * The bio stops at 300 graphemes (1.3.26). The field cuts, the counter shows
 * in the last 60, an old longer bio opens cut with a notice, and the profile
 * page draws a longer bio cut with an ellipsis.
 */
afterEach(cleanup)

const FAMILIA = "👨‍👩‍👧‍👦"

function abrir(inicial: Profile, set = vi.fn().mockResolvedValue(undefined)): { campo: HTMLTextAreaElement; set: typeof set } {
  render(
    <BridgeContext.Provider value={{ profile: { set }, social: {} } as unknown as EnclaveBridge}>
      <ConfirmarProvider>
        <ProfileEditor initial={inicial} address="@ana:casa.pt" onSaved={vi.fn()} onClose={vi.fn()} />
      </ConfirmarProvider>
    </BridgeContext.Provider>,
  )
  return { campo: screen.getByLabelText(strings.profileEditor.bio) as HTMLTextAreaElement, set }
}

describe("ProfileEditor: a biografia com 300 caracteres", () => {
  it("os textos em inglês e em português", () => {
    expect(en.profileEditor?.bioMaximo?.(300)).toBe("300 characters at most.")
    expect(pt.profileEditor.bioMaximo(300)).toBe("Máximo 300 caracteres.")
    expect(pt.profileEditor.bioAntigaCortada(300)).toBe(
      "A tua biografia tem mais de 300 caracteres. Só aparecem os primeiros 300. Grava para ficar com este texto.",
    )
  })

  it("uma biografia curta não mostra o contador", () => {
    abrir({ displayName: "Ana", donations: [], bio: "faz fotografia" })
    expect(screen.queryByText("14/300")).toBeNull()
    expect(document.querySelector(".contador-da-bio")).toBeNull()
  })

  it("o contador aparece a partir de 240 e conta emojis como um", () => {
    const { campo } = abrir({ displayName: "Ana", donations: [] })
    fireEvent.change(campo, { target: { value: FAMILIA.repeat(239) } })
    expect(document.querySelector(".contador-da-bio")).toBeNull()
    fireEvent.change(campo, { target: { value: FAMILIA.repeat(240) } })
    expect(screen.getByText("240/300")).toBeTruthy()
  })

  it("colar 400 corta em 300, avisa, e grava só 300", async () => {
    const { campo, set } = abrir({ displayName: "Ana", donations: [] })
    fireEvent.change(campo, { target: { value: "a".repeat(400) } })
    expect(campo.value).toBe("a".repeat(300))
    expect(screen.getByText("300/300")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe(strings.profileEditor.bioMaximo(300))
    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]?.[0].bio).toBe("a".repeat(300))
  })

  it("uma biografia antiga de 1000 abre cortada em 300, com o aviso", () => {
    const { campo } = abrir({ displayName: "Ana", donations: [], bio: "z".repeat(1000) })
    expect(campo.value).toBe("z".repeat(300))
    expect(screen.getByText(strings.profileEditor.bioAntigaCortada(300))).toBeTruthy()
  })

  it("uma biografia dentro do limite não mostra o aviso", () => {
    abrir({ displayName: "Ana", donations: [], bio: "z".repeat(300) })
    expect(screen.queryByText(strings.profileEditor.bioAntigaCortada(300))).toBeNull()
  })
})

describe("o perfil desenha uma biografia antiga cortada", () => {
  it("1000 caracteres aparecem como 300 e reticências", () => {
    render(
      <BridgeContext.Provider value={{ social: {} } as unknown as EnclaveBridge}>
        <ProfileBody
          profile={{ displayName: "Ana", donations: [], bio: "z".repeat(1000) }}
          address="@ana:casa.pt"
          posts={[]}
          onOpenPost={vi.fn()}
          labels={{ posts: "Publicações" }}
          empty={{ title: "Nada", body: "Ainda nada." }}
        />
      </BridgeContext.Provider>,
    )
    const bio = document.querySelector(".profile-bio")
    expect(bio?.textContent).toBe(`${"z".repeat(300)}…`)
  })
})
