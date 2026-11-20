// @vitest-environment node
import type { spawn, SpawnOptions } from "node:child_process"
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
// @ts-expect-error plain JavaScript script, no declarations: it is run by
// `node scripts/publicar-instaladores.mjs` and isn't part of any build.
import { manifestoDeActualizacaoWindows, mensagemDaActualizacaoWindows } from "../../../../scripts/instaladores.mjs"
import {
  ARGUMENTOS_DO_INSTALADOR,
  ARGUMENTOS_DO_INSTALADOR_PARA_TODOS,
  arranqueComActualizacao,
  arranqueComDiagnostico,
  assinaturaValida,
  chavePublicaDe,
  dentroDosProgramas,
  ENDERECO_DA_ACTUALIZACAO_WINDOWS,
  enderecoDoManifestoNaRelease,
  escreverVista,
  lerVista,
  guiaoDeElevacao,
  lancarComAdministrador,
  lerDiagnosticoDoArranque,
  lerManifestoWindows,
  lerModoGuardado,
  escreverModo,
  MODO_POR_OMISSAO,
  textosDaPergunta,
  mensagemDaActualizacao,
  SAIDA_DO_UAC_RECUSADO,
  type EstadoDoEcra,
  type ManifestoWindows,
  type PortasDoArranque,
  type RespostaDoUac,
  type Vista,
} from "./actualizacao-windows.js"
import { CHAVE_PUBLICA_DE_ACTUALIZACOES } from "./chave-de-actualizacoes.js"
import { codigoDoEstado, textoDoArranque } from "./ecra-de-arranque.js"

/**
 * Windows auto-update, tested without Windows and without network.
 *
 * What matters is proving the whole design rule: **only a manifest signed by
 * our key, of a newer version, with a file whose size and hash are signed, gets
 * to run.** Everything else falls back to the current version, and says why.
 *
 * Manifests are signed by the publish script function
 * (`scripts/instaladores.mjs`) and verified by the app's. Both write the message
 * on their own side; if they diverge, the first line of these tests fails.
 */

const { privateKey: PRIVADA, publicKey } = generateKeyPairSync("ed25519")
const PUBLICA = chavePublicaDe(publicKey.export({ format: "jwk" }).x as string)
const OUTRA = generateKeyPairSync("ed25519").privateKey

/** A test "installer": bytes that don't run, but that are measured. */
const INSTALADOR = Buffer.from("MZ instalador de ensaio da 1.0.7 ".repeat(4000))
const SHA512 = createHash("sha512").update(INSTALADOR).digest("hex")
const NOME = "Orwell-1.0.7-windows-x64.exe"

function assinado(
  campos: Partial<{ versao: string; nome: string; bytes: number; sha512: string; urgente: boolean }> = {},
  chave: KeyObject = PRIVADA,
): ManifestoWindows {
  return manifestoDeActualizacaoWindows(
    campos.versao ?? "1.0.7",
    { nome: campos.nome ?? NOME, bytes: campos.bytes ?? INSTALADOR.length, sha512: campos.sha512 ?? SHA512 },
    (mensagem: Buffer) => sign(null, mensagem, chave),
    { urgente: campos.urgente ?? false },
  )
}



/**
 * What this device saw on GitHub, as the default of `portas`: the manifest of
 * the last `servidor` seen long ago, so the install path is not held by the
 * wait. The wait itself is proved in its own block.
 */
let vistaDoUltimoServidor: Vista | null = null

/** A record kept in memory, the way `actualizacao-vista.json` is on disk. */
function memoria(inicial: Vista | null): NonNullable<PortasDoArranque["vista"]> & { atual: () => Vista | null } {
  let vista = inicial
  return {
    ler: async () => vista,
    gravar: async (nova) => {
      vista = nova
    },
    atual: () => vista,
  }
}

/** A fake server: the manifest and the installer on orwell.pt, and the manifest on GitHub. */
function servidor(
  manifesto: unknown,
  opcoes: {
    instalador?: Buffer
    pedaco?: number
    pendurarDepoisDe?: number
    /**
     * GitHub's copy of the manifest, per request (the first, the second...):
     * text, `null` for a 404, "em-baixo" for a 503, "sem-rede" for a thrown
     * fetch. By default, the same bytes orwell.pt serves, every time.
     */
    noGithub?: string | null | "em-baixo" | "sem-rede" | ((pedido: number) => string | null | "em-baixo" | "sem-rede")
  } = {},
): { buscar: typeof fetch; pedidos: string[]; texto: string } {
  const pedidos: string[] = []
  const corpo = opcoes.instalador ?? INSTALADOR
  const pedaco = opcoes.pedaco ?? 16_384
  const texto = typeof manifesto === "string" ? manifesto : JSON.stringify(manifesto, null, 2) + "\n"
  const versao = (manifesto as { versao?: string } | null)?.versao ?? "0.0.0"
  vistaDoUltimoServidor = { versao, hash: createHash("sha256").update(texto).digest("hex"), vistoEm: 1 }
  let pedidosAoGithub = 0
  const buscar = (async (url: string, init?: RequestInit) => {
    pedidos.push(url)
    if (url === ENDERECO_DA_ACTUALIZACAO_WINDOWS) {
      if (manifesto === 404) return new Response("não há", { status: 404 })
      return new Response(texto)
    }
    if (url.startsWith("https://github.com/") || url.startsWith("https://api.github.com/")) {
      const n = pedidosAoGithub++
      const regra = typeof opcoes.noGithub === "function" ? opcoes.noGithub(n) : opcoes.noGithub
      if (regra === "sem-rede") throw new TypeError("fetch failed")
      if (regra === "em-baixo") return new Response("indisponível", { status: 503 })
      if (url !== enderecoDoManifestoNaRelease(versao) || regra === null) return new Response("não há", { status: 404 })
      return new Response(regra ?? texto)
    }
    let enviado = 0
    const sinal = init?.signal
    const fluxo = new ReadableStream<Uint8Array>({
      pull(controlo) {
        if (opcoes.pendurarDepoisDe !== undefined && enviado >= opcoes.pendurarDepoisDe) {
          // It hangs: the server stopped sending bytes without closing the connection.
          return new Promise<void>((_, falhou) =>
            sinal?.addEventListener("abort", () => {
              const erro = new Error("abortado")
              controlo.error(erro)
              falhou(erro)
            }),
          )
        }
        if (enviado >= corpo.length) return controlo.close()
        controlo.enqueue(new Uint8Array(corpo.subarray(enviado, enviado + pedaco)))
        enviado += pedaco
      },
    })
    return new Response(fluxo)
  }) as typeof fetch
  return { buscar, pedidos, texto }
}

