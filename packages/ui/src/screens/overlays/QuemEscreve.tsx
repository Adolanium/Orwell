import { useId, useState } from "react"
import type { SoLeitura } from "@enclave/protocol"
import { Button } from "../../components/Button.js"
import { Interruptor } from "../../components/Interruptor.js"
import { Modal } from "../../components/Modal.js"
import type { ChannelRole } from "../../bridge.js"
import { strings, traduzirErro } from "../../strings.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"

/**
 * The read-only choice: the switch, the warning and the roles that write.
 *
 * Shared by `QuemEscreve` (an existing room) and `NewRoom` (a room being born),
 * so the two speak the same words about the same rule.
 *
 * The warning goes ABOVE the roles, as in `CategoryProperties`: this is a rule
 * of the apps, and a warning read after deciding is an excuse. Only when the
 * switch is on: an open room promises nothing, so there is nothing to warn about.
 */
export function EscolhaDeQuemEscreve({
  valor,
  onMudar,
  roles,
}: {
  valor: SoLeitura
  onMudar: (proximo: SoLeitura) => void
  /** The channel's declared roles, in the channel order. */
  roles: readonly ChannelRole[]
}): React.JSX.Element {
  const id = useId()
  const escolhidos = new Set(valor.quemEscreve)
  const alternar = (role: string): void => {
    const proximos = new Set(escolhidos)
    if (proximos.has(role)) proximos.delete(role)
    else proximos.add(role)
    // In the channel order, not the click order: the same choice publishes the same payload.
    onMudar({ soLeitura: true, quemEscreve: roles.map((papel) => papel.role).filter((role) => proximos.has(role)) })
  }
  return (
    <>
      <Interruptor
        ligado={valor.soLeitura}
        onMudar={(ligado) => onMudar({ soLeitura: ligado, quemEscreve: ligado ? valor.quemEscreve : [] })}
        rotulo={strings.soLeitura.label}
      />
      {valor.soLeitura && (
        <>
          <p className="hint">{strings.soLeitura.note}</p>
          {roles.length === 0 ? (
            <p className="hint">{strings.soLeitura.noRoles}</p>
          ) : (
            <fieldset className="role-group">
              <legend>{strings.soLeitura.rolesLabel}</legend>
              {roles.map((papel) => (
                <label key={papel.role} className="checkbox" htmlFor={`${id}-${papel.role}`}>
                  <input
                    id={`${id}-${papel.role}`}
                    type="checkbox"
                    checked={escolhidos.has(papel.role)}
                    onChange={() => alternar(papel.role)}
                  />
                  {papel.name || papel.role}
                </label>
              ))}
            </fieldset>
          )}
          <span className="field-note">{strings.soLeitura.adminNote}</span>
        </>
      )}
      <p className="hint">{valor.soLeitura ? strings.soLeitura.closed : strings.soLeitura.open}</p>
    </>
  )
}

/**
 * Who writes in a text room (12/11/2026): rooms everyone reads, where only some
 * roles write.
 *
 * A sheet of its own, beside "Rename", like "Who sees this category" for a
 * category: a room has no properties sheet, and this choice is one thing only.
 * What it saves is the room override (`comSoLeitura` in the protocol), signed
 * with the room and synced to every member.
 */
export function QuemEscreve({
  roles,
  initial,
  onSubmit,
  onCancel,
}: {
  roles: readonly ChannelRole[]
  initial: SoLeitura
  onSubmit: (escolha: SoLeitura) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const heading = useId()
  const [valor, setValor] = useState<SoLeitura>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A role deleted after being chosen counts as a change: saving is the only way to clear it.
  const vivos = new Set(roles.map((papel) => papel.role))
  const mudou =
    valor.soLeitura !== initial.soLeitura ||
    valor.quemEscreve.length !== initial.quemEscreve.length ||
    initial.quemEscreve.some((role) => !vivos.has(role) || !valor.quemEscreve.includes(role))

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    // Without this the browser reloads the page in the middle of publishing.
    event.preventDefault()
    if (busy || !mudou) return
    setBusy(true)
    setError(null)
    void onSubmit({ soLeitura: valor.soLeitura, quemEscreve: valor.quemEscreve.filter((role) => vivos.has(role)) }).catch(
      (cause: Error) => {
        setBusy(false)
        setError(traduzirErro(cause))
      },
    )
  }

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onCancel} onSubmit={submit}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.soLeitura.title}</h2>
      </header>
      <p className="sheet-lead">{strings.soLeitura.lead}</p>
      <div className="sheet-body">
        <EscolhaDeQuemEscreve valor={valor} onMudar={setValor} roles={roles} />
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
        <Button variant="primary" type="submit" disabled={busy || !mudou}>
          {busy ? strings.soLeitura.saving : strings.soLeitura.save}
        </Button>
      </footer>
    </Modal>
  )
}
