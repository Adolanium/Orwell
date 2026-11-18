import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { folhaDaAuroraPronta, ID_DA_FOLHA_DA_AURORA, prepararFolhaDaAurora, sincronizarFolhaDaAurora } from "./folha-da-aurora.js"

/**
 * The Aurora sheet, in the document only on Aurora (1.3.20 fluidity).
 *
 * jsdom loads no stylesheet, so the `load` event is fired by hand. The proof
 * in a real engine that the first frame on Aurora does not flash is
 * `scripts/provar-primeiro-quadro-aurora.mjs`; the measure that the main sheet
 * got lighter is `medir-fluidez --rastreio --seletores`.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const link = (): HTMLLinkElement | null => document.getElementById(ID_DA_FOLHA_DA_AURORA) as HTMLLinkElement | null
const tema = (t: string): void => {
  document.documentElement.dataset.theme = t
}

afterEach(() => {
  link()?.remove()
  tema("escuro")
})

describe("a folha da Aurora", () => {
  it("não está na folha principal: é um ficheiro dela, com as duas metades do tema", () => {
    expect(ler("./styles.css")).not.toMatch(/@import "\.\/styles\/aurora/)
    expect([...ler("./styles-aurora.css").matchAll(/@import "([^"]+)"/g)].map((m) => m[1])).toEqual(["./styles/aurora.gen.css", "./styles/aurora.css"])
  })

  it("no escuro e no claro, nem entra no documento", async () => {
    for (const t of ["escuro", "claro", "sistema"]) {
      tema(t)
      await sincronizarFolhaDaAurora()
      expect(link(), t).toBeNull()
    }
  })

  it("no Aurora entra, por último no head, e só resolve quando a folha chega", async () => {
    tema("aurora")
    let pronta = false
    const espera = sincronizarFolhaDaAurora().then(() => (pronta = true))
    const el = link()
    expect(el?.rel).toBe("stylesheet")
    expect(el?.media).toBe("all")
    // The address of the `?url` import: hashed in the build (vitest processes no
    // CSS, so it is empty here; the build's own is proven by the first-frame script).
    expect(el?.hasAttribute("href")).toBe(true)
    expect(document.head.lastElementChild).toBe(el)
    await Promise.resolve()
    expect(pronta).toBe(false)
    el?.dispatchEvent(new Event("load"))
    await espera
    expect(pronta).toBe(true)
  })

  it("uma folha que falha não prende o arranque", async () => {
    tema("aurora")
    const espera = sincronizarFolhaDaAurora()
    link()?.dispatchEvent(new Event("error"))
    await expect(espera).resolves.toBeUndefined()
  })

  it("ao sair do Aurora sai da cascata (media=\"not all\") sem sair do documento, e volta sem a pedir de novo", async () => {
    tema("aurora")
    void sincronizarFolhaDaAurora()
    const el = link()
    tema("claro")
    await sincronizarFolhaDaAurora()
    expect(link()).toBe(el)
    expect(el?.media).toBe("not all")
    tema("aurora")
    void sincronizarFolhaDaAurora()
    expect(link()).toBe(el)
    expect(el?.media).toBe("all")
  })

  it("a escrita no head (lingua-cedo) é reaproveitada: nunca duas", async () => {
    const escrita = document.createElement("link")
    escrita.id = ID_DA_FOLHA_DA_AURORA
    escrita.rel = "stylesheet"
    escrita.media = "all"
    document.head.appendChild(escrita)
    tema("aurora")
    void sincronizarFolhaDaAurora()
    expect(document.querySelectorAll(`#${ID_DA_FOLHA_DA_AURORA}`)).toHaveLength(1)
  })

  it("preparar descarrega fora da cascata; escolher o Aurora liga-a", () => {
    tema("escuro")
    prepararFolhaDaAurora()
    expect(link()?.media).toBe("not all")
    prepararFolhaDaAurora()
    expect(document.querySelectorAll(`#${ID_DA_FOLHA_DA_AURORA}`)).toHaveLength(1)
  })

  it("segue o data-theme sozinha, seja quem for que o muda (applyPrefs, o guião do head)", async () => {
    tema("escuro")
    await folhaDaAuroraPronta()
    expect(link()).toBeNull()
    tema("aurora")
    await new Promise((r) => setTimeout(r, 0))
    expect(link()?.media).toBe("all")
    tema("claro")
    await new Promise((r) => setTimeout(r, 0))
    expect(link()?.media).toBe("not all")
  })
})
