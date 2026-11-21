import { memo, useEffect, useRef, useState } from "react"
import type { Power } from "@enclave/protocol"
import type { Profile } from "../../bridge.js"
import { Avatar } from "../../components/Avatar.js"
import { BotaoMais } from "../../components/BotaoMais.js"
import { Button } from "../../components/Button.js"
import { DistintivoDeEmbaixador } from "../../components/DistintivoDeEmbaixador.js"
import { NomeComApelido } from "../../components/NomeComApelido.js"
import { Skeleton } from "../../components/Skeleton.js"
import { MarcaDeChamada } from "../../components/MarcaDeChamada.js"
import { useVolumes } from "../../hooks/useVolumes.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import { PersonAddIcon, SetaParaTrasIcon } from "../../icons.js"
import { agruparMembros, type CargoDoMembro } from "../../lib/agruparMembros.js"
import { tintaDoPapel } from "../../lib/roleColours.js"
import { strings } from "../../strings.js"

/** A channel role, as the interface needs to know it. */
export interface ChannelRole {
  role: string
  name: string
  powers: Power[]
}

/**
 * Who is in this channel.
 *
 * The list comes from the group's own key tree, so it is not a roster a server
 * could pad with an extra reader or trim to hide one — it is exactly the set of
 * people holding keys that decrypt this channel. That is worth showing plainly,
 * because "who can read this" is the question the whole app exists to answer.
 *
 * Loading, failed and empty are three different truths, told apart on purpose:
 * an eternal "A carregar…" over a fetch that already failed is a lie.
 */
