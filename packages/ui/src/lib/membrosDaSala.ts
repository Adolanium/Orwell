import { categoriaVisivel } from "../screens/chat/categorias.js"

/**
 * The people of a room in a restricted category (1.3.25).
 *
 * A category restricted to some roles hides its rooms from everyone else
 * (`categoriaVisivel`). The "People" list of such a room now shows only the
 * people who see it, as on Discord: the founder, the admins, whoever manages
 * the channel (`renomear`, the same exception the viewer has, see `QuemVe`)
 * and whoever has one of the chosen roles. In an open room, nothing changes.
 *
 * **Tidying, not security.** Everyone in the channel has the keys to every
 * room: this removes lines from a list, it does not stop anyone from reading.
 * The UI says so where the restriction is chosen (`categoryRestricted`).
 */
export interface AcessoDoCanal {
  fundador: string | null
  admins: ReadonlySet<string>
  /** The roles that carry `renomear` (manage the channel): they always see, like `administra`. */
  papeisQueAdministram: ReadonlySet<string>
  /** Each person's roles, by ID. `rolesFor` on the bridge. */
  papeisDe: (address: string) => readonly string[]
}

/**
 * Who of `membros` sees a room whose category requires `exigidos`.
 *
 * Empty `exigidos` is an open room: the same array comes back, so a list of
 * 700 people costs nothing in the normal case. Otherwise one pass, one role
 * read per person; the caller memoizes per room and role change.
 */
export function membrosDaSala(
  membros: readonly string[],
  exigidos: readonly string[] | undefined,
  acesso: AcessoDoCanal,
): readonly string[] {
  if (!exigidos || exigidos.length === 0) return membros
  return membros.filter((quem) => {
    if (quem === acesso.fundador || acesso.admins.has(quem)) return true
    const papeis = acesso.papeisDe(quem)
    const administra = papeis.some((papel) => acesso.papeisQueAdministram.has(papel))
    return categoriaVisivel(exigidos, { papeis, administra })
  })
}