const pastas: string[] = []
afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function portas(
  buscar: typeof fetch,
  extras: Partial<PortasDoArranque> = {},
): PortasDoArranque & { estados: EstadoDoEcra[]; instalados: string[]; conteudoInstalado: Buffer[] } {
  const pasta = mkdtempSync(join(tmpdir(), "orwell-actualizacao-teste-"))
  pastas.push(pasta)
  const estados: EstadoDoEcra[] = []
  const instalados: string[] = []
  const conteudoInstalado: Buffer[] = []
  return {
    instalada: "1.0.6",
    chave: PUBLICA,
    pasta: join(pasta, "descarga"),
    mostrar: (estado) => estados.push(estado),
    semAdministrador: () => true,
    instalar: async (caminho) => {
      instalados.push(caminho)
      conteudoInstalado.push(readFileSync(caminho))
    },
    instalarComAdministrador: async () => {
      throw new Error("uma instalação por utilizador não pede o UAC")
    },
    buscar,
    // The install path these tests prove is "Automatically"; asking first is
    // proved in its own block below, and is the default when nothing is said.
    modo: "automaticamente",
    vista: memoria(vistaDoUltimoServidor),
    estados,
    instalados,
    conteudoInstalado,
    ...extras,
  }
}

describe("a assinatura", () => {
  it("o guião de publicação e a aplicação escrevem a mesma mensagem", () => {
    const campos = { versao: "1.0.7", ficheiro: NOME, bytes: 123, sha512: SHA512 }
    expect(mensagemDaActualizacaoWindows(campos)).toBe(mensagemDaActualizacao(campos))
  })

  it("aceita o manifesto assinado pela chave", () => {
    expect(assinaturaValida(assinado(), PUBLICA)).toBe(true)
  })

  it("recusa um campo mudado depois de assinar", () => {
    for (const mudado of [
      { versao: "1.0.8" },
      { ficheiro: "Orwell-1.0.7-windows-x64-outro.exe" },
      { bytes: INSTALADOR.length + 1 },
      { sha512: "0".repeat(128) },
    ]) {
      expect(assinaturaValida({ ...assinado(), ...mudado }, PUBLICA)).toBe(false)
    }
  })

  it("recusa a assinatura de outra chave", () => {
    expect(assinaturaValida(assinado({}, OUTRA), PUBLICA)).toBe(false)
  })

  it("recusa uma assinatura sem sentido sem atirar", () => {
    expect(assinaturaValida({ ...assinado(), assinatura: "A".repeat(86) + "==" }, PUBLICA)).toBe(false)
  })

  it("a chave embutida é uma chave Ed25519 que se lê", () => {
    expect(() => chavePublicaDe(CHAVE_PUBLICA_DE_ACTUALIZACOES)).not.toThrow()
    expect(chavePublicaDe(CHAVE_PUBLICA_DE_ACTUALIZACOES).asymmetricKeyType).toBe("ed25519")
  })
})

describe("o manifesto", () => {
  it("recusa nomes que saem da pasta, versões sem forma e tamanhos absurdos", () => {
    const bom = assinado()
    expect(lerManifestoWindows(bom)).not.toBeNull()
    expect(lerManifestoWindows({ ...bom, ficheiro: "../Orwell.exe" })).toBeNull()
    expect(lerManifestoWindows({ ...bom, ficheiro: "pasta/Orwell.exe" })).toBeNull()
    expect(lerManifestoWindows({ ...bom, ficheiro: "Orwell.msi" })).toBeNull()
    expect(lerManifestoWindows({ ...bom, versao: "1.0.7-beta" })).toBeNull()
    expect(lerManifestoWindows({ ...bom, bytes: 0 })).toBeNull()
    expect(lerManifestoWindows({ ...bom, bytes: 2 ** 40 })).toBeNull()
    expect(lerManifestoWindows({ ...bom, sha512: "a".repeat(64) })).toBeNull()
    expect(lerManifestoWindows(null)).toBeNull()
  })
})

