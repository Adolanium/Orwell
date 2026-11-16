import { open, rename, rm, stat, type FileHandle } from "node:fs/promises"
import { formaDoFicheiroDeConta, type FonteDeBytes } from "@enclave/client-core"

/**
 * The account file with the images on the desktop (Task 11b, design §9 B).
 * It can be hundreds of MB: the main process writes it itself, in parts, where
 * the person chose, and reads it by offset on import. It never crosses the IPC
 * whole and is never whole in memory.
 */

/**
 * Writes the parts in order to a `.parcial` next to it, and only at the end
 * moves it into place: a part that fails (a blob that broke halfway) does not
 * leave a truncated file under the right name, nor damage what was there.
 */
export async function gravarPorPartes(caminho: string, partes: AsyncIterable<Uint8Array>): Promise<void> {
  const parcial = `${caminho}.parcial`
  const ficheiro = await open(parcial, "w")
  try {
    for await (const parte of partes) await ficheiro.write(parte)
    await ficheiro.sync()
  } catch (erro) {
    await ficheiro.close().catch(() => {})
    await rm(parcial, { force: true })
    throw erro
  }
  await ficheiro.close()
  await rename(parcial, caminho)
}

/**
 * A `FonteDeBytes` over a file on disk, read by offset. Whoever opens it closes
 * it. Regular files only: the `stat` comes before the `open`, because opening a
 * FIFO for reading waits forever. Any failure (missing, no permission, a
 * folder) gives the same sentence, the one for a file that is not an account
 * file: the screen never tells the cases apart.
 */
export async function abrirFonteDoFicheiro(caminho: string): Promise<{ fonte: FonteDeBytes; fechar: () => Promise<void> }> {
  let aberto: FileHandle | undefined
  let size: number
  try {
    if (!(await stat(caminho)).isFile()) throw new Error("this is not an enclave account file")
    aberto = await open(caminho, "r")
    size = (await aberto.stat()).size
  } catch {
    await aberto?.close().catch(() => {})
    throw new Error("this is not an enclave account file")
  }
  const ficheiro = aberto
  const fonte: FonteDeBytes = {
    tamanho: size,
    ler: async (inicio, fim) => {
      const quantos = Math.max(0, Math.min(fim, size) - inicio)
      const destino = new Uint8Array(quantos)
      let lidos = 0
      while (lidos < quantos) {
        const { bytesRead } = await ficheiro.read(destino, lidos, quantos - lidos, inicio + lidos)
        if (bytesRead === 0) break
        lidos += bytesRead
      }
      return destino.subarray(0, lidos)
    },
  }
  return { fonte, fechar: () => ficheiro.close() }
}

/** The shape of the file the main process chose (`formaDoFicheiroDeConta`). Never throws. */
export async function formaDoFicheiroNoDisco(caminho: string): Promise<"conta" | "beta" | "outro"> {
  let aberto: Awaited<ReturnType<typeof abrirFonteDoFicheiro>>
  try {
    aberto = await abrirFonteDoFicheiro(caminho)
  } catch {
    return "outro"
  }
  try {
    return await formaDoFicheiroDeConta(aberto.fonte)
  } finally {
    await aberto.fechar().catch(() => {})
  }
}
