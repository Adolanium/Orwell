/**
 * Which installers get published, and what stops them from lying.
 *
 * All of this used to live inside `publicar-instaladores.mjs`, tangled with `readdir`, `scp`, and page writing. It came out here for the reason that always applies in this house: the decision is measurable and the rest is I/O. There is no file system here, takes in a list of descriptions, returns the list of what publishes and the list of what is refused, and so there is a test that exercises it (`apps/site/testes/instaladores.test.ts`).
 *
 * ## The fault this exists to catch
 *
 * The downloads page is generated, and the big number at the top comes from the root `package.json`. That guarantees the page does not invent a version. It guaranteed nothing about the FILES it offers: the names came from a `readdir` of the working folder, picked by `mtime`, and no one compared the number inside the name with the number at the top.
 *
 * The result, when someone skips `npm run build -w @enclave/client` and `electron-builder`, which are the two slow steps, and thus the two skipped: the page said **Version 0.2.0** above a button that downloaded `Orwell-0.1.0-macos-universal.dmg`. A page lying with the right number.
 *
 * And it is the worst form of this fault, because no auto-update after can fix it: whoever downloads gets 0.1.0 and stays with it.
 *
 * **The rule, and it is harsh on purpose: an installer whose name does not carry the root version does not publish.** It does not warn and publish anyway. The entire publication stops, because publishing half, the new macOS, the old Windows, is the same fault with fewer people hitting it.
 */
import { createHash } from "node:crypto"

/**
 * The version an installer name announces, or `undefined` if it announces none.
 *
 * The name is written by `artifactName` of `electron-builder.yml`, today
 * `${productName}-${version}-<sistema>-${arch}.${ext}`, `Orwell-0.2.0-macos-universal.dmg`.
 *
 * Read by PATTERN and not by the product: we search for a trio of numbers
 * between hyphens, not `Orwell-`. The product name changed once, and a reader that
 * requires it would return `undefined` on the day of the rename, which, with the
 * guard below, would stop the entire release because of a legitimate rename.
 *
 * `undefined` and not an empty string: "I don't know" and "it says it is the empty
 * version" are different answers, and the caller treats them differently.
 */
export function versaoDoNome(nome) {
  return /-(\d+\.\d+\.\d+)-/.exec(nome)?.[1]
}

/**
 * What publishes, what stays out, and what stops everything.
 *
 * Three answers not one, because these are three different things:
 *
 *  - `publicar`: one per system, the newest by `mtime`.
 *  - `deFora`: older builds of the same system. Normal, and said out loud the same way, an installer silently discarded is indistinguishable from one never built. On August 13, 2026 the folder held four, two with the wrong icon, and the page offered all four.
 *  - `divergentes`: those announcing a version that is not the root's. **This is not a warning, it is a stop.** See the note at the top.
 *
 * The newest is picked by modification date not by name: the names changed once already, and what you want to publish is always the build just finished. The version check is on the name, because the name goes on the page and on the URL people copy.
 *
 * @param {{nome: string, sistema: string, modificado: number}[]} encontrados
 * @param {string} versaoEsperada the root's, the one the page announces
 */
export function escolherInstaladores(encontrados, versaoEsperada) {
  const porSistema = new Map()
  for (const ficheiro of encontrados) {
    const anterior = porSistema.get(ficheiro.sistema)
    if (!anterior || ficheiro.modificado > anterior.modificado) porSistema.set(ficheiro.sistema, ficheiro)
  }

  const escolhidos = [...porSistema.values()]
  const nomesEscolhidos = new Set(escolhidos.map((f) => f.nome))

  const deFora = encontrados
    .filter((f) => !nomesEscolhidos.has(f.nome))
    .map((f) => ({ nome: f.nome, porque: `há um ${f.sistema} mais recente` }))

  /*
    Only the CHOSEN are measured against the version.
    
    An old installer in the working folder is the normal case, it is what was left from the last publication, and making publication stop because of it would require cleaning the folder before each run. What cannot pass is an old one being PUBLISHED, and that is always one of the chosen.
    */
  const divergentes = escolhidos
    .map((f) => ({ nome: f.nome, versao: versaoDoNome(f.nome) }))
    .filter(({ versao }) => versao !== versaoEsperada)

  return { publicar: escolhidos, deFora, divergentes }
}

