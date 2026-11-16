import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useMesmoValor } from "./useMesmoValor.js"
import { BridgeContext } from "../App.js"
import type { Profile } from "../bridge.js"
import { cacheDeMedia } from "../lib/cacheDeMedia.js"
import type { ChatMessage } from "../types.js"
import { nomeEmFalta, palavrasRepetidas } from "../lib/format.js"

/**
 * A published profile payload, reshaped into the UI's `Profile`.
 *
 * The wire format carries the avatar as an attachment (`avatar.inline`); the
 * UI speaks `avatarDataUrl`. The old cast skipped this translation, so every
 * surface fed by the directory — member rows, feed authors, Amigos, call
 * chips, notifications — showed initials for people who had published a
 * perfectly good picture.
 */
export function profileFromPayload(payload: unknown): Profile {
  const raw = payload as {
    displayName?: string
    statusText?: string
    bio?: string
    email?: string
    donations?: Profile["donations"]
    updatedAt?: number
    avatarDataUrl?: string
    avatarRef?: string
    avatar?: { inline?: string; url?: string; ref?: string; mini?: string }
  }
  const avatarDataUrl = raw.avatarDataUrl ?? raw.avatar?.inline
  // The portrait in the media store (Task 10): by reference, and the thumbnail when it is another image.
  const avatarRef = avatarDataUrl === undefined ? (raw.avatarRef ?? raw.avatar?.ref) : undefined
  const avatarMini = avatarRef !== undefined && raw.avatar?.mini !== undefined && raw.avatar.mini !== avatarRef ? raw.avatar.mini : undefined
  return {
    displayName: raw.displayName ?? "",
    donations: raw.donations ?? [],
    ...(raw.statusText !== undefined ? { statusText: raw.statusText } : {}),
    ...(raw.bio !== undefined ? { bio: raw.bio } : {}),
    ...(raw.email !== undefined ? { email: raw.email } : {}),
    ...(raw.updatedAt !== undefined ? { updatedAt: raw.updatedAt } : {}),
    ...(avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
    ...(avatarRef !== undefined ? { avatarRef } : {}),
    ...(avatarMini !== undefined ? { avatarMini } : {}),
  }
}

/** The `sha` the lists ask for the portrait: the thumbnail, or the portrait itself. Null if there is already an `avatarDataUrl`. */
function shaDoRetrato(perfil: Profile): string | null {
  if (perfil.avatarDataUrl || !perfil.avatarRef) return null
  return perfil.avatarMini ?? perfil.avatarRef
}

/**
 * The directory portraits that are in the media store (Task 10): each `sha` is
 * asked for once through the session cache, stays held while the directory
 * shows it, and is asked for again when the core says it arrived.
 */
function useRetratos(perfis: ReadonlyMap<string, Profile>): ReadonlyMap<string, string> {
  const bridge = useContext(BridgeContext)
  const media = bridge?.media
  const [resolvidos, setResolvidos] = useState<ReadonlyMap<string, string>>(new Map())
  const [volta, setVolta] = useState(0)
  const chave = useMemo(() => {
    const shas = new Set<string>()
    for (const perfil of perfis.values()) {
      const sha = shaDoRetrato(perfil)
      if (sha) shas.add(sha)
    }
    return [...shas].sort().join(" ")
  }, [perfis])

  useEffect(() => {
    if (!media || !chave) return
    let vivo = true
    const shas = chave.split(" ")
    for (const sha of shas) {
      cacheDeMedia.prender(sha)
      void cacheDeMedia.obter(sha, "", (s) => media.bytes(s)).then((url) => {
        if (!vivo || !url) return
        setResolvidos((antes) => (antes.get(sha) === url ? antes : new Map(antes).set(sha, url)))
      })
    }
    const largar = bridge?.on?.media?.((evento) => {
      if ((evento.estado === "chegou" || evento.estado === "guardado") && shas.includes(evento.sha)) setVolta((n) => n + 1)
    })
    return () => {
      vivo = false
      largar?.()
      for (const sha of shas) cacheDeMedia.soltar(sha)
    }
  }, [bridge, media, chave, volta])

  return resolvidos
}

/**
 * Everyone's profile, assembled from what they published.
 *
 * There is no directory to look a person up in: a display name is something a
 * member told a group. Keyed on the authenticated sender, never on anything
 * inside the payload, which the sender writes.
 */
export function useDirectory(
  messages: ChatMessage[],
  /** Profiles remembered by the vault, so names survive a reload. */
  seed?: ReadonlyMap<string, Profile>,
  /** This account's own profile, which never arrives over the network. */
  self?: { address: string | null; profile: Profile } | undefined,
  /**
   * The accounts this screen shows beyond those who wrote (channel members,
   * people in the call), so `nomeEmFalta` collisions can see them.
   */
  vizinhos?: readonly string[],
): {
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
} {
  const base = useMemo(() => {
    // The vault's copy first; anything published live overlays it, with the
    // same freshest-wins rule the vault itself applies.
    const byAddress = new Map<string, Profile>(seed ?? [])
    for (const message of messages) {
      if (message.payload.t !== "profile") continue
      const known = byAddress.get(message.sender)
      const incoming = profileFromPayload(message.payload)
      if (!known || (incoming.updatedAt ?? 0) >= (known.updatedAt ?? 0)) {
        byAddress.set(message.sender, incoming)
      }
    }

    // Your own profile is the one that never arrives: your sends come back
    // as echoes and are skipped by design, so the directory knew everybody
    // except you — and every surface reading from it drew your initial where
    // your photograph should be. Seeded from the vault's own copy, through
    // the same normaliser, so there is exactly one shape of Profile.
    if (self?.address) byAddress.set(self.address, profileFromPayload(self.profile))
    return byAddress
  }, [messages, seed, self?.address, self?.profile])

  // The portraits by reference, resolved to `avatarDataUrl` only here: the profile that came from outside does not change.
  const retratos = useRetratos(base)
  // The same map while no profile changed (1.3.15): each message rebuilds `base`, and
  // a new directory made `nameFor` new, and the memoized sidebar render again.
  const directory = useMesmoValor(useMemo(() => {
    if (retratos.size === 0) return base
    const comCaras = new Map(base)
    for (const [conta, perfil] of base) {
      const sha = shaDoRetrato(perfil)
      const url = sha ? retratos.get(sha) : undefined
      if (url) comCaras.set(conta, { ...perfil, avatarDataUrl: url })
    }
    return comCaras
  }, [base, retratos]))

  /*
    No published name means the first word of the address (`nomeEmFalta`), and
    the second too when another account on the same screen with no name starts
    with the same letter. The screen is what we see here: who wrote, who is in
    the directory and the neighbors. Looking beyond the screen only adds one
    more word, never merges two people.
  */
  const repetidas = useMesmoValor(useMemo(() => {
    const semNome = new Set<string>()
    const considerar = (conta: string): void => {
      if (!directory.get(conta)?.displayName) semNome.add(conta)
    }
    for (const conta of directory.keys()) considerar(conta)
    for (const message of messages) considerar(message.sender)
    for (const conta of vizinhos ?? []) considerar(conta)
    return palavrasRepetidas(semNome)
  }, [directory, messages, vizinhos]))

  const nameFor = useCallback(
    (sender: string): string => directory.get(sender)?.displayName || nomeEmFalta(sender, repetidas),
    [directory, repetidas],
  )

  return { directory, nameFor }
}