describe("o arranque, com duplos: só o manifesto bom instala", () => {
  it("válido: descarrega, confere e instala o ficheiro descarregado", async () => {
    const { buscar, pedidos } = servidor(assinado())
    const p = portas(buscar)
    const resultado = await arranqueComActualizacao(p)

    expect(resultado).toEqual({ accao: "sair", codigo: "a-instalar", versao: "1.0.7" })
    expect(p.instalados).toHaveLength(1)
    expect(p.conteudoInstalado[0]?.equals(INSTALADOR)).toBe(true)
    // The installer comes from the SAME folder as the manifest, with the signed name.
    // After the manifest and its two checks on GitHub (1.3.20), the installer.
    expect(pedidos[3]).toBe(ENDERECO_DA_ACTUALIZACAO_WINDOWS.replace("actualizacao-windows.json", NOME))
    // The screen: look for, download with the bar rising to the end, install.
    expect(p.estados[0]).toEqual({ fase: "a-procurar" })
    const descargas = p.estados.filter((e) => e.fase === "a-descarregar")
    expect(descargas.length).toBeGreaterThan(2)
    expect(descargas.at(-1)).toMatchObject({ recebidos: INSTALADOR.length, total: INSTALADOR.length })
    expect(p.estados.at(-1)).toEqual({ fase: "a-instalar", versao: "1.0.7" })
  })

  it("adulterado: entra sem descarregar", async () => {
    const { buscar, pedidos } = servidor({ ...assinado(), versao: "1.0.9" })
    const p = portas(buscar)
    expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "assinatura-errada" })
    expect(p.instalados).toEqual([])
    expect(pedidos).toEqual([ENDERECO_DA_ACTUALIZACAO_WINDOWS])
  })

  it("chave errada: entra sem descarregar", async () => {
    const { buscar, pedidos } = servidor(assinado({}, OUTRA))
    const p = portas(buscar)
    expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "assinatura-errada" })
    expect(p.instalados).toEqual([])
    expect(pedidos).toHaveLength(1)
  })

  it("versão menor ou igual, bem assinada: está em dia", async () => {
    for (const versao of ["1.0.5", "1.0.6"]) {
      const { buscar, pedidos } = servidor(assinado({ versao }))
      const p = portas(buscar)
      expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "em-dia", versao })
      expect(p.instalados).toEqual([])
      expect(pedidos).toHaveLength(1)
    }
  })

  it("tamanho errado: o servidor manda mais ou menos do que o assinado", async () => {
    const maior = Buffer.concat([INSTALADOR, Buffer.from("mais")])
    const menor = INSTALADOR.subarray(0, INSTALADOR.length - 10)
    for (const instalador of [maior, menor]) {
      const { buscar } = servidor(assinado(), { instalador })
      const p = portas(buscar)
      expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "tamanho-errado" })
      expect(p.instalados).toEqual([])
    }
  })

  it("SHA errada: o mesmo tamanho, outros bytes", async () => {
    const trocado = Buffer.from(INSTALADOR)
    trocado[100] = trocado[100]! ^ 0xff
    const { buscar } = servidor(assinado(), { instalador: trocado })
    const p = portas(buscar)
    expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "soma-errada" })
    expect(p.instalados).toEqual([])
  })

  it("sem rede: entra, e não atira", async () => {
    const buscar = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch
    expect(await arranqueComActualizacao(portas(buscar))).toMatchObject({ accao: "entrar", codigo: "sem-rede" })
  })

  it("um servidor que não responde: entra ao fim do prazo da verificação", async () => {
    const buscar = ((_url: string, init?: RequestInit) =>
      new Promise((_, falhou) => init?.signal?.addEventListener("abort", () => falhou(new Error("prazo"))))) as typeof fetch
    const inicio = Date.now()
    const resultado = await arranqueComActualizacao(portas(buscar, { prazos: { verificacaoMs: 50 } }))
    expect(resultado).toMatchObject({ accao: "entrar", codigo: "sem-rede" })
    expect(Date.now() - inicio).toBeLessThan(2_000)
  })

  it("uma descarga que pára a meio: desiste e entra", async () => {
    const { buscar } = servidor(assinado(), { pendurarDepoisDe: 32_768 })
    const p = portas(buscar, { prazos: { semDadosMs: 100 } })
    expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "descarga-parada" })
    expect(p.instalados).toEqual([])
  })

  it("sem manifesto publicado (404): entra, e diz que não há", async () => {
    const { buscar } = servidor(404)
    expect(await arranqueComActualizacao(portas(buscar))).toMatchObject({ accao: "entrar", codigo: "sem-manifesto" })
  })

  it("manifesto estragado: entra", async () => {
    const { buscar } = servidor("{ isto não é json")
    expect(await arranqueComActualizacao(portas(buscar))).toMatchObject({ accao: "entrar", codigo: "manifesto-recusado" })
  })

  it("instalação por utilizador: instala sem UAC, como antes", async () => {
    const { buscar } = servidor(assinado())
    const p = portas(buscar)
    expect(await arranqueComActualizacao(p)).toEqual({ accao: "sair", codigo: "a-instalar", versao: "1.0.7" })
    expect(p.conteudoInstalado).toEqual([INSTALADOR])
    expect(p.estados.map((e) => e.fase)).not.toContain("a-pedir-autorizacao")
  })
})