/**
 * What the installed application reads to know it is behind.
 *
 * Written by the same act that publishes installers and the page, from the same files, and that is the only reason it cannot diverge from them: there is no number here that anyone has to remember to bump. A publication that runs leaves the manifest right; one that does not leaves no new manifest, and the application keeps seeing the previous version, which is the truth.
 *
 * **There is no address here, and the absence is the design.** It used to have a `descargas` field with the production page, out of courtesy for whoever opened the file by hand. It came out for two reasons pointing to the same place:
 *
 *  - **nothing read it.** The application has its own address written in code (`ENDERECO_DAS_DESCARGAS`, in `apps/client/src/main/actualizacao.ts`), and a field no one reads in a security artifact is worse than useless: it looks authoritative, and one day someone hooks it up. A manifest that chose where to send its readers was phishing served over HTTPS from our own domain, open to anyone who gained write access to that folder;
 *  - **`guioes.producao.test.ts` refuses for a script to name production in code**, and refuses it because of two real data losses in August 2026. The right fix was to remove the field, not add an exception to the lock.
 *
 * **The checksums go here for the same reason they go on the page**: they are the only defense this product has against a tampered file, because installers are not signed. See the header of `electron-builder.yml`.
 *
 * @param {{version: string, nomeDaVersao: string}} raiz
 * @param {{nome: string, sistema: string, bytes: number, soma: string}[]} ficheiros
 */
export function manifestoDeVersao(raiz, ficheiros) {
  return {
    versao: raiz.version,
    nome: raiz.nomeDaVersao,
    ficheiros: ficheiros.map((f) => ({
      sistema: f.sistema,
      nome: f.nome,
      bytes: f.bytes,
      soma: f.soma,
    })),
  }
}

/**
 * The prefix of what is signed. Separates THIS signature from any other the same key might make one day: a signature taken from another context does not pass through an update. The `v1` changes if the message form changes.
 *
 * Written twice, here and in `apps/client/src/main/actualizacao-windows.ts` (the application does not import scripts). The test `actualizacao-windows.test.ts` signs with this function and verifies with the application's: if the two diverge, it fails.
 */
export const PREFIXO_DA_ASSINATURA_WINDOWS = "orwell-actualizacao-windows-v1"

/**
 * The message that the private key signs: the version, the name, the size, and the SHA-512 of the installer, one per line.
 *
 * The four fields not just the checksum, because each closes a door:
 *  - the version stops an old, well-signed installer from being served with a new number on top (and the application only accepts higher versions);
 *  - the size makes the download stop at the first extra byte;
 *  - the checksum ties the signature to that file and no other.
 *
 * And, only on an urgent fix, a fifth line `urgente=1` (1.3.20): the app then
 * waits 24 hours after the public release instead of 72. Signed, so the server
 * cannot add it; absent on every other manifest, so their message is unchanged.
 *
 * @param {{versao: string, ficheiro: string, bytes: number, sha512: string, urgente?: boolean}} campos
 */
export function mensagemDaActualizacaoWindows({ versao, ficheiro, bytes, sha512, urgente }) {
  const linhas = [PREFIXO_DA_ASSINATURA_WINDOWS, `versao=${versao}`, `ficheiro=${ficheiro}`, `bytes=${bytes}`, `sha512=${sha512}`]
  if (urgente) linhas.push("urgente=1")
  return linhas.join("\n")
}

/**
 * The Windows auto-update manifest, signed.
 *
 * This is the file the installed application reads at startup (`actualizacao-windows.json`). The signature is Ed25519, with the update key (`scripts/gerar-chave-de-actualizacoes.mjs`), and covers everything the application uses to decide. A field changed on the server makes the signature wrong, and the application enters the version it has.
 *
 * @param {string} versao
 * @param {{nome: string, bytes: number, sha512: string}} ficheiro
 * @param {(mensagem: Buffer) => Buffer} assinar who has the private key; taken as a parameter so this stays without disk or keys inside
 * @param {{urgente?: boolean}} [opcoes] `urgente`: the 24-hour wait instead of 72 (see the app)
 */
