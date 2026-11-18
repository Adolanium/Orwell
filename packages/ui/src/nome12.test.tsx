import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "./App.js"
import type { EnclaveBridge, Profile } from "./bridge.js"
import { CampoDeNome } from "./components/CampoDeNome.js"
import { NomeComApelido } from "./components/NomeComApelido.js"
import { NomeDePessoa } from "./components/NomeDePessoa.js"
import { RichText } from "./components/RichText.js"
import { ConfirmarProvider } from "./hooks/useConfirmar.js"
import { aplicarMencoes, inserirMencao, sugerirMencoes } from "./lib/mentions.js"
import { notificationTextOf } from "./lib/notifications.js"
import { en } from "./linguas/en.js"
import { pt } from "./linguas/pt.js"
import { ProfileEditor } from "./screens/profile/ProfileEditor.js"
import { strings } from "./strings.js"

/**
 * Display names have a limit of 12 characters (17/11/2026).
 *
 * Write: 12 graphemes at most, trimmed, never empty; the field will not take
 * more, shows a counter, and says so when a paste was cut. Read: a longer name
 * that already exists (old profiles, clients 1.3.7 to 1.3.18) is never refused,
 * it is drawn as 12 graphemes and "…", with the whole name in the tooltip, and
 * mentions and search still find the person by the whole name.
 */

afterEach(cleanup)

const ANTIGO = "Maria Eduarda Albuquerque Sous"
const ANTIGO_VISIVEL = "Maria Eduard…"
const ANA = "@vespera-lumen-ardor-cantus:casa.pt"
const DOZE_EMOJIS = "👨‍👩‍👧‍👦🇵🇹👍🏽😀🎉❤️👨‍👩‍👧‍👦🇵🇹👍🏽😀🎉❤️"

function Controlado({ inicial = "" }: { inicial?: string }): React.JSX.Element {
  const [valor, setValor] = useState(inicial)
  return <CampoDeNome rotulo="Nome" value={valor} onChange={setValor} placeholder="nome" />
}

describe("o campo do nome (escrita)", () => {
  it("12 passa e 13 é cortado, com a frase curta", () => {
    render(<Controlado />)
    const campo = screen.getByPlaceholderText("nome") as HTMLInputElement
    fireEvent.change(campo, { target: { value: "abcdefghijkl" } })
    expect(campo.value).toBe("abcdefghijkl")
    expect(screen.queryByText(strings.nomeCurto.maximo(12))).toBeNull()
    fireEvent.change(campo, { target: { value: "abcdefghijklm" } })
    expect(campo.value).toBe("abcdefghijkl")
    expect(screen.getByText(strings.nomeCurto.maximo(12))).toBeTruthy()
  })

  it("colar um texto longo corta-o aos 12 e avisa", () => {
    render(<Controlado />)
    const campo = screen.getByPlaceholderText("nome") as HTMLInputElement
    fireEvent.change(campo, { target: { value: ANTIGO } })
    expect(campo.value).toBe("Maria Eduard")
    expect(screen.getByRole("status").textContent).toBe(strings.nomeCurto.maximo(12))
  })

  it("12 emojis compostos passam inteiros", () => {
    render(<Controlado />)
    const campo = screen.getByPlaceholderText("nome") as HTMLInputElement
    fireEvent.change(campo, { target: { value: DOZE_EMOJIS } })
    expect(campo.value).toBe(DOZE_EMOJIS)
    expect(screen.getByText("12/12")).toBeTruthy()
  })

  it('mostra o contador, "8/12"', () => {
    render(<Controlado inicial="Ana Rita" />)
    expect(screen.getByText("8/12")).toBeTruthy()
  })

  it("o campo não tem maxLength de UTF-16 (cortaria emojis compostos a meio)", () => {
    render(<Controlado />)
    expect((screen.getByPlaceholderText("nome") as HTMLInputElement).maxLength).toBe(-1)
  })

  it("a frase existe nas duas línguas, em STE100", () => {
    expect(pt.nomeCurto.maximo(12)).toBe("Máximo 12 caracteres.")
    expect(en.nomeCurto?.maximo?.(12)).toBe("12 characters at most.")
  })
})

