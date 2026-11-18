import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LinhaDoEstado } from "./LinhaDoEstado.js"
import { strings } from "../strings.js"

afterEach(cleanup)

describe("a linha do estado", () => {
  it("ligado, não diz nada; a religar ou sem ligação, diz", () => {
    const { container, rerender } = render(<LinhaDoEstado connection="online" />)
    expect(container.querySelector(".statusbar")).toBeNull()
    rerender(<LinhaDoEstado connection="reconnecting" />)
    expect(container.querySelector(".statusbar")?.textContent).toBe(strings.common.connectionReconnecting)
    rerender(<LinhaDoEstado connection="offline" />)
    expect(container.querySelector(".statusbar")?.textContent).toBe(strings.common.connectionOffline)
  })

  it("é a única que desenha a linha: nenhum ecrã escreve a sua", () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "..") + sep
    const comLinha: string[] = []
    const percorrer = (pasta: string): void => {
      for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome)
        if (statSync(caminho).isDirectory()) percorrer(caminho)
        else if (/\.tsx$/.test(nome) && !/\.test\.tsx$/.test(nome) && !nome.startsWith("LinhaDoEstado")) {
          if (/className="statusbar"/.test(readFileSync(caminho, "utf8"))) comLinha.push(caminho.slice(raiz.length))
        }
      }
    }
    percorrer(raiz)
    expect(comLinha).toEqual([])
  })
})