function MemberPanelInteira({
  afastados = 0,
  channel,
  open = false,
  onClose,
  members,
  state,
  onRetry,
  me,
  directory,
  nameFor,
  onInvite,
  podeConvidar,
  onOpenProfile,
  onUserMenu,
  presenceFor,
  presenceHint,
  emChamada,
  roleFor,
  apelidoDe,
  micCaladoDe,
  oficial = false,
  pedirPerfis,
  onVoltar,
  syncing = false,
  daysAway = null,
}: {
  channel: string
  /**
   * The phone (option B, 20/11/2026): the panel is a pushed screen over the
   * conversation, and its header starts with a back arrow. Absent elsewhere.
   */
  onVoltar?: (() => void) | undefined
  /** On narrow screens the panel is a slide-in overlay; this is it, open.
   * On wide screens it is a plain grid column and this flag is inert. */
  open?: boolean
  /**
   * Close the drawer. Absent means there's no drawer to close.
   *
   * Before this existed, the people list would open on top of the conversation
   * on a phone and the only way to get it off was to hit the 34px handle that
   * opened it again. No veil, no Escape, nothing to tap outside: a panel that
   * won't close is a panel that covers the app.
   *
   * It's the same contract the channel bar already had. See `ChannelSidebar`.
   */
  onClose?: (() => void) | undefined
  members: string[]
  /**
   * How many accounts hold the keys but the server says are gone (P7). Not in
   * `members` and not in the count; said in one line, so nobody who can read is hidden.
   */
  afastados?: number | undefined
  /**
   * Ask for the names of these accounts (the common room). Called only for the
   * rows of the offline list that are on screen. Absent: an older host.
   */
  pedirPerfis?: ((contas: string[]) => void) | undefined
  /** Each person's nickname in this channel (phase 3), before their name. */
  apelidoDe?: ((address: string) => string | undefined) | undefined
  state: "loading" | "error" | "ready"
  onRetry: () => void
  me: string | null
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
  /** Opens the single invite sheet, for this channel. See `ConvidarSheet`. */
  onInvite: () => void
  /**
   * Whether this account has the right to invite people to this channel.
   *
   * Both buttons appeared for everyone, and only on tap did you discover what
   * could happen: the sheet would open, "Create link" would answer "you don't
   * have the right to invite to this channel", and that was it. It was the most
   * repeated bug in one swarm run, thirteen failures in twenty-three, always
   * on bots that didn't create the channel.
   *
   * The rule of this app is that what you cannot do does not appear greyed out:
   * it does not appear at all. The real gate stays where it was (`mayInvite`,
   * on the core side); this is the interface stopping to promise what it cannot
   * deliver.
   *
   * Absent means "no", which is the safe read for an old host who cannot answer
   * the question.
   */
  podeConvidar?: boolean | undefined
  /**
   * Opens a person's profile from the list, including your own.
   *
   * It took the place of the tap that showed the security number. In a list of
   * people, tapping a person shows the person, and verification was not lost:
   * it moved inside the profile, which is where you look for it and where it
   * finally has a label instead of just a hover tip.
   */
  onOpenProfile: (member: string) => void
  /** Right-click on a member: the shared person menu, owned by the shell. */
  onUserMenu: (member: string, at: { x: number; y: number }) => void
  /** Presence per person, live or derived — the shell knows which. */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  /**
   * The role of each person in this channel, if they have one.
   *
   * It takes the place where the address was. The address is still what you give
   * someone to invite them, but it is not what you want to know when looking at
   * a list of people, and it stays one tap away, in the line title and in the
   * menu.
   *
   * **The label and the color come from the same function, and that is
   * deliberate.** Two separate functions let them disagree, and they already
   * disagreed on the first case: whoever created the channel reads as "Founder",
   * which is not any declared role, and a separate color function painted that
   * word with the color of a role that is not written there. The color was
   * saying something the text does not say, which is exactly what cannot
   * happen. Coming from the same place, the color is always that of a role named
   * in the label, or it does not exist.
   *
   * `tint` is an already resolved color value, or nothing. Nothing is the normal
   * case.
   *
   * **And the GROUP comes from the same function, for the same reason.** The list
   * is organized by role, and the role that organizes it must be the same one
   * the label names and the color paints. See `agruparMembros`.
   */
  roleFor?: ((address: string) => CargoDoMembro | null) | undefined
  /**
   * Who is in a call with the microphone off.
   *
   * A function, not a list: whoever knows this is the call layer, and the list
   * of channel members has nothing to do with the list of who is in voice.
   * Returning `false` for everyone, which is what happens when nobody provides
   * the prop, is the right read: outside a call there is no state saying
   * anything about anyone's microphone.
   */
  micCaladoDe?: ((address: string) => boolean) | undefined
  /**
   * Who is in a voice room or call, to make the face ring pulse.
   *
   * A function, like `presenceFor`: the call layer and room map know this, and
   * they live in `App`. Absent means nobody in a call, the ring stays still,
   * which is the reading that commits to nothing.
   */
  emChamada?: ((address: string) => boolean) | undefined
  /*
   * The list of roles and the form that creates them used to be here, and moved
   * to the channel properties sheet. See `RoleEditor`.
   *
   * With them went the drag-person-to-role gesture, which is what made this list
   * the source of a gesture. The lines are just lines again: they open the
   * profile on tap and the menu on right-click, as they always did.
   */
  presenceHint?: string | undefined
  /**
   * This channel is the server's commons, open to any account here.
   *
   * It comes decided from outside, like everything that depends on what the
   * server announced (see `lib/oficial.ts`). It matters to this list more than
   * anywhere else: the list answers "who can read this", and in an open channel
   * the honest answer is not the names here, it is these plus everyone who
   * connects next.
   *
   * Absent means "no", which is the safe read: a channel you don't know is open
   * does not announce itself as open.
   */
  oficial?: boolean | undefined
  /**
   * This channel's history is syncing (D2): the same truth as the "Chat history
   * is syncing." marker in the conversation, decided by the shell. The column
   * goes grey and quiet until it ends, and says so at the top.
   */
  syncing?: boolean | undefined
  /**
   * Local calendar days since this device was last online with this account.
   * `null` (a device that never was) and 0 (the same day) say nothing: the
   * status line is then only "Now syncing".
   */
  daysAway?: number | null | undefined
}): React.JSX.Element {
  const painel = useRef<HTMLElement>(null)
  const saindo = useSaidaDoSync(syncing)
  const fecharRef = useRef(onClose)
  fecharRef.current = onClose

  /*
    Drawer behavior, and only while it is open: focus enters, Escape closes it,
    and on close focus returns to the handle that opened it. Copied from the
    channel bar on purpose, because they are the same thing on opposite sides of
    the screen and two drawers that close differently are two things to learn.
    Lighter than a `Modal` for the same reason as there: the rail and the
    conversation stay reachable, so focus does not trap.
  */
  useEffect(() => {
    if (!open || !fecharRef.current) return
    const abriu = document.activeElement instanceof HTMLElement ? document.activeElement : null
    painel.current?.querySelector<HTMLElement>("button:not([disabled]), [href], input:not([disabled])")?.focus()
    const aoTeclado = (evento: KeyboardEvent): void => {
      if (evento.key === "Escape") fecharRef.current?.()
    }
    document.addEventListener("keydown", aoTeclado)
    return () => {
      document.removeEventListener("keydown", aoTeclado)
      abriu?.focus()
    }
  }, [open])

  /**
   * Who is here, for the purposes of this list.
   *
   * Busy is present: it is people who are there and who respond. Absent from the
   * prop is "don't know", and the safe read is "is here", a host who cannot
   * answer cannot make the whole list look empty.
   */
  const estaCa = (address: string): boolean => (presenceFor ? presenceFor(address) !== "idle" : true)

  /*
    A big channel shows only who is online (12/11/2026). The rest is one
    line, "+X people on this server", that opens a windowed list on request.
    With 409 members, drawing (and asking names for) everyone on every login
    was work for people nobody was looking at.
  */
  const grande = presenceFor !== undefined && members.length > MEMBROS_PARA_SO_LIGADOS
  const [verTodos, setVerTodos] = useState(false)
  const visiveis = grande ? members.filter(estaCa) : members
  // Sorted only when open: closed, the line needs only the count.
  const foraDeLinha = grande ? members.filter((membro) => !estaCa(membro)) : []
  if (verTodos) foraDeLinha.sort((a, b) => nameFor(a).localeCompare(nameFor(b), "pt") || a.localeCompare(b))

  const grupos = agruparMembros(visiveis, {
    online: estaCa,
    cargoDe: (address) => roleFor?.(address) ?? null,
    nameFor,
    titulos: { online: strings.members.groupOnline, offline: strings.members.groupOffline },
  })

  const { volumeDe } = useVolumes()
  /* The same menu, with the finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()

  /**
   * A person's line, exactly as this list has always drawn it.
   *
   * It came out of the `map` so it could be called from inside each group, and
   * it has not changed a thing: what changed was the order it appears in, and
   * under which heading.
   */
  const linhaDe = (member: string): React.JSX.Element => {
    const profile = directory.get(member)
    const papel = roleFor?.(member) ?? null
    const presenca = presenceFor?.(member)
    const estado =
      profile?.statusText?.trim() ||
      (presenca === "busy" ? strings.activity.busy : presenca === "away" ? strings.activity.away : "")
    const labels = (
      <>
        <Avatar profile={profile} fallback={member[1] ?? "?"} presence={presenca}
          presenceTitle={presenceHint}
          emChamada={emChamada?.(member)}
        />
        <span className="member-labels">
          <span className="member-name">
            <NomeComApelido nome={nameFor(member)} apelido={apelidoDe?.(member)} endereco={member} />
            <DistintivoDeEmbaixador address={member} />
            {/* Next to the name, inside the same line: you look next to the name, and a
                mark in its own column would force the whole list to make space for
                something that is almost never there. */}
            {micCaladoDe?.(member) && (
              <MarcaDeChamada tipo="calado" nome={nameFor(member)} className="member-mic-off" size={14} />
            )}
            {/* And who WE have muted, which until now only showed in the call card.
                It stays visible even outside a call: zero volume is saved, and it
                is on the next call that the silence surprises you. */}
            {volumeDe(member) === 0 && (
              <MarcaDeChamada tipo="silenciado" nome={nameFor(member)} className="member-silenced" size={14} />
            )}
          </span>
          {/* Line 2: the role, then the state (17/11/2026), as Discord puts the
              custom status under the name. The state is the status text when there
              is one, otherwise busy or away. It used to scroll NEXT to the name (the
              `Andante`); now it is small and faded below, cut with "…", and whole
              in the tooltip.

              The role's colour comes in by variable, and only on the role: without
              it the CSS rule falls back to accent. What the colour paints is the
              role's name, still written, so whoever cannot tell colours apart reads
              the same thing. No role and no state: no second line, as before. */}
          {(papel || estado) && (
            <span className="member-sub member-subline" title={[papel?.label, estado].filter(Boolean).join(" · ")}>
              {papel && (
                <span className="member-role" style={tintaDoPapel(papel.tint)}>
                  {papel.label}
                </span>
              )}
              {papel && estado && <span className="member-sub-sep"> · </span>}
              {estado && <span className="member-estado">{estado}</span>}
            </span>
          )}
        </span>
      </>
    )
    // The line itself also opens, and takes you to your own profile screen:
    // seeing yourself as others see you is what that screen always promised, and
    // an inert line in the middle of a clickable list just looks broken.
    return (
      <li key={member}>
        <button
          className="member-row"
          title={member === me ? strings.sidebar.myProfile : strings.personProfile.openHint(nameFor(member))}
          onClick={() => onOpenProfile(member)}
          onContextMenu={(event) => {
            event.preventDefault()
            onUserMenu(member, { x: event.clientX, y: event.clientY })
          }}
          {...aoDedo((ponto) => onUserMenu(member, ponto))}
        >
          {labels}
        </button>
        {/* No copy-id button next to the name ("it is
            already in the menu …"): the "⋯" and right-click give the same menu,
            and that is where the id copies. The line is the name and the "⋯",
            and nothing else. */}
        <BotaoMais
          label={strings.people.rowMore(nameFor(member))}
          onAbrir={(ponto) => onUserMenu(member, ponto)}
        />
      </li>
    )
  }

  return (
    <>
      {/* The overlay, only with the drawer open. On wide screens the CSS hides it:
          the column is not on top of anything, and there is nothing to return
          to. */}
      {open && onClose && <div className="members-scrim" aria-hidden="true" onMouseDown={onClose} />}
      <aside
        ref={painel}
        className={["members", open && "open", syncing && "syncing"].filter(Boolean).join(" ")}
        role={open && onClose ? "dialog" : undefined}
        aria-label={open && onClose ? strings.members.drawerLabel : undefined}
        aria-busy={syncing || undefined}
      >
        <header className="members-header">
          {onVoltar && (
            <button type="button" className="topbar-voltar" aria-label={strings.telemovel.voltar} onClick={onVoltar}>
              <SetaParaTrasIcon size={22} />
            </button>
          )}
          <span>
            {state === "ready"
              ? strings.members.count(members.length)
              : state === "loading"
                ? strings.members.loading
                : ""}
          </span>
        </header>

        {/* The syncing state, at the top of the column (21/11/2026). While it
            stays, the rows below are grey and take no pointer or key: the list
            is still arriving, and a person opened from it could be out of date.
            When the sync ends the block fades out with the rows coming back
            (`MEMBERS_SYNC_EXIT_MS`), and only then leaves the tree. */}
        {(syncing || saindo) && (
          <div
            className={syncing ? "members-syncing" : "members-syncing leaving"}
            role={syncing ? "status" : undefined}
            aria-hidden={syncing ? undefined : true}
          >
            <span className="members-syncing-title">{strings.members.syncingTitle}</span>
            {daysAway !== null && daysAway > 0 && (
              <span className="members-syncing-away">{strings.members.syncingAway(daysAway)}</span>
            )}
            <span className="members-syncing-track" aria-hidden="true">
              <span className="members-syncing-bar" />
            </span>
          </div>
        )}

        {/* Below the count and above the names, because it is the count it corrects:
            four names in a list read as four people.

            Outside the footer on purpose. The footer disappears for whoever
            cannot invite, and knowing where you are does not depend on any
            right. */}
        {oficial && <p className="members-open field-note">{strings.members.openChannel}</p>}
        {state === "ready" && afastados > 0 && <p className="members-afastados field-note">{strings.members.afastados(afastados)}</p>}

        <ul className="member-list" inert={syncing || undefined}>
          {state === "loading" &&
            [0, 1, 2].map((row) => (
              <li key={`skeleton-${row}`} aria-hidden="true">
                <Skeleton className="skeleton-avatar" />
                <span className="member-labels">
                  <Skeleton className="skeleton-line" />
                  <Skeleton className="skeleton-line short" />
                </span>
              </li>
            ))}

          {state === "error" && (
            <li className="member-error">
              <span>{strings.errors.membersFailed}</span>
              <Button variant="ghost" onClick={onRetry}>
                {strings.common.retry}
              </Button>
            </li>
          )}

          {/* One block per role, and one at the end for those outside. The list used to
              come sorted by ADDRESS, which is a random string of characters
              deciding who appears first. The rules are in `agruparMembros`;
              here we just draw what they say. */}
          {state === "ready" &&
            grupos.map((grupo) => (
              <li key={grupo.id} className={grupo.offline ? "member-group offline" : "member-group"}>
                {/* The role's color paints the heading by the same variable that paints the
                    sub-line, and only when it exists: without it the CSS rule
                    falls back to faded text as always. */}
                <h3
                  className="member-group-head"
                  id={`membros-${channel}-${grupo.id}`}
                  style={tintaDoPapel(grupo.tint)}
                >
                  {strings.members.groupHeading(grupo.titulo, grupo.membros.length)}
                </h3>
                <ul className="member-group-list" aria-labelledby={`membros-${channel}-${grupo.id}`}>
                  {grupo.membros.map((member) => linhaDe(member))}
                </ul>
              </li>
            ))}

          {state === "ready" && grande && foraDeLinha.length > 0 && (
            <li className="member-group offline">
              <button type="button" className="member-mais" aria-expanded={verTodos} onClick={() => setVerTodos((antes) => !antes)}>
                {verTodos ? strings.members.esconderMaisPessoas : strings.members.maisPessoas(foraDeLinha.length)}
              </button>
              {verTodos && <ListaEmJanela membros={foraDeLinha} linhaDe={linhaDe} semNome={(m) => !directory.get(m)?.displayName} pedirPerfis={pedirPerfis} />}
            </li>
          )}

          {state === "ready" && members.length === 0 && <li className="member-empty">{strings.members.empty}</li>}
        </ul>

        {/* Without the right to invite, the footer disappears. One button alone: the
            sheet has all three modes (address, link, add now). Primary, in the
            identity gradient, and without the note below:
            the sheet says what each mode does. */}
        {podeConvidar && (
          <footer className="members-footer">
            <Button variant="primary" className="wide" onClick={onInvite}>
              <PersonAddIcon size={16} />
              {strings.members.inviteSomeone}
            </Button>
          </footer>
        )}
      </aside>
    </>
  )
}