describe("instalação para todos (Program Files)", () => {
  /** A fake UAC: stores what it received and responds with what it's told. */
  function uac(resposta: RespostaDoUac, estados: EstadoDoEcra[], visto: { conteudo?: Buffer; fases?: string[] } = {}) {
    return async (caminho: string): Promise<RespostaDoUac> => {
      visto.conteudo = readFileSync(caminho)
      visto.fases = estados.map((e) => e.fase)
      return resposta
    }
  }

  it("UAC aceite: descarrega, confere, e SÓ DEPOIS pede o UAC uma vez", async () => {
    const { buscar, pedidos } = servidor(assinado())
    const visto: { conteudo?: Buffer; fases?: string[] } = {}
    const estados: EstadoDoEcra[] = []
    let vezes = 0
    const pedir = uac("aceite", estados, visto)
    const p = portas(buscar, {
      semAdministrador: () => false,
      mostrar: (e) => estados.push(e),
      instalar: async () => {
        throw new Error("Program Files não corre o instalador sem administrador")
      },
      instalarComAdministrador: async (caminho) => {
        vezes++
        return pedir(caminho)
      },
    })
    expect(await arranqueComActualizacao(p)).toEqual({ accao: "sair", codigo: "a-instalar", versao: "1.0.7" })
    expect(vezes).toBe(1)
    expect(pedidos).toEqual([
      ENDERECO_DA_ACTUALIZACAO_WINDOWS,
      enderecoDoManifestoNaRelease("1.0.7"),
      enderecoDoManifestoNaRelease("1.0.7"),
      `https://orwell.pt/transferencias/${NOME}`,
    ])
    // The file that goes to UAC is the verified one, in full.
    expect(visto.conteudo).toEqual(INSTALADOR)
    // The UAC prompt appears after download, and "installing" only after "Yes".
    expect(visto.fases?.at(-1)).toBe("a-pedir-autorizacao")
    expect(visto.fases).toContain("a-descarregar")
    expect(estados.at(-1)).toEqual({ fase: "a-instalar", versao: "1.0.7" })
  })

  it("UAC recusado: entra na versão que tem, com uac-recusado", async () => {
    const { buscar } = servidor(assinado())
    const estados: EstadoDoEcra[] = []
    const p = portas(buscar, {
      semAdministrador: () => false,
      mostrar: (e) => estados.push(e),
      instalarComAdministrador: uac("recusado", estados),
    })
    expect(await arranqueComActualizacao(p)).toEqual({ accao: "entrar", codigo: "uac-recusado", versao: "1.0.7" })
    expect(estados.map((e) => e.fase)).not.toContain("a-instalar")
    expect(lerDiagnosticoDoArranque({ quando: 1, codigo: "uac-recusado", versao: "1.0.7" })?.codigo).toBe("uac-recusado")
  })

  it("um instalador adulterado nunca chega ao UAC", async () => {
    const { buscar } = servidor(assinado(), { instalador: Buffer.concat([INSTALADOR.subarray(1), Buffer.from("X")]) })
    let pedido = false
    const p = portas(buscar, {
      semAdministrador: () => false,
      instalarComAdministrador: async () => {
        pedido = true
        return "aceite"
      },
    })
    expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "soma-errada" })
    expect(pedido).toBe(false)
  })

  it("sem PowerShell (ou sem conseguir perguntar): instalador-falhou, e entra", async () => {
    const { buscar } = servidor(assinado())
    const p = portas(buscar, {
      semAdministrador: () => false,
      instalarComAdministrador: async () => {
        throw new Error("powershell saiu com 1")
      },
    })
    expect(await arranqueComActualizacao(p)).toMatchObject({
      accao: "entrar",
      codigo: "instalador-falhou",
      detalhe: "powershell saiu com 1",
    })
  })
})