export function manifestoDeActualizacaoWindows(versao, ficheiro, assinar, opcoes = {}) {
  const campos = { versao, ficheiro: ficheiro.nome, bytes: ficheiro.bytes, sha512: ficheiro.sha512, ...(opcoes.urgente ? { urgente: true } : {}) }
  const assinatura = assinar(Buffer.from(mensagemDaActualizacaoWindows(campos), "utf8")).toString("base64")
  return { ...campos, assinatura }
}

/**
 * The public GitHub release, with the signed manifest and the installers'
 * SHA-256 sums in it (1.3.20).
 *
 * The installed Windows app installs a manifest only if it finds the same
 * bytes as the asset `actualizacao-windows.json` of the release `v<version>`,
 * and only after this device has seen it there for 72 hours (24 if urgent).
 * The release also carries the sums of the installers (`somas-sha256.txt`):
 * whoever downloads from the site checks them against GitHub, not against the
 * server that served the file (review I1).
 *
 * The repository has IMMUTABLE releases (on since 18/11/2026): once a release
 * is published, its assets cannot be added, changed or deleted, and its tag
 * is locked (GitHub docs, "Immutable releases"; title and notes stay
 * editable). So the order is GitHub's: a DRAFT, the assets in it, publish.
 *
 * - The repository setting must be on, before publishing; and the release
 *   must come out `immutable`, after (review C1). A setting switched off by
 *   mistake would otherwise publish a release that can still be swapped.
 * - The draft must point at the expected commit (`alvo`, the public copy of
 *   this version, created with `--target <sha>`), and after publishing the
 *   tag must be there (review I2): with immutable releases there is no fix.
 * - No release: refuse. The draft, with its notes in English, is written by a
 *   person.
 * - A draft: put the assets in (replacing ones that differ: nothing is public
 *   yet), then publish it.
 * - Already published: the assets must already be there and be these files.
 * - Then read both back from the PUBLIC addresses, as the app does, and compare.
 *
 * I/O comes in as parameters (`gh` runs the GitHub CLI and returns stdout,
 * `buscar` is fetch), so the decision is tested without network.
 *
 * @param {{tag: string, repositorio: string, alvo: string,
 *   ficheiros: {nome: string, caminho: string, bytes: Uint8Array}[],
 *   gh: (argumentos: string[]) => Promise<string>, buscar: typeof fetch}} p
 * @returns {Promise<{ok: true, publicouAgora: boolean} | {ok: false, porque: string}>}
 */
