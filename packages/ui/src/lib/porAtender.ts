import type { ChatMessage } from "../types.js"
import { isDirect, isFeed } from "./format.js"
import { mencionaMe } from "./mentions.js"
import { estaSilenciado } from "./silenciados.js"

/**
 * What needs attention in each destination on the rail, and why that one and not another.
 *
 * The badge is a small number above the icon showing what awaits a reply there.
 * The rule that decides what counts is one and the same, and it separates a
 * notification from a traffic counter: **count what was directed to this
 * account, not what passed nearby.**
 *
 * A badge that was always lit was worse than having no badge at all. A channel
 * with thirty people has unread messages all the time; a number that never
 * reaches zero stops being read after two days, and teaches you to ignore the
 * badge next to it, which might be a friend request waiting for a week. That
 * is why the rule is deliberately tight.
 *
 * **Communities (channels)**, two notices with two shapes (20/11/2026,
 * option A). The NUMBER is the mentions in every room (`mencoesNosCanais`):
 * someone called this account. The rest of the unread traffic is a pill on
 * the left of the button, with no number. History: until 27/10/2026 only
 * mentions counted, with a quiet dot for the rest; on 27/10 the number became
 * every unread message, and the dot went away as "the same news told twice".
 * That number did not say whether anyone was waiting, so on 20/11 the two came
 * apart again, now with shapes that cannot be confused: a pill is not a
 * number. The pill reads the counts the sidebar already shows
 * (`repartirPorDestino`), so a muted place lights nothing but its mentions
 * (see `lib/silenciados.ts`); the same goes for a direct conversation in
 * Contacts.
 *
 * **Contacts**, pending friend requests, plus unread messages in direct
 * conversations. Both live in this destination: direct conversations moved
 * here and the channel bar no longer draws them. In a two-person conversation,
 * every message is directed at me, and so it counts in full, no mention needed.
 *
 * **Social**, comments from other people on my posts, to see. New posts from
 * people I follow would be noise: they appear on their own, with no one
 * waiting for a reply, and on an active wall the number would never reach
 * zero. A comment under what I wrote is someone talking to me. See
 * `comentariosPorAtender` in `screens/social/engagement.ts`, and the resend
 * trap written there.
 *
 * **Profile, nothing, and that is a choice, not an oversight.** The profile
 * destination shows my identity and my posts. There is nothing there that
 * another person can leave waiting for me: comments on my posts count once, in
 * Social, and counting them here too would be the same number lighting two
 * icons, the person would attend to one and the other would stay lit, or
 * worse, attend to one and clear both without knowing why. An icon with no
 * badge is not incomplete: it is telling the truth.
 */

/**
 * Is this message for me, or did it just pass nearby?
 *
 * Returns the test instead of the result because `countUnreads` uses it and
 * already has all the guards (not the open channel, not mine, after the read
 * mark). Filtering inside is what makes the badge, by design, a subset of the
 * numbers the sidebar already shows, and two counts that come from the same
 * sum cannot drift apart.
 *
 * The mention is read from `mentions`, never from the body, for the reason
 * written in `lib/mentions.ts`: searching for @ symbols in the text was
 * guessing who is who from names that change.
 *
 * With no known address there is nothing directed at anyone. It happens at
 * startup, between the vault opening and the identity arriving, and a lit
 * number in that window would appear and disappear on its own in front of
 * someone watching.
 *
 * `@all` (`mencionaMe`) counts as a mention, except in a muted place:
 * `silenciados` is the list from `lib/silenciados.ts`.
 */
export function dirigidaAMim(me: string | null, silenciados: readonly string[] = []): (message: ChatMessage) => boolean {
  if (me === null) return () => false
  return (message) =>
    isDirect(message.channel) ||
    mencionaMe(
      message.payload.mentions,
      me,
      estaSilenciado(silenciados, message.channel, (message.payload as { room?: string }).room ?? ""),
    )
}

/** What each badge gets, from the counts per channel. */
export interface PorDestino {
  canais: number
  contactos: number
}

/**
 * The counts per channel, split by the destination where they will be attended.
 *
 * The cut is the same one the shell already uses to decide what the sidebar
 * draws: no feeds, no direct conversations. It has to be the same, or the
 * badge sends the person to a destination where what it announces is not, and
 * they arrive, find nothing, and the second time they will not go.
 *
 * The feed is no one's destination: it is routing, and does not appear on the rail.
 */
export function repartirPorDestino(porCanal: ReadonlyMap<string, number>): PorDestino {
  let canais = 0
  let contactos = 0
  for (const [channel, quantas] of porCanal) {
    if (isFeed(channel)) continue
    if (isDirect(channel)) contactos += quantas
    else canais += quantas
  }
  return { canais, contactos }
}

/**
 * The Communities number: mentions of this account in every room of every
 * channel (20/11/2026, option A).
 *
 * Read from the counts per room that the sidebar already draws
 * (`contarPorSala`), so the rail and the rooms cannot drift apart. A mention
 * counts in a muted place too: muting makes a place quiet, not deaf to its own
 * name. Direct conversations and feeds are cut here as in `repartirPorDestino`:
 * they are attended in Friends and Feed.
 */
export function mencoesNosCanais(
  porSala: ReadonlyMap<string, ReadonlyMap<string, { readonly mencoes: number }>>,
): number {
  let soma = 0
  for (const [canal, salas] of porSala) {
    if (isFeed(canal) || isDirect(canal)) continue
    for (const conta of salas.values()) soma += conta.mencoes
  }
  return soma
}
