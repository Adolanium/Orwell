import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { strings, traduzirErro } from "../../strings.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import type { Votacao } from "../../lib/votacoes.js"

/**
 * How many options fit, and how much space each gets.
 *
 * The same numbers from the `Poll` schema in the protocol, and they cannot
 * differ: an option longer than the schema accepts is a poll that the `catch`
 * throws away on the other side, and the writer would never know why. This is
 * where we refuse it, because this is where there is a person to tell.
 */
const OPCOES_MAX = 10
const OPCAO_MAX_LETRAS = 120
const PERGUNTA_MAX_LETRAS = 300

/** The longest deadline. A year-long poll is a petition, and a timer that long loses meaning. */
const PRAZO_MAX_DIAS = 30

type PrazoPedido = { ok: true; em: number | null } | { ok: false; motivo: "vazio" | "passado" | "longo" }

/**
 * The closing instant the form asks for, or why it is not one.
 *
 * Exported for the test: this is the part of the form that can be wrong without anyone
 * noticing. `datetime-local` has no zone, and `new Date("2026-11-20T18:00")` reads it in
 * the zone of this device, which is what the person typed.
 */
export function fechoPedido(
  modo: "duracao" | "data" | "sem",
  duracao: string,
  unidade: "h" | "d",
  data: string,
  agora: number = Date.now(),
): PrazoPedido {
  if (modo === "sem") return { ok: true, em: null }
  let em: number
  if (modo === "duracao") {
    const quanto = Number(duracao)
    if (duracao.trim() === "" || !Number.isFinite(quanto)) return { ok: false, motivo: "vazio" }
    if (quanto <= 0) return { ok: false, motivo: "passado" }
    em = agora + quanto * (unidade === "h" ? 3_600_000 : 86_400_000)
  } else {
    if (data === "") return { ok: false, motivo: "vazio" }
    em = new Date(data).getTime()
    if (!Number.isFinite(em)) return { ok: false, motivo: "vazio" }
  }
  if (em <= agora) return { ok: false, motivo: "passado" }
  if (em > agora + PRAZO_MAX_DIAS * 86_400_000) return { ok: false, motivo: "longo" }
  return { ok: true, em: Math.round(em) }
}

/** Two: a question with one answer is not a question. */
const OPCOES_INICIAIS = ["", ""]

/**
 * Create a poll, in a chat or on a board.
 *
 * The same form in both places: what comes out of here is the same structure,
 * and the caller decides whether it travels inside a message or a post.
 *
 * **The note at the end is not decoration, and it is why this form exists
 * instead of a text box.** It says the two things the creator must know before
 * creating, and both are design decisions, not accidents:
 *
 * 1. **Votes are visible.** In an end-to-end encrypted channel, everyone there
 *    decrypts everything the channel says. A vote that travels the same path is
 *    secret from the server and from no one else. Promising a secret vote was
 *    promising what encryption does not give.
 * 2. **The deadline is set here, by the creator.** No shared clock exists, so the
 *    count never depends on one: a vote counts by its own timestamp against the
 *    deadline (`votosDe`). The poll can also be closed earlier, by its author or
 *    a moderator, from the message menu.
 *
 * The button only wakes up with a question and two written options, and that
 * is why the poll that comes out of here is always one the schema accepts.
 */
