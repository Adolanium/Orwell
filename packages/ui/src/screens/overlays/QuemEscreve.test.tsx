import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { comSoLeitura, type SoLeitura } from "@enclave/protocol"
import { strings } from "../../strings.js"
import { itensDaSala } from "../chat/menuItems.js"
import { NewRoom } from "./NewRoom.js"
import { QuemEscreve } from "./QuemEscreve.js"

afterEach(cleanup)

/**
 * Read-only rooms (12/11/2026), the choice on screen. The rule itself is proved
 * in the protocol and the session; here, that the sheet says the rule belongs
 * to the apps BEFORE the roles, and that it publishes what was chosen.
 */

const cargos = [
  { role: "anuncios", name: "Anúncios", powers: [], position: 0 },
  { role: "mods", name: "Moderação", powers: [], position: 1 },
]

describe("a folha Quem escreve", () => {
  it("liga a só leitura, escolhe um cargo e guarda isso, com o aviso antes dos cargos", async () => {
    const ditos: SoLeitura[] = []
    render(
      <QuemEscreve
        roles={cargos}
        initial={{ soLeitura: false, quemEscreve: [] }}
        onSubmit={async (escolha) => void ditos.push(escolha)}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText(strings.soLeitura.open)).toBeTruthy()
    expect(screen.queryByText(strings.soLeitura.note)).toBeNull()
    await userEvent.click(screen.getByRole("switch", { name: strings.soLeitura.label }))
    const aviso = screen.getByText(strings.soLeitura.note)
    const caixa = screen.getByRole("checkbox", { name: "Anúncios" })
    // The warning comes before the choice in the document order.
    expect(aviso.compareDocumentPosition(caixa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(caixa)
    await userEvent.click(screen.getByRole("button", { name: strings.soLeitura.save }))
    expect(ditos).toEqual([{ soLeitura: true, quemEscreve: ["anuncios"] }])
  })

  it("abre com o que está guardado, e sem mudanças não guarda", async () => {
    render(
      <QuemEscreve
        roles={cargos}
        initial={{ soLeitura: true, quemEscreve: ["mods"] }}
        onSubmit={async () => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole("switch", { name: strings.soLeitura.label }).getAttribute("aria-checked")).toBe("true")
    expect((screen.getByRole("checkbox", { name: "Moderação" }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole("button", { name: strings.soLeitura.save }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("a sala nova", () => {
  it("nasce só de leitura quando se pede, e só se for de texto", async () => {
    const ditos: Record<string, unknown>[] = []
    render(<NewRoom cargos={cargos} onSubmit={async (next) => void ditos.push(next)} onCancel={() => {}} />)
    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "Avisos")
    await userEvent.click(screen.getByRole("switch", { name: strings.soLeitura.label }))
    await userEvent.click(screen.getByRole("checkbox", { name: "Anúncios" }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))
    expect(ditos[0]).toMatchObject({ name: "Avisos", kind: "text", soLeitura: { soLeitura: true, quemEscreve: ["anuncios"] } })
    // The core receives it as the room override.
    expect(comSoLeitura(undefined, ditos[0]!["soLeitura"] as SoLeitura)).toEqual([
      { role: "@todos", allow: [], deny: ["escrever"] },
      { role: "anuncios", allow: ["escrever"], deny: [] },
    ])
  })

  it("sem cargos dados pelo anfitrião, a escolha não aparece", () => {
    render(<NewRoom onSubmit={async () => {}} onCancel={() => {}} />)
    expect(screen.queryByRole("switch", { name: strings.soLeitura.label })).toBeNull()
  })

  it("numa sala de voz, a escolha não aparece", async () => {
    render(<NewRoom cargos={cargos} onSubmit={async () => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindVoice }))
    expect(screen.queryByRole("switch", { name: strings.soLeitura.label })).toBeNull()
  })
})

describe("o menu da sala", () => {
  const sala = { room: "avisos", name: "Avisos", kind: "text" as const }
  const accoes = { abrir: () => {}, renomear: () => {}, fechar: () => {} }
  it("mostra Quem escreve só a quem organiza e quando o anfitrião o dá", () => {
    const rotulos = (podeOrganizar: boolean, quemEscreve?: () => void): string[] =>
      itensDaSala({ sala, podeOrganizar, accoes: { ...accoes, ...(quemEscreve ? { quemEscreve } : {}) } }).map((i) => i.label)
    expect(rotulos(true, () => {})).toContain(strings.soLeitura.menu)
    expect(rotulos(true)).not.toContain(strings.soLeitura.menu)
    expect(rotulos(false, () => {})).not.toContain(strings.soLeitura.menu)
  })
})