/**
 * How long the column takes to come back when a sync ends, in ms. The same
 * value as the transition on `.member-list` and `.members-syncing` in
 * `screens.css`, with and without reduced motion.
 */
export const MEMBERS_SYNC_EXIT_MS = 360

/**
 * True for `MEMBERS_SYNC_EXIT_MS` after `syncing` goes from true to false: the
 * status block stays in the tree while it fades, instead of vanishing and
 * pulling the list up under the pointer.
 */
function useSaidaDoSync(syncing: boolean): boolean {
  const [saindo, setSaindo] = useState(false)
  const antes = useRef(syncing)
  useEffect(() => {
    const sincronizava = antes.current
    antes.current = syncing
    if (syncing) {
      setSaindo(false)
      return
    }
    if (!sincronizava) return
    setSaindo(true)
    const relogio = setTimeout(() => setSaindo(false), MEMBERS_SYNC_EXIT_MS)
    return () => clearTimeout(relogio)
  }, [syncing])
  return saindo
}

/** Above this many members, the panel shows only who is online. */
export const MEMBROS_PARA_SO_LIGADOS = 50

/**
 * The height of one member row in the windowed list, in px. Pinned by
 * `.member-janela > li` in the CSS, with `flex: none` so the flex column never
 * shrinks it (the 1.3.16 stacked rows).
 */