describe("as Definições: o editor do perfil", () => {
  it("não deixa gravar mais de 12, e um nome vazio não grava", async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    const inicial: Profile = { displayName: "Ana", donations: [], updatedAt: 1 }
    render(
      <BridgeContext.Provider value={{ profile: { set }, social: {} } as unknown as EnclaveBridge}>
        <ConfirmarProvider>
          <ProfileEditor initial={inicial} address={ANA} onSaved={vi.fn()} onClose={vi.fn()} />
        </ConfirmarProvider>
      </BridgeContext.Provider>,
    )
    const campo = screen.getByDisplayValue("Ana") as HTMLInputElement
    fireEvent.change(campo, { target: { value: "abcdefghijklmnop" } })
    expect(campo.value).toBe("abcdefghijkl")
    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]![0].displayName).toBe("abcdefghijkl")

    fireEvent.change(campo, { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await Promise.resolve()
    expect(set).toHaveBeenCalledTimes(1)
  })

  it("um nome antigo de 30 abre como está e grava sem ser mexido", async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    const inicial: Profile = { displayName: ANTIGO, donations: [], bio: "x", updatedAt: 1 }
    render(
      <BridgeContext.Provider value={{ profile: { set }, social: {} } as unknown as EnclaveBridge}>
        <ConfirmarProvider>
          <ProfileEditor initial={inicial} address={ANA} onSaved={vi.fn()} onClose={vi.fn()} />
        </ConfirmarProvider>
      </BridgeContext.Provider>,
    )
    expect(screen.getByDisplayValue(ANTIGO)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]![0].displayName).toBe(ANTIGO)
  })
})

describe("a leitura: um nome antigo de 30", () => {
  it("aparece com 12 grafemas e «…», e o nome inteiro no title", () => {
    render(
      <p data-testid="n">
        <NomeDePessoa nome={ANTIGO} endereco={ANA} />
      </p>,
    )
    const p = screen.getByTestId("n")
    expect(p.textContent).toBe(ANTIGO_VISIVEL)
    expect(p.querySelector(`[title="${ANTIGO}"]`)).not.toBeNull()
  })

  it("um nome curto não ganha title nem reticências", () => {
    render(
      <p data-testid="n">
        <NomeDePessoa nome="Ana" endereco={ANA} />
      </p>,
    )
    expect(screen.getByTestId("n").textContent).toBe("Ana")
    expect(screen.getByTestId("n").querySelector("[title]")).toBeNull()
  })

  it("o apelido antigo também é cortado", () => {
    render(
      <p data-testid="n">
        <NomeComApelido nome="Ana" apelido="Aninhas das Flores Bravas" endereco={ANA} />
      </p>,
    )
    expect(screen.getByTestId("n").textContent).toBe("Aninhas das… Ana")
  })

  it("a menção desenha o nome cortado, com o inteiro no title", () => {
    render(
      <p data-testid="n">
        <RichText nameFor={() => ANTIGO}>{`olá ${ANA}!`}</RichText>
      </p>,
    )
    const mencao = screen.getByTestId("n").querySelector(".mention") as HTMLElement
    expect(mencao.textContent).toBe(`@${ANTIGO_VISIVEL}`)
    expect(mencao.querySelector(`[title="${ANTIGO}"]`)).not.toBeNull()
  })

  it("a menção e a pesquisa continuam a encontrar a pessoa pelo nome inteiro", () => {
    const candidatos = [{ address: ANA, name: ANTIGO }]
    expect(sugerirMencoes(candidatos, "albuq").map((c) => c.address)).toEqual([ANA])
    const { texto, pick } = inserirMencao("olá @albuq", 4, 10, candidatos[0]!)
    expect(texto).toBe(`olá @${ANTIGO} `)
    expect(aplicarMencoes(texto, [pick])).toEqual({ corpo: `olá ${ANA} `, mentions: [ANA] })
  })

  it("a notificação usa o nome cortado", () => {
    const texto = notificationTextOf(
      { id: "1", kind: "mention", actor: ANA, channel: "!c:casa.pt", at: 1, read: false } as never,
      () => ANTIGO,
      () => "geral",
    )
    expect(texto).toContain(ANTIGO_VISIVEL)
    expect(texto).not.toContain(ANTIGO)
  })
})