describe("o pedido do UAC", () => {
  /** A fake `spawn`: a process that exits with the given code. */
  function lancador(saida: number | null, erro?: Error) {
    const chamadas: { comando: string; argumentos: string[]; opcoes: SpawnOptions }[] = []
    const lancar = ((comando: string, argumentos: string[], opcoes: SpawnOptions) => {
      chamadas.push({ comando, argumentos, opcoes })
      const filho = new EventEmitter()
      queueMicrotask(() => (erro ? filho.emit("error", erro) : filho.emit("exit", saida, null)))
      return filho
    }) as unknown as typeof spawn
    return { lancar, chamadas }
  }

  const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  const CAMINHO = "C:\\Users\\ana\\AppData\\Local\\Temp\\orwell-actualizacao\\Orwell-1.0.7-windows-x64.exe"

  it("saída 0 é aceite; 23 é recusado; outra coisa atira", async () => {
    const correr = (saida: number | null) =>
      lancarComAdministrador(CAMINHO, ARGUMENTOS_DO_INSTALADOR_PARA_TODOS, lancador(saida).lancar, POWERSHELL, {})
    expect(await correr(0)).toBe("aceite")
    expect(await correr(SAIDA_DO_UAC_RECUSADO)).toBe("recusado")
    await expect(correr(1)).rejects.toThrow("powershell saiu sem sucesso")
    await expect(correr(null)).rejects.toThrow()
    const { lancar } = lancador(null, new Error("spawn ENOENT"))
    await expect(lancarComAdministrador(CAMINHO, [], lancar, POWERSHELL, {})).rejects.toThrow("spawn ENOENT")
  })

  it("corre o PowerShell do sistema, escondido, com o caminho pelo ambiente e não pelo texto", async () => {
    const { lancar, chamadas } = lancador(0)
    await lancarComAdministrador(CAMINHO, ARGUMENTOS_DO_INSTALADOR_PARA_TODOS, lancar, POWERSHELL, { PATH: "x" })
    expect(chamadas).toHaveLength(1)
    const { comando, argumentos, opcoes } = chamadas[0]!
    expect(comando).toBe(POWERSHELL)
    expect(opcoes).toMatchObject({ windowsHide: true, env: { PATH: "x", ORWELL_INSTALADOR: CAMINHO } })
    expect(argumentos.slice(0, -1)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand"])
    const guiao = Buffer.from(argumentos.at(-1) as string, "base64").toString("utf16le")
    expect(guiao).toBe(guiaoDeElevacao(ARGUMENTOS_DO_INSTALADOR_PARA_TODOS))
    expect(guiao).not.toContain(CAMINHO)
    expect(guiao).toContain("$p.FileName = $env:ORWELL_INSTALADOR")
  })

  it("o guião pede runas, lança o instalador com /allusers, e conhece o 1223", () => {
    const guiao = guiaoDeElevacao(ARGUMENTOS_DO_INSTALADOR_PARA_TODOS)
    expect(guiao).toContain("$p.Verb = 'runas'")
    expect(guiao).toContain("$p.UseShellExecute = $true")
    expect(guiao).toContain("$p.Arguments = '--updated /S --force-run /allusers'")
    expect(guiao).toContain(`$e.NativeErrorCode -eq 1223) { exit ${SAIDA_DO_UAC_RECUSADO} }`)
    expect(ARGUMENTOS_DO_INSTALADOR_PARA_TODOS).toEqual([...ARGUMENTOS_DO_INSTALADOR, "/allusers"])
  })

  it("recusa um argumento que fecharia a plica", () => {
    expect(() => guiaoDeElevacao(["--updated", "'; Remove-Item C:\\ -Recurse; '"])).toThrow("argumento recusado")
  })
})

describe("o diagnóstico de cada arranque", () => {
  const resultadoBom = { accao: "entrar", codigo: "em-dia", versao: "1.0.7" } as const

  it("grava o desfecho normal", async () => {
    const gravados: unknown[] = []
    const r = await arranqueComDiagnostico(async () => resultadoBom, async (g) => void gravados.push(g), () => 42)
    expect(r).toEqual(resultadoBom)
    expect(gravados).toEqual([{ quando: 42, codigo: "em-dia", versao: "1.0.7" }])
  })

  it("grava mesmo quando o arranque atira antes (a chave, a janela)", async () => {
    const gravados: unknown[] = []
    const r = await arranqueComDiagnostico(
      async () => {
        throw new Error("a janela não abriu")
      },
      async (g) => void gravados.push(g),
      () => 7,
    )
    expect(r).toEqual({ accao: "entrar", codigo: "arranque-falhou", detalhe: "a janela não abriu" })
    expect(gravados).toEqual([{ quando: 7, codigo: "arranque-falhou" }])
    // And the interface accepts it in "Enviar registo".
    expect(lerDiagnosticoDoArranque(gravados[0])).toEqual({ quando: 7, codigo: "arranque-falhou" })
  })

  it("um disco que não grava não deita o arranque abaixo", async () => {
    const r = await arranqueComDiagnostico(
      async () => resultadoBom,
      async () => {
        throw new Error("ENOSPC")
      },
    )
    expect(r).toEqual(resultadoBom)
  })

  it("um uac-recusado chega ao ficheiro com a versão", async () => {
    const { buscar } = servidor(assinado())
    const gravados: unknown[] = []
    await arranqueComDiagnostico(
      () =>
        arranqueComActualizacao(
          portas(buscar, { semAdministrador: () => false, instalarComAdministrador: async () => "recusado" }),
        ),
      async (g) => void gravados.push(g),
      () => 1,
    )
    expect(gravados).toEqual([{ quando: 1, codigo: "uac-recusado", versao: "1.0.7" }])
  })

  it("o instalador não arranca: entra na versão que tem", async () => {
    const { buscar } = servidor(assinado())
    const p = portas(buscar, {
      instalar: async () => {
        throw new Error("spawn ENOENT")
      },
    })
    expect(await arranqueComActualizacao(p)).toMatchObject({ accao: "entrar", codigo: "instalador-falhou" })
  })
})

describe("as peças à volta", () => {
  it("Program Files é instalação para todos; a pasta do utilizador não", () => {
    const ambiente = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" }
    expect(dentroDosProgramas("C:\\Program Files\\Orwell", ambiente)).toBe(true)
    expect(dentroDosProgramas("c:\\program files (x86)\\Orwell", ambiente)).toBe(true)
    expect(dentroDosProgramas("C:\\Program Files Extra\\Orwell", ambiente)).toBe(false)
    expect(dentroDosProgramas("C:\\Users\\ana\\AppData\\Local\\Programs\\Orwell", ambiente)).toBe(false)
    expect(dentroDosProgramas("C:\\Program Files\\Orwell", {})).toBe(false)
  })

  it("o diagnóstico só deixa passar códigos conhecidos e versões com forma", () => {
    expect(lerDiagnosticoDoArranque({ quando: 1, codigo: "assinatura-errada", versao: "1.0.7" })).toEqual({
      quando: 1,
      codigo: "assinatura-errada",
      versao: "1.0.7",
    })
    expect(lerDiagnosticoDoArranque({ quando: 1, codigo: "<script>" })).toBeNull()
    expect(lerDiagnosticoDoArranque({ quando: 1, codigo: "em-dia", versao: "<b>" })).toEqual({ quando: 1, codigo: "em-dia" })
    expect(lerDiagnosticoDoArranque("lixo")).toBeNull()
  })

  it("o ecrã de arranque diz o que está a acontecer, em frases curtas", () => {
    // English by default (20/11/2026); Portuguese when the app is in Portuguese.
    expect(textoDoArranque({ fase: "a-procurar" }).titulo).toBe("Looking for updates")
    const meio = textoDoArranque({ fase: "a-descarregar", versao: "1.0.7", recebidos: 50 * 1048576, total: 100 * 1048576 })
    expect(meio).toEqual({ titulo: "Downloading version 1.0.7", detalhe: "50 MB of 100 MB", progresso: 0.5 })
    expect(textoDoArranque({ fase: "a-procurar" }, "pt").titulo).toBe("A procurar actualizações")
    const meioPt = textoDoArranque({ fase: "a-descarregar", versao: "1.0.7", recebidos: 50 * 1048576, total: 100 * 1048576 }, "pt")
    expect(meioPt).toEqual({ titulo: "A descarregar a versão 1.0.7", detalhe: "50 MB de 100 MB", progresso: 0.5 })
    expect(textoDoArranque({ fase: "a-instalar", versao: "1.0.7" }, "pt").titulo).toBe("A instalar a versão 1.0.7")
  })

  it("antes do UAC o ecrã diz que o Windows vai pedir autorização, sem barra", () => {
    expect(textoDoArranque({ fase: "a-pedir-autorizacao", versao: "1.0.7" })).toEqual({
      titulo: "Windows will ask for permission to install version 1.0.7.",
      detalhe: 'Click "Yes" to continue.',
      progresso: null,
    })
    const texto = textoDoArranque({ fase: "a-pedir-autorizacao", versao: "1.0.7" }, "pt")
    expect(texto).toEqual({
      titulo: "O Windows vai pedir autorização para instalar a versão 1.0.7.",
      detalhe: 'Carrega em "Sim" para continuar.',
      progresso: null,
    })
    // Straight quotes and no dashes, like all user-facing text.
    expect(`${texto.titulo}${texto.detalhe}`).not.toMatch(/[«»—–]/)
  })

  it("o código que pinta o ecrã leva os textos escapados", () => {
    const codigo = codigoDoEstado({ fase: "a-descarregar", versao: "1.0.7", recebidos: 1, total: 2 }, "pt")
    expect(codigo).toContain(JSON.stringify("A descarregar a versão 1.0.7"))
    expect(codigo).toContain('"50.0%"')
  })
})

describe("perguntar antes de instalar (1.3.20)", () => {
  /** A question that answers `resposta` and remembers which versions it was asked about. */
  function pergunta(resposta: "instalar" | "mais-tarde"): { perguntar: (versao: string) => Promise<"instalar" | "mais-tarde">; perguntadas: string[] } {
    const perguntadas: string[] = []
    return {
      perguntadas,
      perguntar: async (versao) => {
        perguntadas.push(versao)
        return resposta
      },
    }
  }

  it("por omissão pergunta: sem modo, e com um ficheiro em falta, inválido ou estragado", async () => {
    expect(MODO_POR_OMISSAO).toBe("perguntar")
    for (const texto of [null, "", "{estragado", JSON.stringify({ modo: "sempre" }), JSON.stringify({})]) expect(lerModoGuardado(texto)).toBe("perguntar")
    expect(lerModoGuardado(escreverModo("automaticamente"))).toBe("automaticamente")
    expect(lerModoGuardado(escreverModo("perguntar"))).toBe("perguntar")

    // No mode passed: the startup asks.
    const { buscar } = servidor(assinado())
    const { perguntar, perguntadas } = pergunta("mais-tarde")
    const p = portas(buscar, { perguntar })
    delete (p as Partial<PortasDoArranque>).modo
    await arranqueComActualizacao(p)
    expect(perguntadas).toEqual(["1.0.7"])
  })

  it('"Mais tarde" não descarrega nem executa nada, e entra na versão que tem', async () => {
    const { buscar, pedidos } = servidor(assinado())
    const { perguntar, perguntadas } = pergunta("mais-tarde")
    const p = portas(buscar, { modo: "perguntar", perguntar })
    const resultado = await arranqueComActualizacao(p)
    expect(resultado).toEqual({ accao: "entrar", codigo: "adiada", versao: "1.0.7" })
    expect(perguntadas).toEqual(["1.0.7"])
    // The manifest and the two GitHub checks, and no installer.
    expect(pedidos).toEqual([ENDERECO_DA_ACTUALIZACAO_WINDOWS, enderecoDoManifestoNaRelease("1.0.7"), enderecoDoManifestoNaRelease("1.0.7")])
    expect(p.instalados).toEqual([])
    expect(p.estados.some((e) => e.fase === "a-descarregar")).toBe(false)
  })

  it('"Instalar" segue o caminho de sempre: descarga, SHA-512, e o instalador verificado', async () => {
    const { buscar } = servidor(assinado())
    const { perguntar } = pergunta("instalar")
    const p = portas(buscar, { modo: "perguntar", perguntar })
    const resultado = await arranqueComActualizacao(p)
    expect(resultado).toEqual({ accao: "sair", codigo: "a-instalar", versao: "1.0.7" })
    expect(p.conteudoInstalado).toEqual([INSTALADOR])
  })

  it('"Instalar" numa instalação para todos continua a passar pelo UAC depois da descarga', async () => {
    const { buscar } = servidor(assinado())
    const { perguntar } = pergunta("instalar")
    const pedidosDeUac: string[] = []
    const p = portas(buscar, {
      modo: "perguntar",
      perguntar,
      semAdministrador: () => false,
      instalarComAdministrador: async (caminho): Promise<RespostaDoUac> => {
        pedidosDeUac.push(readFileSync(caminho).equals(INSTALADOR) ? "verificado" : "outro")
        return "aceite"
      },
    })
    expect((await arranqueComActualizacao(p)).accao).toBe("sair")
    expect(pedidosDeUac).toEqual(["verificado"])
  })

  it('"Automaticamente" não pergunta', async () => {
    const { buscar } = servidor(assinado())
    const { perguntar, perguntadas } = pergunta("mais-tarde")
    const p = portas(buscar, { modo: "automaticamente", perguntar })
    expect((await arranqueComActualizacao(p)).accao).toBe("sair")
    expect(perguntadas).toEqual([])
  })

  it("um manifesto com a assinatura errada, de outra chave, nunca chega a perguntar", async () => {
    const { perguntar, perguntadas } = pergunta("instalar")
    for (const manifesto of [assinado({}, OUTRA), { ...assinado(), versao: "9.9.9" }, assinado({ versao: "1.0.6" }), "nada de json"]) {
      const { buscar } = servidor(manifesto)
      const p = portas(buscar, { modo: "perguntar", perguntar })
      const resultado = await arranqueComActualizacao(p)
      expect(resultado.accao).toBe("entrar")
      expect(p.instalados).toEqual([])
    }
    expect(perguntadas).toEqual([])
  })

  it("sem a função que pergunta, perguntar vale como \"Mais tarde\": nada se instala sem resposta", async () => {
    const { buscar, pedidos } = servidor(assinado())
    const p = portas(buscar, { modo: "perguntar" })
    expect(await arranqueComActualizacao(p)).toEqual({ accao: "entrar", codigo: "adiada", versao: "1.0.7" })
    expect(pedidos).toEqual([ENDERECO_DA_ACTUALIZACAO_WINDOWS, enderecoDoManifestoNaRelease("1.0.7"), enderecoDoManifestoNaRelease("1.0.7")])
  })

  it("a pergunta diz a versão, em frases curtas, em português só com a língua escolhida", () => {
    const pt = textosDaPergunta("1.3.21", "pt")
    expect(pt.mensagem).toBe("Há uma versão nova: 1.3.21.")
    expect(pt.botoes).toEqual(["Instalar", "Mais tarde"])
    for (const lingua of ["en", null, "fr"]) expect(textosDaPergunta("1.3.21", lingua).botoes).toEqual(["Install", "Later"])
  })

  it('"adiada" é um código que o registo do arranque aceita', () => {
    expect(lerDiagnosticoDoArranque({ quando: 1, codigo: "adiada", versao: "1.3.21" })).toEqual({ quando: 1, codigo: "adiada", versao: "1.3.21" })
  })
})

describe("público, e visto por este aparelho há tempo bastante (1.3.20, revisão C2, opção A)", () => {
  const HORA = 3_600_000
  const T0 = Date.parse("2026-11-20T12:00:00Z")

  /**
   * One startup in "Ask first", at `t`, with this device's record `vista`.
   * Says the code, whether it asked, whether it installed, and the record after.
   */
  async function arrancar(
    manifesto: ManifestoWindows,
    t: number,
    vista: ReturnType<typeof memoria>,
    opcoes: Parameters<typeof servidor>[1] = {},
    modo: "perguntar" | "automaticamente" = "perguntar",
  ): Promise<{ codigo: string; perguntou: boolean; instalou: boolean; pedidos: string[]; instalaEm?: number }> {
    const { buscar, pedidos } = servidor(manifesto, opcoes)
    let perguntou = false
    const p = portas(buscar, {
      modo,
      agora: () => t,
      vista,
      perguntar: async () => {
        perguntou = true
        return "instalar"
      },
    })
    const r = await arranqueComActualizacao(p)
    return {
      codigo: r.codigo,
      perguntou,
      instalou: p.instalados.length > 0,
      pedidos,
      ...(r.accao === "entrar" && r.instalaEm !== undefined ? { instalaEm: r.instalaEm } : {}),
    }
  }

  const hashDe = (m: ManifestoWindows): string => createHash("sha256").update(JSON.stringify(m, null, 2) + "\n").digest("hex")

  it("a primeira vista regista o manifesto e não pergunta nem instala", async () => {
    const m = assinado()
    const vista = memoria(null)
    const r = await arrancar(m, T0, vista)
    expect(r).toMatchObject({ codigo: "em-espera", perguntou: false, instalou: false, instalaEm: T0 + 72 * HORA })
    expect(vista.atual()).toEqual({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    // Only GitHub's own address, never the API.
    expect(r.pedidos).toEqual([ENDERECO_DA_ACTUALIZACAO_WINDOWS, enderecoDoManifestoNaRelease("1.0.7")])
    expect(r.pedidos.some((u) => u.includes("api.github.com"))).toBe(false)
  })

  it("71 h depois não pergunta; 72 h depois pergunta e instala", async () => {
    const m = assinado()
    const vista = memoria({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    expect(await arrancar(m, T0 + 71 * HORA, vista)).toMatchObject({ codigo: "em-espera", perguntou: false, instalou: false })
    expect(await arrancar(m, T0 + 72 * HORA, vista)).toMatchObject({ codigo: "a-instalar", perguntou: true, instalou: true })
  })

  it("a espera vale também em \"Automaticamente\"", async () => {
    const m = assinado()
    const vista = memoria({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    expect(await arrancar(m, T0 + 71 * HORA, vista, {}, "automaticamente")).toMatchObject({ codigo: "em-espera", instalou: false })
    expect(await arrancar(m, T0 + 72 * HORA, vista, {}, "automaticamente")).toMatchObject({ codigo: "a-instalar", instalou: true })
  })

  it("urgente: 23 h não, 24 h sim, e nunca menos", async () => {
    const m = assinado({ urgente: true })
    const vista = memoria({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    expect(await arrancar(m, T0 + 23 * HORA, vista)).toMatchObject({ codigo: "em-espera", perguntou: false })
    expect(await arrancar(m, T0 + 24 * HORA, vista)).toMatchObject({ codigo: "a-instalar", perguntou: true })
    // The first sight of an urgent one: 24 h from now, not less.
    const nova = memoria(null)
    expect(await arrancar(m, T0, nova)).toMatchObject({ codigo: "em-espera", instalaEm: T0 + 24 * HORA })
  })

  it("um hash trocado recomeça a espera do zero", async () => {
    const antigo = assinado()
    const vista = memoria({ versao: "1.0.7", hash: hashDe(antigo), vistoEm: T0 })
    // Another manifest of the same version, signed, now on both sides.
    const trocado = assinado({ sha512: "b".repeat(128) })
    const r = await arrancar(trocado, T0 + 100 * HORA, vista)
    expect(r).toMatchObject({ codigo: "em-espera", perguntou: false, instalou: false, instalaEm: T0 + 100 * HORA + 72 * HORA })
    expect(vista.atual()).toEqual({ versao: "1.0.7", hash: hashDe(trocado), vistoEm: T0 + 100 * HORA })
  })

  it("desaparecido do GitHub antes de instalar: não instala, e a espera recomeça", async () => {
    const m = assinado()
    const vista = memoria({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    // The first fetch of the startup finds it; the one right before installing does not.
    const r = await arrancar(m, T0 + 80 * HORA, vista, { noGithub: (n) => (n === 0 ? undefined! : null) })
    expect(r).toMatchObject({ codigo: "transparencia-em-falta", perguntou: false, instalou: false })
    expect(vista.atual()).toBeNull()
  })

  it("diferente no GitHub do que o orwell.pt serve: nada, e o registo apaga-se", async () => {
    const m = assinado()
    const vista = memoria({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    const r = await arrancar(m, T0 + 80 * HORA, vista, { noGithub: JSON.stringify(m, null, 2) + "\n " })
    expect(r).toMatchObject({ codigo: "transparencia-diferente", perguntou: false, instalou: false })
    expect(vista.atual()).toBeNull()
  })

  it("um relógio que andou para trás do registo recomeça", async () => {
    const m = assinado()
    const vista = memoria({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    const r = await arrancar(m, T0 - HORA, vista)
    expect(r).toMatchObject({ codigo: "em-espera", perguntou: false, instalou: false })
    expect(vista.atual()?.vistoEm).toBe(T0 - HORA)
  })

  it("um registo inválido vale como nunca visto", () => {
    const bom = escreverVista({ versao: "1.0.7", hash: "a".repeat(64), vistoEm: T0 })
    expect(lerVista(bom)).toEqual({ versao: "1.0.7", hash: "a".repeat(64), vistoEm: T0 })
    for (const mau of [
      null,
      "",
      "{estragado",
      JSON.stringify({ versao: "1.0", hash: "a".repeat(64), vistoEm: T0 }),
      JSON.stringify({ versao: "1.0.7", hash: "xyz", vistoEm: T0 }),
      JSON.stringify({ versao: "1.0.7", hash: "a".repeat(64), vistoEm: "ontem" }),
      JSON.stringify({ versao: "1.0.7", hash: "a".repeat(64), vistoEm: -5 }),
    ]) {
      expect(lerVista(mau)).toBeNull()
    }
  })

  it("com o GitHub em baixo ou sem rede, arranca a versão que tem, com código, e o registo fica", async () => {
    const m = assinado()
    const registo = { versao: "1.0.7", hash: hashDe(m), vistoEm: T0 }
    for (const noGithub of ["em-baixo", "sem-rede"] as const) {
      const vista = memoria(registo)
      const r = await arrancar(m, T0 + 80 * HORA, vista, { noGithub })
      expect(r).toMatchObject({ codigo: "transparencia-inacessivel", perguntou: false, instalou: false })
      expect(vista.atual()).toEqual(registo)
    }
  })

  it("um manifesto no GitHub maior do que o tecto não se lê inteiro, e não passa", async () => {
    const m = assinado()
    const vista = memoria({ versao: "1.0.7", hash: hashDe(m), vistoEm: T0 })
    const r = await arrancar(m, T0 + 80 * HORA, vista, { noGithub: "x".repeat(40_000) })
    expect(r).toMatchObject({ codigo: "transparencia-diferente", instalou: false })
  })

  it("o servidor não pode marcar urgente: o campo é assinado", async () => {
    const r = await arrancar({ ...assinado(), urgente: true } as ManifestoWindows, T0, memoria(null))
    expect(r).toMatchObject({ codigo: "assinatura-errada", perguntou: false, instalou: false })
    expect(assinaturaValida(lerManifestoWindows(assinado())!, PUBLICA)).toBe(true)
  })

  it("um manifesto do orwell.pt com bytes que não são UTF-8 é recusado", async () => {
    const { buscar } = servidor(assinado())
    const estragado = (async (url: string, init?: RequestInit) =>
      url === ENDERECO_DA_ACTUALIZACAO_WINDOWS ? new Response(new Uint8Array([0x7b, 0xff, 0x7d])) : buscar(url, init)) as typeof fetch
    expect((await arranqueComActualizacao(portas(estragado))).codigo).toBe("manifesto-recusado")
  })

  it("o em-espera chega ao diagnóstico com a data, para o aviso no login", () => {
    expect(lerDiagnosticoDoArranque({ quando: 1, codigo: "em-espera", versao: "1.0.7", instalaEm: T0 })).toEqual({
      quando: 1,
      codigo: "em-espera",
      versao: "1.0.7",
      instalaEm: T0,
    })
  })
})

describe("o instalador verificado é o que corre (revisão M5)", () => {
  it.each([
    ["para todos, antes do UAC", false, "a-pedir-autorizacao"],
    ["por utilizador, antes de correr", true, "a-instalar"],
  ] as const)("trocado na pasta temporária depois de verificado (%s): não corre", async (_nome, semAdministrador, fase) => {
    const { buscar } = servidor(assinado())
    const corridos: string[] = []
    const p = portas(buscar, {
      semAdministrador: () => semAdministrador,
      // Another program of the same user swaps the file while the screen says what comes next.
      mostrar: (estado) => {
        if (estado.fase === fase) writeFileSync(join(p.pasta, NOME), "MZ outro programa")
      },
      instalar: async (caminho) => {
        corridos.push(caminho)
      },
      instalarComAdministrador: async (caminho): Promise<RespostaDoUac> => {
        corridos.push(caminho)
        return "aceite"
      },
    })
    const r = await arranqueComActualizacao(p)
    expect(r).toEqual({ accao: "entrar", codigo: "soma-errada", versao: "1.0.7" })
    expect(corridos).toEqual([])
  })
})