export const ALTURA_DA_LINHA = 44
/** Rows drawn above and below the window, so a fast scroll never shows a gap. */
const MARGEM_DE_LINHAS = 8

/**
 * Which rows of a windowed list to draw, and the spacer heights around them.
 *
 * `topo` is the scroll offset and `altura` the visible height of the box. The
 * spacers plus the drawn rows always add up to every row at its full height:
 * that sum is what keeps each row where the scroll offset says it is.
 */
export function janelaDaLista(
  total: number,
  topo: number,
  altura: number,
): { inicio: number; fim: number; acima: number; abaixo: number } {
  const inicio = Math.min(total, Math.max(0, Math.floor(topo / ALTURA_DA_LINHA) - MARGEM_DE_LINHAS))
  const fim = Math.max(inicio, Math.min(total, Math.ceil((topo + altura) / ALTURA_DA_LINHA) + MARGEM_DE_LINHAS))
  return { inicio, fim, acima: inicio * ALTURA_DA_LINHA, abaixo: (total - fim) * ALTURA_DA_LINHA }
}

/**
 * The offline members of a big channel, drawn only where the eye is: a fixed
 * row height, a scroll box, and the rows of the window plus a margin. Asks for
 * the names of the nameless rows that come into view, once each.
 */
function ListaEmJanela({
  membros,
  linhaDe,
  semNome,
  pedirPerfis,
}: {
  membros: readonly string[]
  linhaDe: (membro: string) => React.JSX.Element
  semNome: (membro: string) => boolean
  pedirPerfis?: ((contas: string[]) => void) | undefined
}): React.JSX.Element {
  const [topo, setTopo] = useState(0)
  const [altura, setAltura] = useState(ALTURA_DA_LINHA * 10)
  const caixa = useRef<HTMLUListElement>(null)
  const pedidos = useRef(new Set<string>())
  useEffect(() => {
    const elemento = caixa.current
    if (elemento && elemento.clientHeight > 0) setAltura(elemento.clientHeight)
  }, [])
  const { inicio, fim, acima, abaixo } = janelaDaLista(membros.length, topo, altura)
  const janela = membros.slice(inicio, fim)
  useEffect(() => {
    if (!pedirPerfis) return
    const novos = janela.filter((membro) => semNome(membro) && !pedidos.current.has(membro))
    if (novos.length === 0) return
    for (const membro of novos) pedidos.current.add(membro)
    pedirPerfis(novos)
    // Asked once per row that comes into view; the window moves with `inicio`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, fim, membros])
  return (
    <ul
      ref={caixa}
      className="member-group-list member-janela"
      style={{ maxHeight: `min(60vh, ${membros.length * ALTURA_DA_LINHA}px)`, overflowY: "auto" }}
      onScroll={(evento) => setTopo(evento.currentTarget.scrollTop)}
    >
      {acima > 0 && <li aria-hidden="true" style={{ height: acima }} />}
      {janela.map((membro) => linhaDe(membro))}
      {abaixo > 0 && <li aria-hidden="true" style={{ height: abaixo }} />}
    </ul>
  )
}

/**
 * Memoized (1.3.15): a parent render with the same props does not walk the
 * whole list again. It only pays when the parent hands over stable props.
 */
export const MemberPanel = memo(MemberPanelInteira)
