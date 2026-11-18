import type { OutgoingFile } from "@enclave/protocol"
import type { LinkCard } from "./bridge.js"

export interface MediaItem {
  inline?: string
  url?: string
  name?: string
  mediaType?: string
  /** The bytes were evicted to keep the vault small. The text around it stays. */
  evicted?: boolean
  /** In a video: the thumbnail, as an image data URL. */
  poster?: string
  /** In a video: the byte ranges and their SHA-256 digest. See `video.ts` in the protocol. */
  partes?: { n: number; sha256: string; bytes: number }
  /** Seconds, in a video. */
  duration?: number
  /** The size the sender states. In a video it is what shows before any bytes arrive. */
  byteLength?: number
  /**
   * The media out of the vault (Task 10): the bytes are in this device's store,
   * by the reference `sha`, and are asked for with `bridge.media.bytes`
   * (`useMedia`). The fields below come from the core, for the screen: they
   * never go on the wire.
   */
  ref?: string
  /** The `sha` of the permanent thumbnail. Equal to `ref` for an image that is its own thumbnail. */
  mini?: string
  /** The dimensions in pixels, for the box reserved before loading. */
  w?: number
  h?: number
  /** Plaintext bytes of the original. */
  b?: number
  /** The original is not on this device (it left through the ceiling, or never arrived). The thumbnail stays. */
  falta?: boolean
}

export interface ChatMessage {
  channel: string
  seq: number
  sender: string
  /** A send of ours without echo, read from the vault: the highest `seq` seen when it left. See `apos` in the core vault. */
  apos?: number
  /** Just arrived, live, not in recovery or in a report. See `ReceivedMessage.aoVivo`. */
  aoVivo?: boolean
  /** Roles this account just got (a live, accepted assignment). See `ReceivedMessage.cargosNovos`. */
  cargosNovos?: { role: string; nome?: string; cor?: string }[]
  payload: {
    t: string
    body?: string
    sentAt?: number
    id?: string
    /** For "message": images carried inside the ciphertext. Same shape as a
     * post's media, so one component draws both. */
    attachments?: MediaItem[]
    /**
     * For "message": who was mentioned, by address.
     *
     * Routing the notification reads THIS and never the body. Searching for @
     * mentions in the text would force the UI to guess who is who from names
     * that change, and get it wrong whenever two people picked the same name.
     */
    mentions?: string[]
    /** For "message": the message this replies to, by id. See `lib/respostas.ts`. */
    replyTo?: string
    caption?: string
    /** For "post": the name given to it, when it was given one. */
    title?: string
    postedAt?: number
    tags?: string[]
    media?: MediaItem[]
    links?: LinkCard[]
    /** For "edit", "redact", "post.comment" and "post.reaction": what it acts on. */
    target?: string
    /** For "post.reaction": the thumb, and whether the vote is being withdrawn. */
    emoji?: string
    remove?: boolean
    /** For "post.reaction": the sender's clock, so the newest vote wins. */
    at?: number
    /**
     * In a "post.reaction": the index of the option voted, when this is a poll.
     *
     * Present tells a poll vote apart from a thumbs up, and the two counts are
     * disjoint because of it, see `lib/votacoes.ts` and `engagement.ts`.
     */
    vote?: number
    /**
     * In a "message" or a "post": the poll it is.
     *
     * Optional field on things that already existed, never its own payload,      * see `Poll` in the protocol, where it is written what a new `t` would cost.
     * Options arrive as they come: whoever reads discounts what they cannot
     * draw, because this may have been written by a newer version.
     */
    poll?: { question: string; options: string[]; closesAt?: number }
    /** In an "edit": this edit closes the poll `target`, and changes no text. */
    closePoll?: boolean
    editedAt?: number
    redactedAt?: number
    /**
     * In a "message": deleted by whoever moderates the channel (phase 3).
     *
     * Never travels: it is the conversation fold that writes it, when it reads
     * the tombstone of whoever has `moderar` (`dobrarConversa`). The line stays,
     * with no content, and the screen says "Message deleted by moderation" where
     * the text was.
     */
    moderada?: boolean
    /**
     * In a "message": a poll its author could not create (`votacoes`, 1.3.21), read
     * without its poll. Never travels: the core writes it for the screen
     * (`semPollNoEcra`), so the polls room shows the text with a note.
     */
    votacaoSemPoder?: boolean
    /** For "friend.request": an optional note from the sender. */
    note?: string
    acceptedAt?: number
    /**
     * In a "message": the invite to a channel it carries, and the reply.
     *
     * Optional fields on a message, not their own payload, see
     * `ChannelInvite` in the protocol, where it is written why. Because they are
     * a message the invite shows in the conversation list and in the conversation,
     * which is where the person will look for it.
     */
    invite?: { channel: string; name?: string | undefined; at: number }
    inviteReply?: { channel: string; accepted: boolean; at: number }
  }
}

/**
 * What travels with message text: images and link cards.
 *
 * Declared in the protocol, not here, because the Electron main process builds
 * the message and does not load React, see the comment there. Image compression
 * happened before this existed; after encryption, an image is noise nobody can
 * reduce. See `lib/images.ts`.
 */
export type { MessageExtras, OutgoingFile, OutgoingImage } from "@enclave/protocol"

/**
 * The social composer's unpublished state. Owned by the shell, like the chat
 * drafts, so switching tabs never eats a half-written post. In memory only —
 * persisting it anywhere durable would put plaintext outside the vault.
 */
export interface SocialDraft {
  caption: string
  /** The name given to the post. Optional here as it is optional in the protocol. */
  title?: string
  images: string[]
  /**
   * Attachments that are not images: PDFs, zips, whatever comes.
   *
   * Optional, and on purpose: the shell creates the draft without this field,
   * and a required field would force it to change because of a feature it does
   * not need to know about. Images are strings because they only need the bytes;
   * a file also needs the name and type, which is what the shape of
   * `OutgoingFile` brings.
   */
  files?: OutgoingFile[]
  links: LinkCard[]
  /** The video picked, already read and with the thumbnail. One per post. See `lib/videos.ts`. */
  video?: VideoNoRascunho | undefined
}

/** A video in a post draft: the file as received, and what was extracted from it. */
export interface VideoNoRascunho {
  ficheiro: Blob
  name: string
  mediaType: string
  bytes: number
  /** Seconds. */
  duration: number
  /** The frame at 1 s, scaled down, as an image data URL. */
  poster: string
}

export type View = "perfil" | "chat" | "social" | "pessoas" | "config"
/**
 * `"saiu-de-beta"`: this device's vault is from 0.9.x (without the `orwv2`
 * header). 1.0 never reads it; the gate shows `SaiuDeBeta` instead of `Unlock`.
 * `"suspensa"`: the server suspended this account; the gate shows `ContaSuspensa`,
 * with the vault open to sign the review request.
 */
export type Stage = "loading" | "error" | "setup" | "emparelhar" | "saiu-de-beta" | "unlock" | "suspensa" | "ready"
