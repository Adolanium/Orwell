import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

export type DestinoDeConversa = { canal: string; nome: string } & (
  | { tipo: "comunidade" | "directa" }
  | { tipo: "texto" | "voz"; sala: string; categoria: string; comunidade: string }
)

export function chaveDoDestino(destino: DestinoDeConversa): string {
  return JSON.stringify([destino.canal, "sala" in destino ? destino.sala : null])
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim()
}

export function MudarDeConversa({ destinos, recentes, onEscolher, onFechar }: {
  destinos: readonly DestinoDeConversa[]
  recentes: readonly string[]
  onEscolher: (destino: DestinoDeConversa) => void
  onFechar: () => void
}): React.JSX.Element {
  const tituloId = useId()
  const listaId = useId()
  const [pesquisa, setPesquisa] = useState("")
  const [indice, setIndice] = useState(0)
  const consulta = normalizar(pesquisa)
  const termos = consulta.split(/\s+/)
  const resultados = destinos.flatMap((destino) => {
    const nome = normalizar(destino.nome)
    const onde = "comunidade" in destino ? normalizar(`${destino.comunidade} ${destino.categoria}`) : ""
    if (!termos.every((termo) => nome.includes(termo) || onde.includes(termo))) return []
    const recente = recentes.indexOf(chaveDoDestino(destino))
    return [{ destino, ordem: recente === -1 ? recentes.length : recente, inicio: nome.startsWith(consulta) }]
  }).sort((a, b) => Number(b.inicio) - Number(a.inicio) || a.ordem - b.ordem).slice(0, 15)
  const actual = Math.min(indice, resultados.length - 1)

  return (
    <Modal className="sheet mudar-de-conversa" labelledBy={tituloId} onClose={onFechar}>
      <header className="sheet-header">
        <h2 id={tituloId}>{strings.mudarDeConversa.titulo}</h2>
      </header>
      <div className="sheet-body">
        <input
          className="field"
          type="text"
          role="combobox"
          aria-label={strings.mudarDeConversa.campo}
          aria-controls={listaId}
          aria-expanded={resultados.length > 0}
          aria-autocomplete="list"
          aria-activedescendant={actual >= 0 ? `${listaId}-${actual}` : undefined}
          placeholder={strings.mudarDeConversa.campo}
          value={pesquisa}
          onChange={(evento) => { setPesquisa(evento.currentTarget.value); setIndice(0) }}
          onKeyDown={(evento) => {
            if (evento.nativeEvent.isComposing || resultados.length === 0) return
            if (evento.key === "Enter") {
              evento.preventDefault()
              const entrada = resultados[actual]
              if (entrada) onEscolher(entrada.destino)
            } else if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
              evento.preventDefault()
              const direccao = evento.key === "ArrowDown" ? 1 : -1
              const proximo = (actual + direccao + resultados.length) % resultados.length
              setIndice(proximo)
              document.getElementById(`${listaId}-${proximo}`)?.scrollIntoView?.({ block: "nearest" })
            }
          }}
        />
        <ul id={listaId} className="mudar-de-conversa-lista" role="listbox" aria-label={strings.mudarDeConversa.resultados}>
          {resultados.map(({ destino }, posicao) => (
            <li
              key={chaveDoDestino(destino)}
              id={`${listaId}-${posicao}`}
              role="option"
              aria-selected={posicao === actual}
              onClick={() => onEscolher(destino)}
            >
              <span>{destino.nome}</span>
              <small>{[strings.mudarDeConversa.tipo[destino.tipo], "comunidade" in destino ? destino.comunidade : ""].filter(Boolean).join(" · ")}</small>
            </li>
          ))}
        </ul>
        {resultados.length === 0 && <p className="field-note" role="status">{strings.mudarDeConversa.vazio}</p>}
      </div>
      <div className="sheet-actions"><Button variant="ghost" onClick={onFechar}>{strings.common.close}</Button></div>
    </Modal>
  )
}