export function NovaVotacao({
  onSubmit,
  onCancel,
}: {
  onSubmit: (votacao: Votacao) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const heading = useId()
  const [pergunta, setPergunta] = useState("")
  const [opcoes, setOpcoes] = useState<string[]>(OPCOES_INICIAIS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** How the deadline is given: for how long, until when, or none. A day is the start. */
  const [prazo, setPrazo] = useState<"duracao" | "data" | "sem">("duracao")
  const [duracao, setDuracao] = useState("1")
  const [unidade, setUnidade] = useState<"h" | "d">("d")
  const [data, setData] = useState("")

  /** The ones that are actually written. This list travels, not the fields. */
  const escritas = opcoes.map((opcao) => opcao.trim()).filter((opcao) => opcao !== "")
  const prazoEm = fechoPedido(prazo, duracao, unidade, data)
  const pronta = pergunta.trim() !== "" && escritas.length >= 2 && prazoEm.ok

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    // Without this the browser navigates and reloads the page mid-send. See
    // `NewRoom`, where the same line cost an afternoon.
    event.preventDefault()
    if (busy || !pronta) return
    setBusy(true)
    setError(null)
    void onSubmit({
      question: pergunta.trim(),
      options: escritas,
      ...(prazoEm.ok && prazoEm.em !== null ? { closesAt: prazoEm.em } : {}),
    }).catch((cause: Error) => {
      setBusy(false)
      setError(traduzirErro(cause))
    })
  }

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onCancel} onSubmit={submit}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.votacao.titulo}</h2>
      </header>

      <div className="sheet-body">
        <Field label={strings.votacao.perguntaLabel}>
          <input
            value={pergunta}
            onChange={(event) => setPergunta(event.target.value)}
            maxLength={PERGUNTA_MAX_LETRAS}
            placeholder={strings.votacao.perguntaPlaceholder}
            autoFocus
          />
        </Field>

        <ul className="nova-votacao-opcoes">
          {opcoes.map((opcao, indice) => (
            <li key={indice} className="nova-votacao-opcao">
              <Field label={strings.votacao.opcaoLabel(indice + 1)}>
                <input
                  value={opcao}
                  onChange={(event) =>
                    setOpcoes((atuais) => atuais.map((item, i) => (i === indice ? event.target.value : item)))
                  }
                  maxLength={OPCAO_MAX_LETRAS}
                  placeholder={strings.votacao.opcaoPlaceholder}
                />
              </Field>
              {/* Remove only exists above the two: below that there is no poll,
                  and a button that always refuses is worse than none. */}
              {opcoes.length > OPCOES_INICIAIS.length && (
                <Button
                  type="button"
                  variant="ghost"
                  ariaLabel={strings.votacao.retirarOpcao(indice + 1)}
                  title={strings.votacao.retirarOpcao(indice + 1)}
                  onClick={() => setOpcoes((atuais) => atuais.filter((_, i) => i !== indice))}
                >
                  ×
                </Button>
              )}
            </li>
          ))}
        </ul>

        {opcoes.length < OPCOES_MAX ? (
          <Button type="button" variant="ghost" onClick={() => setOpcoes((atuais) => [...atuais, ""])}>
            {strings.votacao.acrescentar}
          </Button>
        ) : (
          /* The cap stated in words, instead of the button disappearing without
             explanation: an option that vanishes makes people doubt what they saw. */
          <p className="hint">{strings.votacao.opcoesCheias(OPCOES_MAX)}</p>
        )}

        {/* The deadline is the creator's choice, made here: after the sheet closes there is no
            one to ask. Duration is the first answer because it is what people say ("two days"). */}
        <fieldset className="nova-votacao-prazo">
          <legend>{strings.votacao.prazoLabel}</legend>
          <div className="nova-votacao-prazo-modos" role="radiogroup" aria-label={strings.votacao.prazoLabel}>
            {(
              [
                ["duracao", strings.votacao.prazoDuracao],
                ["data", strings.votacao.prazoData],
                ["sem", strings.votacao.prazoSem],
              ] as const
            ).map(([modo, nome]) => (
              <label key={modo}>
                <input type="radio" name="prazo" checked={prazo === modo} onChange={() => setPrazo(modo)} />
                {nome}
              </label>
            ))}
          </div>
          {prazo === "duracao" && (
            <div className="nova-votacao-prazo-campos">
              <Field label={strings.votacao.duracaoLabel}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={duracao}
                  onChange={(event) => setDuracao(event.target.value)}
                />
              </Field>
              <select
                aria-label={strings.votacao.duracaoLabel}
                value={unidade}
                onChange={(event) => setUnidade(event.target.value === "h" ? "h" : "d")}
              >
                <option value="h">{strings.votacao.unidadeHoras}</option>
                <option value="d">{strings.votacao.unidadeDias}</option>
              </select>
            </div>
          )}
          {prazo === "data" && (
            <Field label={strings.votacao.dataLabel}>
              <input type="datetime-local" value={data} onChange={(event) => setData(event.target.value)} />
            </Field>
          )}
          {!prazoEm.ok && prazoEm.motivo !== "vazio" && (
            <p className="error">
              {prazoEm.motivo === "passado" ? strings.votacao.prazoPassado : strings.votacao.prazoLongo(PRAZO_MAX_DIAS)}
            </p>
          )}
        </fieldset>

        <p className="nova-votacao-nota">{strings.votacao.nota}</p>
        {error && (
          <p className="error">
            <TextoDeErro texto={error} />
          </p>
        )}
      </div>

      <footer className="sheet-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {strings.prompts.cancel}
        </Button>
        <Button variant="primary" type="submit" disabled={busy || !pronta}>
          {strings.votacao.confirmar}
        </Button>
      </footer>
    </Modal>
  )
}