export async function publicarManifestoNaRelease({ tag, repositorio, alvo, ficheiros, gh, buscar }) {
  const soma = (b) => createHash("sha256").update(b).digest("hex")
  const ver = async () =>
    JSON.parse(await gh(["release", "view", tag, "--repo", repositorio, "--json", "isDraft,publishedAt,assets,targetCommitish"]))
  const api = async (caminho) => JSON.parse(await gh(["api", caminho]))

  let release
  try {
    release = await ver()
  } catch {
    return {
      ok: false,
      porque: `Não há release ${tag} em ${repositorio}. Envia primeiro a cópia pública, e cria o rascunho com as notas em inglês: gh release create ${tag} --draft --target <sha da cópia pública> --repo ${repositorio} --notes-file <notas>`,
    }
  }
  const nomes = ficheiros.map((f) => f.nome)
  const temTodos = (r) => nomes.every((nome) => (r.assets ?? []).some((a) => a.name === nome))

  let publicouAgora = false
  if (release.isDraft) {
    if (release.targetCommitish !== alvo) {
      return { ok: false, porque: `O rascunho ${tag} aponta para ${release.targetCommitish}, e não para ${alvo}. Corrige o rascunho (--target) antes de publicar: depois já não se muda.` }
    }
    // A tag that already exists must already be the expected commit (review N4):
    // found only after publishing, the version would be spent on a release
    // that can never be fixed. An annotated tag is refused too.
    const tagAntes = await api(`repos/${repositorio}/git/ref/tags/${tag}`).catch(() => null)
    if (tagAntes && (tagAntes.object?.type !== "commit" || tagAntes.object.sha !== alvo)) {
      return { ok: false, porque: `A tag ${tag} já existe e não é o commit ${alvo}. Nada foi publicado: corrige ou apaga a tag (ainda sem release publicada), e repete.` }
    }
    const definicao = await api(`repos/${repositorio}/immutable-releases`).catch(() => null)
    if (definicao?.enabled !== true) {
      return { ok: false, porque: `As releases imutáveis estão desligadas em ${repositorio}. Liga-as antes de publicar.` }
    }
    // Not public yet: the assets can go in, or be replaced, as many times as needed.
    for (const f of ficheiros) await gh(["release", "upload", tag, f.caminho, "--repo", repositorio, "--clobber"])
    await gh(["release", "edit", tag, "--repo", repositorio, "--draft=false"])
    publicouAgora = true
    release = await ver()
    if (release.isDraft || !release.publishedAt) return { ok: false, porque: `A release ${tag} não ficou publicada.` }
  } else if (!temTodos(release)) {
    return {
      ok: false,
      porque: `A release ${tag} já está publicada e é imutável, sem ${nomes.join(" e ")}. Já não se lhe juntam ficheiros: publica uma versão nova.`,
    }
  }

  // Published: immutable, and its tag on the expected commit.
  const publicada = await api(`repos/${repositorio}/releases/tags/${tag}`).catch(() => null)
  if (publicada?.immutable !== true) {
    return { ok: false, porque: `A release ${tag} saiu sem ser imutável. As apps ainda a aceitariam trocada: não envies nada, e liga as releases imutáveis.` }
  }
  const ref = await api(`repos/${repositorio}/git/ref/tags/${tag}`).catch(() => null)
  if (ref?.object?.type !== "commit" || ref.object.sha !== alvo) {
    return { ok: false, porque: `A tag ${tag} não aponta para o commit ${alvo}.` }
  }

  for (const f of ficheiros) {
    const resposta = await buscar(`https://github.com/${repositorio}/releases/download/${tag}/${f.nome}`, { cache: "no-store" })
    if (!resposta.ok) return { ok: false, porque: `O ${f.nome} da release ${tag} não se lê pelo endereço público (${resposta.status}).` }
    const lido = new Uint8Array(await resposta.arrayBuffer())
    if (soma(lido) !== soma(f.bytes)) {
      return {
        ok: false,
        porque: `O ${f.nome} da release ${tag} não é o que acabou de ser feito.${publicouAgora ? "" : " A release é imutável: publica uma versão nova."}`,
      }
    }
  }
  return { ok: true, publicouAgora }
}

/** The installers' SHA-256 sums, one line each, as `sha256sum` writes them. */
export function textoDasSomas(ficheiros) {
  return ficheiros.map((f) => `${f.soma}  ${f.nome}\n`).join("")
}

/**
 * The installers rebuilt after their version was published (review M8): their
 * sums no longer match the public, immutable ones, so the version is burnt.
 *
 * @param {Record<string, string> | null} publicadas name -> SHA-256, as published
 * @param {{nome: string, soma: string}[]} ficheiros the installers now on disk
 */
export function instaladoresMudados(publicadas, ficheiros) {
  if (!publicadas) return []
  return ficheiros.filter((f) => publicadas[f.nome] !== undefined && publicadas[f.nome] !== f.soma)
}

/**
 * At least 72 hours between two Windows versions, unless urgent (review N3).
 *
 * The VPS serves only the latest manifest, and a new version restarts every
 * device's wait: the previous one never installs. Published every two days,
 * Windows would never update by itself. The web does not pass through here.
 *
 * @param {{anterior: {tag: string, publicadaEm: string} | null, agora: number, urgente: boolean, forcar: boolean}} p
 * @returns {{ok: true} | {ok: false, porque: string}}
 */
export function cadenciaDoWindows({ anterior, agora, urgente, forcar }) {
  if (!anterior || urgente || forcar) return { ok: true }
  const horas = (agora - Date.parse(anterior.publicadaEm)) / 3_600_000
  if (!Number.isFinite(horas) || horas >= 72) return { ok: true }
  return {
    ok: false,
    porque: `A ${anterior.tag} saiu há ${Math.floor(horas)} h. Entre duas versões do Windows passam pelo menos 72 h, senão a espera recomeça em todos os aparelhos e a ${anterior.tag} nunca se instala. Espera, ou usa --urgente, ou --forcar-cadencia se sabes o que custa.`,
  }
}
