import { createContext, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { copiarTexto } from "./lib/copiar.js"
import {
  CHAVES_DA_RECUSA_DO_SISTEMA,
  dobrarReaccoes,
  formatInviteLink,
  HISTORY_PAGE_LINES,
  marcarArranque,
  nomeVisivel,
  parseInviteLink,
  parseShortInviteLink,
  sameHomeserver,
  TECTOS_DO_ESTADO,
  votosAGuardar,
  type DispositivoRecusado,
  type FichaDeReaccao,
  type Participant,
  type StoredChatMessage,
} from "@enclave/client-core"
import {
  canalAEsperaParaMostrar,
  canalParaMostrar,
  destinoDoConvite,
  nomeDoSelo,
  servidorParaMostrar,
  type ConviteLido,
  type NomeDoConvite,
  type StartupInvite,
} from "./lib/conviteDeArranque.js"
import type { StartupPairing } from "./lib/emparelhamentoDeArranque.js"
import { ConviteChegado } from "./screens/overlays/ConviteChegado.js"
import { CARGO_TODOS, comSoLeitura, eMoradaOpaca, moradaDeSala, parseServerName, podeVotar as podeVotarPelaIdade, soLeituraDe, type AvisoDeSuspensao, type Power } from "@enclave/protocol"
import { candidatoDeCargo, candidatoDeSala } from "./lib/etiquetas.js"
import type { Activity, ChannelRoom, ConnectionState, EnclaveBridge, Profile, StartupFriend } from "./bridge.js"
import type { ChatMessage, MessageExtras, SocialDraft, Stage, View } from "./types.js"
import { ChatIcon, FeedIcon, FriendsIcon, GearIcon, MenuIcon, OrwellMark, PersonIcon } from "./icons.js"
import { AvisosDoCarril, classeDoBotaoDoCarril, descricaoDoCarril, GlifoSemLigacao } from "./components/AvisosDoCarril.js"
import { useAmizade, estadoDaAmizade } from "./hooks/useAmizade.js"
import { useLacosDeAmizade } from "./hooks/useLacosDeAmizade.js"
import { useSucessoes } from "./hooks/useSucessoes.js"
import { useCriarCanais } from "./hooks/useCriarCanais.js"
import { useRoomQuota } from "./hooks/useRoomQuota.js"
import { chaveDaOferta, escondidasPorSucessao, ofertasDeSucessao, type OfertaDeSucessao } from "./lib/sucessoes.js"
import { useBloqueioAutomatico, type AutoLockReason, type HistoryForLock } from "./hooks/useBloqueioAutomatico.js"
import { useHistoryForLock } from "./hooks/useHistoryForLock.js"
import { useChamadaEmSegundoPlano } from "./hooks/useChamadaEmSegundoPlano.js"
import { useCotoveladaPorVer } from "./hooks/useCotoveladaPorVer.js"
import { useNudgeShake } from "./hooks/useNudgeShake.js"
import { ehPwaDoIos } from "./lib/plataforma.js"
import { useMarcaDaVolta } from "./hooks/useMarcaDaVolta.js"
import { useEstavel } from "./hooks/useEstavel.js"
import { useMesmoValor } from "./hooks/useMesmoValor.js"
import { useConhecidos } from "./hooks/useConhecidos.js"
import { pedidoCabe } from "./lib/privacidade.js"
import { useAtalhos } from "./hooks/useAtalhos.js"
import { useAtalhosGlobais } from "./hooks/useAtalhosGlobais.js"
import { useOverlayDeJogo } from "./hooks/useOverlayDeJogo.js"
import { useAvisoDeVersao } from "./hooks/useAvisoDeVersao.js"
import { useLingua } from "./hooks/useLingua.js"
import { useVisualViewport } from "./hooks/useVisualViewport.js"
import type { Seccao as SeccaoConfig } from "./screens/settings/seccoes.js"
import { profileFromPayload, useDirectory } from "./hooks/useDirectory.js"
import { useDrafts } from "./hooks/useDrafts.js"
import { useOutbox } from "./hooks/useOutbox.js"
import { usePartilhaDeEcra } from "./hooks/usePartilhaDeEcra.js"
import type { CargoDoMembro } from "./lib/agruparMembros.js"
import { prefsDeMediaParaONucleo } from "./lib/mediaPrefs.js"
import { presencasVivas, quemEstaNaSala, semAPessoa } from "./lib/presenca.js"
import { chaveDaSala, salaDaChamadaDe, salaUnicaDaChamadaDe } from "./lib/salaDaChamada.js"
import { applyPrefs, estaEmPausa, marcarEsperasFeitas, readEsperasFeitas, readPrefs, usePrefs, writePrefs } from "./hooks/usePrefs.js"
import { usePushFechada } from "./hooks/usePushFechada.js"
import { useSessionEvents } from "./hooks/useSessionEvents.js"
import { useSinoAvisa } from "./hooks/useSinoAvisa.js"
import { useLatencia } from "./hooks/useLatencia.js"
import { useMicrofones } from "./hooks/useMicrofones.js"
import { usePins } from "./hooks/usePins.js"
import { useProcura } from "./hooks/useProcura.js"
import type { Achado } from "./lib/procura.js"
import { NOME_POR_OMISSAO, nomeDaSala, useRooms } from "./hooks/useRooms.js"
import { useSpaceMeta } from "./hooks/useSpaceMeta.js"
import { countUnreads, useUnreads } from "./hooks/useUnreads.js"
import { apurar, corpoDaVotacao, fechosDe, semVotacoesDeSalasApagadas, votacaoDe, votosDe, type Apuramento, type Votacao } from "./lib/votacoes.js"
import { SemVotoContext } from "./components/semVoto.js"
import { useIdadesDosVotantes } from "./hooks/useIdadesDosVotantes.js"
import { NovaVotacao } from "./screens/overlays/NovaVotacao.js"
import { SalaDeVotacoes } from "./screens/chat/SalaDeVotacoes.js"
import { EscolherSalaDeVotacoes } from "./screens/chat/EscolherSalaDeVotacoes.js"
import { listarVotacoes, rastosDeVotacoes, type VotacaoListada } from "./lib/listarVotacoes.js"
import { useLigacaoDeMensagem } from "./hooks/useLigacaoDeMensagem.js"
import { useLigacoesInternas } from "./hooks/useLigacoesInternas.js"
import type { LigacaoInterna } from "./lib/ligacaoInterna.js"
import { membrosDaSala } from "./lib/membrosDaSala.js"
import {
  admiteAdministracao,
  comEmendas,
  dmPeerAddress,
  feedChannelOf,
  feedOf,
  friendsOf,
  lugaresDeFeedTrocados,
  isDirect,
  isFeed,
  lastActivityOf,
  presenceKindOf,
  presenceOf,
  selfPresenceOf,
  serverOf,
  nomeEmFalta,
  shortName,
  stampOf,
} from "./lib/format.js"
import { citacaoDe as citacaoNoIndice, indiceDasCitacoes, type Citacao, type RespostaPendente } from "./lib/respostas.js"
import { prefersReducedMotion } from "./lib/scroll.js"
import { cacheDeMedia } from "./lib/cacheDeMedia.js"
import { closeDirect, directasQueContam, listDirects } from "./lib/directs.js"
import { arquivar, desarquivar, esquecerEstadoDoBrowser, lerEstadoDaConta, ligarEstadoDaConta, marcarLido, useEstadoDaConta } from "./lib/estadoDaConta.js"
import { aceitesAEspera, conviteDaMensagem, convitesDe } from "./lib/convites.js"
import { nomeSeguro } from "./lib/ficheiros.js"
import { escritaNaDirecta } from "./lib/friendship.js"
import { mencoesNosCanais, repartirPorDestino } from "./lib/porAtender.js"
import {
  chaveDaConversa,
  chaveDaLidaDaSala,
  contarPorSala,
  entrarNaConversa,
  lerLidasPorSala,
  lerSala,
  marcaDaSala,
  useLidasPorSala,
} from "./lib/porLerPorSala.js"
import { transmissaoDe, type Transmissao } from "./components/MarcaDeChamada.js"
import { chaveDoSilencio, estaSilenciado, numeroVisivel } from "./lib/silenciados.js"
import { avisoDoAmigoCabe, criarVigiaDosAmigos, type TipoDeAvisoDeAmigo } from "./lib/amigosOnline.js"
import { criarVigiaDaVoz, criarVigiaDasComunidades } from "./lib/avisosDeAmigos.js"
import { criarVigiaDasChamadas, type ChamadaPerdida } from "./lib/chamadasPerdidas.js"
import { useAvisoDeAmigo } from "./components/AvisosDeAmigos.js"
import { comentariosPorAtender, engagementOf } from "./screens/social/engagement.js"
import { ehCanalOficial, ehSalaDeAnuncios, NOME_CANAL_OFICIAL } from "./lib/oficial.js"
import { corDosPapeis, hexDaCor } from "./lib/roleColours.js"
import { strings, translateError, traduzirErro } from "./strings.js"
import { AvisoDeActualizacao } from "./components/AvisoDeActualizacao.js"
import { ErrorBoundary } from "./components/ErrorBoundary.js"
import { capturarErrosGlobais } from "./lib/falhas.js"
import { LigacaoContext, type LigacaoDaFaixa } from "./components/ConnectionBanner.js"
import { ToastProvider, useDispensarToast, useToast } from "./components/Toast.js"
import { ConfirmarProvider, useConfirmar } from "./hooks/useConfirmar.js"
import { Splash } from "./screens/gate/Splash.js"
import { usePostLoginHold } from "./hooks/usePostLoginHold.js"
import { GateError } from "./screens/gate/GateError.js"
import { Setup } from "./screens/gate/Setup.js"
import { Emparelhar } from "./screens/gate/Emparelhar.js"
import { AparelhoRemovido, Unlock } from "./screens/gate/Unlock.js"
import { entrarNumaContaNova } from "./screens/gate/outraEntrada.js"
import type { TelaDoSetup } from "./screens/gate/Setup.js"
import { pagina } from "./screens/gate/MudarDeConta.js"
import { ContaSuspensa } from "./screens/gate/ContaSuspensa.js"
import { SaiuDeBeta } from "./screens/gate/SaiuDeBeta.js"
import { CallDock } from "./screens/call/CallDock.js"
import { useEcraLargo } from "./hooks/useEcraLargo.js"
import { ChannelSidebar, type PresenteNaVoz } from "./screens/chat/ChannelSidebar.js"
import { ChatScreen } from "./screens/chat/ChatScreen.js"
import { FolhaDoFicheiroDaConta } from "./components/FicheiroDaConta.js"
import { FaixaDoFicheiroContext } from "./components/FaixaDoFicheiro.js"
import { MobileNotice } from "./components/MobileNotice.js"
import { activeAccountId, forgetAccountName, rememberAccountName } from "./lib/accountNames.js"
import { CartaoDeAparelhoNovo } from "./components/CartaoDeAparelhoNovo.js"
import { APARELHOS_MUDARAM, FICHEIRO_GUARDADO, ficheiroPorTratar, marcarFicheiroTratado } from "./lib/ficheiroDaConta.js"
import { Social } from "./screens/social/Social.js"
import { PeopleScreen } from "./screens/people/PeopleScreen.js"
import { PeopleDestination } from "./screens/people/PeopleDestination.js"
import { CartaoDaConta } from "./screens/profile/CartaoDaConta.js"
import { type PeopleTab } from "./screens/people/FriendsBar.js"
import { itensDaConversa } from "./screens/people/menuDaConversa.js"
import { PersonProfile } from "./screens/profile/PersonProfile.js"
import { itensDaPessoa } from "./screens/profile/menuDaPessoa.js"
import { idDaPublicacao, usePilhaDaPessoa } from "./screens/profile/pilhaDaPessoa.js"
import { useTelemovel } from "./hooks/useTelemovel.js"
import { lerRolagens, reporRolagens } from "./lib/rolagens.js"
import { BarraDoTelemovel } from "./screens/telemovel/BarraDoTelemovel.js"
import { BordaDeVoltar } from "./screens/telemovel/BordaDeVoltar.js"
import { CarrilDeComunidades } from "./screens/telemovel/CarrilDeComunidades.js"
import { MenuDoTu } from "./screens/telemovel/MenuDoTu.js"
import { Separadores, type Separador } from "./screens/telemovel/Separadores.js"
import { itensDoMicrofone, itensDoSom } from "./screens/profile/menuDeAudio.js"
import { ProfileScreen, type CanalFundado } from "./screens/profile/ProfileScreen.js"
import { VerifyModal } from "./screens/chat/VerifyModal.js"
import { ActivityMenu } from "./screens/profile/ActivityMenu.js"
import { ProfileEditor } from "./screens/profile/ProfileEditor.js"
import { SettingsScreen } from "./screens/settings/SettingsScreen.js"
import {
  appendNotification,
  fundirNotificacoes,
  hostWindowInFront,
  listenForSystemNoticeClicks,
  markAllRead,
  markRead,
  notificationTextOf,
  rotuloParaAviso,
  salaParaAviso,
  retirarPedidoDe,
  AVISO_DO_AMIGO_MS,
  avisosDoSistemaLigados,
  avisoTemSomProprio,
  showSystemNotice,
  type CaminhoDoAviso,
  systemNoticeVerdictOf,
  unreadCountOf,
  type AppNotification,
} from "./lib/notifications.js"
import { mencionaMe } from "./lib/mentions.js"
import { deQuemBloqueei, semBloqueados } from "./lib/bloqueados.js"
import { recordDiagnostic } from "./lib/diagnostics.js"
import {
  avisoDaChamada,
  caminhoDoDetalhe,
  type AvisoDaChamada,
  type CaminhoDeMedia,
} from "./lib/estadoDaChamada.js"
import { fraseDoStatus, routeStatus, type SessionStatus } from "./lib/statusPolicy.js"
import {
  armSounds,
  callSoundOf,
  createCallRingGate,
  createCallConnectedWatcher,
  createVoiceRoomWatcher,
  playSound,
  SALA_VAZIA_MS,
  windowIsFocused,
} from "./lib/sounds.js"
import { motor, TOQUE_MAXIMO_MS } from "./sons/motor.js"
import {
  comecaAChamar,
  criarVigiaDaQueda,
  criarVigiaDasTransmissoes,
  ERRO_DA_CHAMADA_QUE_CAIU,
  FIM_DA_TRANSMISSAO_MS,
  haOutraPessoa,
  incomingRingStops,
  paraDeChamar,
} from "./sons/chamada.js"
import { caladaPeloSilencio, daPropriaConta, salaDaMensagem, somDaMensagem, somDaNotificacao, somDoCanal, somDoSilencio, tocaOToque } from "./sons/acontecimentos.js"
import { calarSalaComumUmaVez } from "./lib/salaComumCalada.js"
import { ContextMenu, type MenuItem } from "./screens/overlays/ContextMenu.js"
import { NotificationPanel } from "./screens/overlays/NotificationPanel.js"
import { ConvidarSheet, type ModoDeConvite } from "./screens/overlays/ConvidarSheet.js"
import { Prompt } from "./screens/overlays/Prompt.js"
import { ExpelModal } from "./screens/chat/ExpelModal.js"
import { DenunciarSheet } from "./screens/chat/DenunciarSheet.js"
import { RoomPicker } from "./screens/overlays/RoomPicker.js"
import { itemDeMover, itensDaCategoria, itensDaPessoaEmVoz, itensDaSala, itensDoCanal } from "./screens/chat/menuItems.js"
import { mudarCategoria, osQueFicaramParaTras } from "./screens/chat/categorias.js"
import { canalTemArvore } from "./screens/chat/arvoreDeSalas.js"
import { largarAntesDe, largarNaCategoria } from "./screens/chat/reordenar.js"
import { asQueFicaramParaTras, largarCategoriaEm } from "./screens/chat/reordenarCategorias.js"
import { NewCategory } from "./screens/overlays/NewCategory.js"
import { CategoryProperties } from "./screens/overlays/CategoryProperties.js"
import { NewRoom } from "./screens/overlays/NewRoom.js"
import { TicketsScreen } from "./screens/tickets/TicketsScreen.js"
import { useTickets } from "./hooks/useTickets.js"
import { RoomProperties } from "./screens/overlays/RoomProperties.js"
import { CargosEPermissoesLigado } from "./screens/overlays/CargosEPermissoesLigado.js"
import { QuemEscreve } from "./screens/overlays/QuemEscreve.js"
import { Button } from "./components/Button.js"
import { podeOrdenarCargos } from "./components/OrdemDosCargos.js"
import { SeccaoSalaAfk } from "./screens/overlays/SeccaoSalaAfk.js"
import { SeccaoDenuncias } from "./screens/overlays/SeccaoDenuncias.js"
import { useSalaAfk } from "./hooks/useSalaAfk.js"
import type { MudancaAfk } from "./lib/relogioAfk.js"
import { lembrarFichasDosCanais } from "./lib/tipoDoCanal.js"
import { juntarCopiaAoVivo } from "./lib/mesmaMensagem.js"

/** Exported for tests, which provide a mock bridge; the app itself only ever
 * renders through `App`, which owns the real provider. */
export const BridgeContext = createContext<EnclaveBridge | null>(null)

/** How often the connection is checked while the page is in view. See the pulse in `App`. */
export const INTERVALO_DO_PULSO_MS = 25_000
/** The socket silence below which the pulse does not even ask (1.3.7). */
export const SILENCIO_DO_PULSO_MS = 60_000

/** From the key of a refusal by macOS back to its device, for the button in the alert. */
const DISPOSITIVO_DA_RECUSA: Readonly<Record<string, DispositivoRecusado>> = Object.fromEntries(
  Object.entries(CHAVES_DA_RECUSA_DO_SISTEMA).map(([dispositivo, chave]) => [chave, dispositivo as DispositivoRecusado]),
)

/**
 * How much of a channel's stored history is seeded into React state: LINES of the
 * conversation, with the state between them (history-last-100, 1.3.26): the same
 * number the sync on joining brings (`HISTORY_PAGE_LINES`). It was 200 entries, and in
 * a channel with a busy polls room 200 entries could be all votes.
 */
const MEMORY_PER_CHANNEL = HISTORY_PAGE_LINES
/** Live appends trim beyond this, matching the vault's own per-channel cap.
 * Higher than the seed so paging older messages in is not undone by the next
 * arrival while someone is reading them. */
const MEMORY_HARD_CAP = 400
/** One click of "Load older", in lines (history-last-100: the same page the members serve). */
const HISTORY_PAGE = HISTORY_PAGE_LINES
/** How long the message we jumped to stays highlighted. See `.message.destacada`. */
const DESTAQUE_MS = 2600
/**
 * The same, with reduced motion: the highlight fades more slowly, and never
 * stops abruptly (house rule). A bit longer than the slow animation.
 */
const DESTAQUE_LENTO_MS = 5200

/**
 * The identity of a message in memory, to merge what the vault holds with what is
 * already on screen.
 *
 * Without `id`, the `seq`, and with the `t`: our own sends without echo all have
 * `seq` -1, and a bare `channel:-1` made every one of them the same message. A
 * reaction of ours read from the vault after a reload was thrown away because some
 * other send of ours was already in memory, and the chip was missing on the
 * device that pressed it (12/11/2026). A reaction also carries what it acts on:
 * two different acts never share a key; the same act twice (vault and live) does.
 */
export function keyOf(message: ChatMessage): string {
  const { payload } = message
  if (payload.id !== undefined) return `${message.channel}:${payload.id}`
  if (payload.t === "reaction") {
    return `${message.channel}:reaction:${message.seq}:${message.sender}:${payload.target ?? ""}:${payload.emoji ?? ""}:${payload.remove === true}`
  }
  return `${message.channel}:${payload.t}:${message.seq}`
}

export function toChatMessage(channel: string, entry: StoredChatMessage): ChatMessage {
  return {
    channel,
    seq: entry.seq,
    sender: entry.sender,
    // The order mark of a send without echo, so it folds where it was said (16/11/2026).
    ...(entry.seq < 0 && entry.apos !== undefined ? { apos: entry.apos } : {}),
    payload: entry.payload as ChatMessage["payload"],
  }
}

/**
 * The polls of a channel's archived conversation, with their edits (diag-votacao, 18/11/2026).
 *
 * The whole archive, page by page, from the newest: the polls room must find a poll however
 * old. Only polls, polls read without their poll (`votacaoSemPoder`) and edits of those stay,
 * so memory holds a few entries and not the archive. A page that does not open is skipped,
 * as "load older" skips it. A poll deleted after it was archived is not here at all: the
 * archive drops it (`apagadoNoArquivo`).
 */
export async function votacoesDoArquivo(
  channel: string,
  ler: EnclaveBridge["channels"]["conversaArquivada"],
): Promise<ChatMessage[]> {
  if (!ler) return []
  const todas: ChatMessage[] = []
  let cursor: number | null | undefined = undefined
  // `seguinte` only goes down, to `null`; the bound is a guard against a host that loops.
  for (let voltas = 0; voltas < 100_000; voltas++) {
    const { entradas, seguinte }: { entradas: StoredChatMessage[]; seguinte: number | null } = await ler(channel, cursor)
    for (const entry of entradas) todas.push(toChatMessage(channel, entry))
    if (seguinte === null) break
    cursor = seguinte
  }
  return soDasVotacoes(todas)
}

/**
 * Only what the polls room folds: the polls (and polls read without their poll), and the
 * edits, tombstones and votes that point at them (diag-votacao). A vault read holds the whole
 * state book, reactions and all, up to thousands of entries; the room folds a few.
 */
export function soDasVotacoes(todas: readonly ChatMessage[]): ChatMessage[] {
  const votacoes = new Set<string>()
  for (const message of todas) {
    const { payload } = message
    if (payload.t === "message" && payload.id && (votacaoDe(payload) !== null || payload.votacaoSemPoder === true)) votacoes.add(payload.id)
  }
  if (votacoes.size === 0) return []
  return todas.filter(({ payload }) => {
    if (payload.t === "message") return payload.id !== undefined && votacoes.has(payload.id)
    if (payload.t !== "edit" && payload.t !== "redact" && payload.t !== "post.reaction") return false
    return payload.target !== undefined && votacoes.has(payload.target)
  })
}

/**
 * A channel's reactions in memory, ready for `dobrarReaccoes`.
 *
 * A send of ours has no `seq` (it never comes back with one on this device). One
 * read from the vault keeps its own mark (`apos`, the highest `seq` seen when it
 * left). One still in flight gets the same mark here: the highest `seq` of this
 * channel before it in memory, which is arrival order. It was "last of all", and
 * with one reaction per person that made this device's old press win over a
 * switch another device of the account made later.
 */
export function reaccoesParaDobrar(messages: readonly ChatMessage[], channel: string): ChatMessage[] {
  const reaccoes: ChatMessage[] = []
  let maior = -1
  for (const message of messages) {
    if (message.channel !== channel) continue
    if (message.seq > maior) maior = message.seq
    if (message.payload.t !== "reaction") continue
    reaccoes.push(message.seq < 0 && message.apos === undefined ? { ...message, apos: maior } : message)
  }
  return reaccoes
}

/**
 * The vault's reactions of a channel and memory's, each act once (B6, 1.3.25).
 *
 * Memory wins: it is the newest copy, and it carries the mark of a send of ours
 * still in flight (`reaccoesParaDobrar`). The vault's go first, they are older.
 * `dobrarReaccoes` orders by the server anyway, and the same act twice changes nothing.
 */
export function reaccoesComAsDoCofre(doCofre: readonly ChatMessage[], daMemoria: readonly ChatMessage[]): ChatMessage[] {
  if (doCofre.length === 0) return [...daMemoria]
  const naMemoria = new Set(daMemoria.map(keyOf))
  return [...doCofre.filter((message) => message.payload.t === "reaction" && !naMemoria.has(keyOf(message))), ...daMemoria]
}

/** A poll vote: a `post.reaction` with a numeric `vote` (see `votosDe`). */
const ehVoto = (message: ChatMessage): boolean =>
  message.payload.t === "post.reaction" && typeof (message.payload as { vote?: unknown }).vote === "number"

/** Poll votes held on screen per channel: the vault's `TECTOS_DO_ESTADO.voto`. */
const MEMORY_VOTOS_CAP = TECTOS_DO_ESTADO.voto

/** The list without the channel's votes past `MEMORY_VOTOS_CAP`, in the vault's order of leaving. */
function semVotosAMais(lista: ChatMessage[], channel: string): ChatMessage[] {
  let votos = 0
  for (const item of lista) if (item.channel === channel && ehVoto(item)) votos += 1
  if (votos <= MEMORY_VOTOS_CAP) return lista
  const doCanal = lista.filter((item) => item.channel === channel)
  const { guardar, orfaos } = votosAGuardar(doCanal, (item) => item)
  // Down to 90 % of the bound, like the vault, so a sender at the bound does not fold the whole list on each vote.
  let aSair = votos - Math.floor(MEMORY_VOTOS_CAP * 0.9)
  const largar = new Set<ChatMessage>()
  const fases: ((item: ChatMessage) => boolean)[] = [
    (item) => !guardar.has(item) && !orfaos.has(item),
    (item) => orfaos.has(item),
    () => true,
  ]
  for (const fase of fases) {
    for (const item of doCanal) {
      if (aSair === 0) break
      if (ehVoto(item) && !largar.has(item) && fase(item)) {
        largar.add(item)
        aSair -= 1
      }
    }
  }
  return lista.filter((item) => !largar.has(item))
}

/**
 * The sort key of a line of `channel` at `indice`, the vault's (`chavesDeOrdem`):
 * its `seq`; for a send of ours without echo, its order mark (`apos`), or else the
 * `seq` of the nearest line of the channel before it (memory keeps them ascending).
 */
function chaveNaMemoria(lista: readonly ChatMessage[], indice: number): number {
  const linha = lista[indice] as ChatMessage
  if (linha.seq >= 0) return linha.seq
  if (linha.apos !== undefined && linha.apos >= 0) return linha.apos
  for (let i = indice - 1; i >= 0; i--) {
    const antes = lista[i] as ChatMessage
    if (antes.channel === linha.channel && antes.seq >= 0) return antes.seq
  }
  return -1
}

/**
 * Where a live arrival enters memory (ordem-resposta, 20/11/2026): at the end, or,
 * with a server `seq` N, before the lines of its channel at the end with a larger
 * key. Those are our sends whose echo gave them a larger `seq`, and our later sends
 * without echo. The vault's rule (`inserirPorSeq` in `vault.ts`). The first line of
 * the channel with a smaller key stops the walk: an arrival in order costs one
 * comparison of its channel.
 */
export function lugarPorSeq(lista: readonly ChatMessage[], message: ChatMessage): number {
  let lugar = lista.length
  if (message.seq < 0) return lugar
  for (let i = lista.length - 1; i >= 0; i--) {
    if ((lista[i] as ChatMessage).channel !== message.channel) continue
    if (chaveNaMemoria(lista, i) <= message.seq) break
    lugar = i
  }
  return lugar
}

/**
 * The echo of our message gave it the server `seq` (`bridge.on.eco`, ordem-resposta).
 * The line takes it, and the lines of its channel after it that the server numbered
 * BEFORE it move in front of it, in their order: the vault's rule
 * (`recuarOQueVeioAntes`). Without the line in memory, the list stays as it is.
 */
export function confirmarNaMemoria(lista: ChatMessage[], eco: { channel: string; id: string; seq: number }): ChatMessage[] {
  let indice = -1
  for (let i = lista.length - 1; i >= 0; i--) {
    const linha = lista[i] as ChatMessage
    if (linha.channel === eco.channel && linha.seq < 0 && linha.payload.t === "message" && linha.payload.id === eco.id) {
      indice = i
      break
    }
  }
  if (indice < 0) return lista
  const { apos: _marca, ...semMarca } = lista[indice] as ChatMessage
  const nossa: ChatMessage = { ...semMarca, seq: eco.seq }
  const antes: ChatMessage[] = []
  const depois: ChatMessage[] = []
  for (const linha of lista.slice(indice + 1)) {
    ;(linha.channel === eco.channel && linha.seq >= 0 && linha.seq < eco.seq ? antes : depois).push(linha)
  }
  return [...lista.slice(0, indice), ...antes, nossa, ...depois]
}

/** What is conversation on screen. Everything else (channels, roles, banner) is state the vault already stores. */
const DA_CONVERSA: ReadonlySet<string> = new Set(["message", "edit", "redact", "reaction"])

/**
 * Append one message, dropping the channel's oldest past the memory bound.
 *
 * What is not conversation leaves first (3/11/2026). Each entry in the common
 * channel makes both the cleanup person and the switcher say rooms and roles
 * again, and each of these payloads counted toward the cap as one message: in a
 * wave of new accounts they pushed old conversation off screen, and it only
 * came back on reload. Profiles do not even come here anymore (see `onMessage`).
 *
 * Poll votes do not count toward that bound (17/11/2026). A vote is not
 * conversation, so it used to be the first to go: in a busy channel the poll
 * stayed on screen and its count fell back to zero, own mark included. They have
 * their own bound instead (`MEMORY_VOTOS_CAP`, hotfix 1.3.19): without one, a member
 * sending votes to invented targets grew the list without end. Past it, the replaced
 * votes leave first, then those for no poll on screen, then the oldest
 * (`votosAGuardar`, the vault's rule).
 */
export function appendBounded(current: ChatMessage[], message: ChatMessage, tecto: number = MEMORY_HARD_CAP): ChatMessage[] {
  const lugar = lugarPorSeq(current, message)
  const next = semVotosAMais(
    lugar === current.length ? [...current, message] : [...current.slice(0, lugar), message, ...current.slice(lugar)],
    message.channel,
  )
  const conta = (item: ChatMessage): boolean => item.channel === message.channel && !ehVoto(item)
  const inChannel = next.reduce((count, item) => (conta(item) ? count + 1 : count), 0)
  if (inChannel <= tecto) return next
  let toDrop = inChannel - tecto
  const largar = new Set<ChatMessage>()
  for (const item of next) {
    if (toDrop === 0) break
    if (conta(item) && !DA_CONVERSA.has(item.payload.t)) {
      largar.add(item)
      toDrop -= 1
    }
  }
  for (const item of next) {
    if (toDrop === 0) break
    if (conta(item) && !largar.has(item)) {
      largar.add(item)
      toDrop -= 1
    }
  }
  return next.filter((item) => !largar.has(item))
}

/**
 * A batch of live messages into the list, in order, in ONE state update (hotfix 1.3.12).
 * `onMessage` queues what arrives in the same task and this runs once at its end.
 */
/**
 * How long a live batch waits for its frame before entering without one. Short
 * enough not to be seen as a delay; long enough for a frame at 30 Hz (Safari in
 * low power mode) to win and keep the per-frame batching.
 */
const PRAZO_DO_QUADRO_MS = 100

/**
 * `tectoDe`: the memory bound of each channel, `MEMORY_HARD_CAP` plus what the reader
 * loaded by hand there (carregar-antigas, 18/11/2026). See `loadOlder`.
 */
export function juntarLote(
  current: ChatMessage[],
  lote: readonly ChatMessage[],
  tectoDe: (channel: string) => number = () => MEMORY_HARD_CAP,
): ChatMessage[] {
  let lista = current
  for (const message of lote) lista = juntarCopiaAoVivo(lista, message) ?? appendBounded(lista, message, tectoDe(message.channel))
  return lista
}

/**
 * One click of "load older" from the vault: the newest entries memory does not hold,
 * up to `linhas` lines of the open conversation (carregar-antigas, 18/11/2026).
 *
 * The vault read is the conversation and the state book together, every room: votes,
 * reactions, edits, tombstones. A page of 100 ENTRIES was the rule, and in a channel
 * with a busy polls room a page was all votes: the click drew nothing, eight times in
 * a row. Now the page counts lines of the open conversation (`daConversa`) and brings
 * the state between them with it. `esgotou`: nothing older is left in the vault.
 */
export function paginaDoCofre(
  missing: readonly ChatMessage[],
  daConversa: (message: ChatMessage) => boolean,
  linhas: number = HISTORY_PAGE,
): { pagina: ChatMessage[]; linhas: number; esgotou: boolean } {
  let contadas = 0
  let inicio = missing.length
  while (inicio > 0 && contadas < linhas) {
    inicio -= 1
    if (daConversa(missing[inicio] as ChatMessage)) contadas += 1
  }
  return { pagina: missing.slice(inicio), linhas: contadas, esgotou: inicio === 0 }
}

/** Archive pages one click reads at most while they hold no line of the open conversation. */
const PAGINAS_DO_ARQUIVO_POR_TOQUE = 20

/** What counts toward a channel's memory bound (`appendBounded`): everything but poll votes. */
const contaNoTecto = (lista: readonly ChatMessage[]): number => lista.reduce((n, message) => (ehVoto(message) ? n : n + 1), 0)

export function useBridge(): EnclaveBridge {
  const bridge = useContext(BridgeContext)
  if (!bridge) throw new Error("App must be rendered inside a bridge provider")
  return bridge
}


/** No last activity: what `presenceFor` reads when the server relays live presence. */
const SEM_ACTIVIDADE: ReturnType<typeof lastActivityOf> = new Map()

/**
 * The root, behind the last line of defence (1.3.27). A throw in the body or an
 * effect of `AppSemProteccao` or the `Shell` unmounted the whole root: `#root`
 * empty, the dark background, and only the version banner from `main.tsx` on
 * top (the black screen on Android, iOS and Opera GX during the sync). Now the
 * crash card shows instead ("Error 901", Reload, Report a bug). The session and
 * the vault live outside React, so the sync goes on and a reload continues it.
 */
export function App(props: Parameters<typeof AppSemProteccao>[0]): React.JSX.Element {
  // `window.onerror` and `unhandledrejection` to the diagnostic log, once per page (`lib/falhas.ts`).
  useEffect(() => {
    capturarErrosGlobais()
  }, [])
  return (
    <ErrorBoundary bridge={props.bridge}>
      <AppSemProteccao {...props} />
    </ErrorBoundary>
  )
}

function AppSemProteccao({
  bridge,
  startupInvite,
  startupPairing,
  startupFriend,
  lotePorQuadro = false,
}: {
  bridge: EnclaveBridge
  /**
   * Live messages enter the list once per frame, not once per task. The web and the desktop pass it. Tests leave it off: there,
   * what arrives in one task is on screen at the end of that task.
   */
  lotePorQuadro?: boolean
  /** The invite the page opened with. Only the web passes it: see `StartupInvite`. */
  startupInvite?: StartupInvite
  /** The friend link the page opened with. Only the web passes it: see `StartupFriend`. */
  startupFriend?: StartupFriend
  /** The pairing link the page opened with. Only the web passes it: see `StartupPairing`. */
  startupPairing?: StartupPairing
}): React.JSX.Element {
  // Locking bumps the key, which unmounts the whole shell: every piece of
  // decrypted state — messages, drafts, names — dies with it, and the fresh
  // mount finds an existing vault and lands on the unlock gate.
  const [generation, setGeneration] = useState(0)
  /*
    The history sync between devices, read by the auto-lock (1.3.27). Here and not
    in the shell: the lock remounts the shell, and the gate still says the history
    waits for the unlock.
  */
  const historyForLock = useHistoryForLock(bridge)
  const [lockedMidSync, setLockedMidSync] = useState(false)
  const relock = useCallback(
    (reason: AutoLockReason = "manual") => {
      const running = historyForLock.read() !== null
      // The moment and the reason of each lock, for the diagnostic log (1.3.27).
      recordDiagnostic({ kind: "action", code: "vault-locked", detail: `reason=${reason} history=${running ? "running" : "idle"}` })
      setLockedMidSync(running)
      setGeneration((current) => current + 1)
    },
    [historyForLock.read],
  )
  // Taps on Service Worker alerts (installable web only, Android only) are heard
  // from startup, gate included, and not just with the vault open: see
  // `listenForSystemNoticeClicks`.
  useEffect(() => {
    listenForSystemNoticeClicks()
  }, [])
  /*
    The language, read at the highest point there is.

    `strings` replaces itself when the language changes, and a fresh read brings
    the right text immediately, but what is already drawn does not redraw by
    itself, because `strings` is not React state. Here at the top, not inside
    each screen: changing language changes the ENTIRE interface, and a tree
    drawn half in one language and half in another was the exact result this
    work exists to prevent. See `hooks/useLingua.ts`.
  */
  useLingua()
  /*
    How much the virtual keyboard covers, at the same highest point and for the
    same reason: the measure serves both the gate AND the conversation, and both
    draw below here. See `hooks/useVisualViewport.ts`.
  */
  useVisualViewport()
  /*
    The startup invite lives HERE, above the `Shell`, because the `Shell` dies
    and is reborn on each lock: stored inside it, an already rejected invite would
    ask again after each unlock. It resolves once, any way it does, and in that
    instant it also erases from what the host stored.
  */
  const [conviteAEspera, setConviteAEspera] = useState<ConviteLido | null>(startupInvite?.invite ?? null)
  const [conviteInvalido, setConviteInvalido] = useState(startupInvite?.invalid ?? false)
  // The startup short link, until the server says the channel (5b-2). Here at the
  // top for the same reason as the invite: the `Shell` is reborn on each lock.
  const [conviteCurtoAEspera, setConviteCurtoAEspera] = useState<string | null>(startupInvite?.curta ?? null)
  const resolverConvite = useCallback(() => {
    startupInvite?.forget()
    setConviteAEspera(null)
    setConviteCurtoAEspera(null)
    setConviteInvalido(false)
  }, [startupInvite])
  /*
    The invite waiting is also what lets a NEW account past the limit of new
    accounts per network (1.3.26, Erro 234). The session keeps the link in
    memory, and shows only a proof of it, at the first login of an account it
    is registering. An existing account never sends it.
  */
  useEffect(() => {
    const link = conviteAEspera ? formatInviteLink(conviteAEspera.server, conviteAEspera.channel, conviteAEspera.code) : conviteCurtoAEspera
    bridge.session.definirConviteDeComunidade?.(link)?.catch(() => {})
  }, [bridge, conviteAEspera, conviteCurtoAEspera])
  /** The resolved short link becomes an invite like any other, and follows their path. */
  const curtaResolvida = useCallback((convite: ConviteLido) => {
    setConviteCurtoAEspera(null)
    setConviteAEspera(convite)
  }, [])
  /*
    The startup friend link, along the same path and for the same reason: here
    at the top, so it does not ask again on each unlock. It resolves once, after
    the gate, opening that person's profile page.
  */
  const [amigoAEspera, setAmigoAEspera] = useState<string | null>(startupFriend?.address ?? null)
  const [amigoInvalido, setAmigoInvalido] = useState(startupFriend?.invalid ?? false)
  const resolverAmigo = useCallback(() => {
    startupFriend?.forget()
    setAmigoAEspera(null)
    setAmigoInvalido(false)
  }, [startupFriend])
  /*
    An invite or friend link clicked INSIDE the app (1.3.25): the same pending
    state as the startup link, so it follows the same path after the gate. A
    new link replaces the one waiting, whatever form each takes. Message links
    are opened in the `Shell`, which knows the channels. See `useLigacoesInternas`.
  */
  const abrirLigacaoInterna = useCallback((ligacao: LigacaoInterna) => {
    if (ligacao.tipo === "convite" || ligacao.tipo === "convite-curto" || ligacao.tipo === "convite-invalido") {
      setConviteAEspera(ligacao.tipo === "convite" ? ligacao.convite : null)
      setConviteCurtoAEspera(ligacao.tipo === "convite-curto" ? ligacao.curta : null)
      setConviteInvalido(ligacao.tipo === "convite-invalido")
    } else if (ligacao.tipo === "amigo" || ligacao.tipo === "amigo-invalido") {
      setAmigoAEspera(ligacao.tipo === "amigo" ? ligacao.address : null)
      setAmigoInvalido(ligacao.tipo === "amigo-invalido")
    }
  }, [])
  /*
    Deleting the account takes the invite with it.

    The pending invite is from WHO opened the link. Locking does not touch it:
    whoever unlocks is the same person. Deleting the account is different: what
    comes next in this tab is a new account, and inheriting an entry request from
    the old one would start it with a question nobody asked.

    Here, wrapping the bridge's `destroy`, not in every place that calls it
    (Settings, the "forgot password" in the gate): the next one to show up gets
    it covered without knowing this. After `destroy` runs clean, and only then:
    when leaving channels fails over network the account stays up, and the invite
    with it. The bridge learns nothing: who knows how to delete what the host
    stored is the `forget` it gave.
  */
  const ponte = useMemo<EnclaveBridge>(
    () => ({
      ...bridge,
      vault: {
        ...bridge.vault,
        destroy: async () => {
          // Read before: after the destroy another account may be the active one.
          const accountId = await activeAccountId(bridge)
          const feito = await bridge.vault.destroy()
          // The account left this device: its stored display name goes too. See `lib/accountNames.ts`.
          forgetAccountName(accountId)
          // The reads and browser archive belonged to the account that ended. See `migrar`.
          esquecerEstadoDoBrowser()
          resolverConvite()
          resolverAmigo()
          return feito
        },
      },
    }),
    [bridge, resolverConvite, resolverAmigo],
  )
  return (
    <BridgeContext.Provider value={ponte}>
      <ToastProvider>
        {/* The `Confirmar` questions live here, like the alerts: on top of every screen,
            and with no state in whoever asks. */}
        <ConfirmarProvider>
          <Shell
            key={generation}
            lotePorQuadro={lotePorQuadro}
            onRelock={relock}
            historyForLock={historyForLock}
            lockedMidSync={lockedMidSync}
            conviteAEspera={conviteAEspera}
            conviteCurtoAEspera={conviteCurtoAEspera}
            onCurtaResolvida={curtaResolvida}
            conviteInvalido={conviteInvalido}
            onConviteResolvido={resolverConvite}
            amigoAEspera={amigoAEspera}
            amigoInvalido={amigoInvalido}
            onAmigoResolvido={resolverAmigo}
            onLigacaoInterna={abrirLigacaoInterna}
            {...(startupPairing ? { emparelhamentoDeArranque: startupPairing } : {})}
          />
        </ConfirmarProvider>
      </ToastProvider>
    </BridgeContext.Provider>
  )
}

/**
 * Where a friend alert happened that is not "came online": the community, and the
 * voice room when it is voice. See `avisarAmigoRef`.
 */
interface SitioDoAviso {
  canal: string
  sala?: string | undefined
}

function Shell({
  lotePorQuadro = false,
  onRelock,
  historyForLock,
  lockedMidSync = false,
  conviteAEspera,
  conviteCurtoAEspera = null,
  onCurtaResolvida,
  conviteInvalido,
  onConviteResolvido,
  amigoAEspera = null,
  amigoInvalido = false,
  onAmigoResolvido,
  onLigacaoInterna,
  emparelhamentoDeArranque,
}: {
  /** See `App`'s `lotePorQuadro`. */
  lotePorQuadro?: boolean
  /** Lock and remount, with the reason for the diagnostic log. */
  onRelock: (reason?: AutoLockReason) => void
  /** The history sync for the auto-lock (1.3.27). See `useHistoryForLock`. */
  historyForLock?: { active: boolean; read: () => HistoryForLock | null }
  /** The vault locked during a history sync: the gate says the history waits for the unlock. */
  lockedMidSync?: boolean
  conviteAEspera: ConviteLido | null
  /** The startup short link, waiting to be resolved on the server. */
  conviteCurtoAEspera?: string | null
  onCurtaResolvida?: (convite: ConviteLido) => void
  conviteInvalido: boolean
  onConviteResolvido: () => void
  /** The address of the startup friend link, waiting to be opened. */
  amigoAEspera?: string | null
  /** The page opened from a friend link that cannot be read. */
  amigoInvalido?: boolean
  onAmigoResolvido?: () => void
  /** An invite or friend link clicked inside the app. See `abrirLigacaoInterna` in `App`. */
  onLigacaoInterna?: (ligacao: LigacaoInterna) => void
  emparelhamentoDeArranque?: StartupPairing
}): React.JSX.Element {
  const bridge = useBridge()
  const [stage, setStage] = useState<Stage>("loading")
  /** How many times the gate entered: each entry holds the opening a little. See `usePostLoginHold`. */
  const [entrada, setEntrada] = useState(0)
  /**
   * This device was revoked from the account on another device (`device-revoked`).
   * The session already disconnected; the interface locks the vault and goes back
   * to the gate, and the gate says why, with the code. See `handleStatus`.
   */
  const [aparelhoRevogado, setAparelhoRevogado] = useState(false)
  /** The same refusal, for a device that was never in the manifest: its pairing did not finish (1.3.20). */
  const [emparelhamentoPorAcabar, setEmparelhamentoPorAcabar] = useState(false)
  /**
   * The same revocation, read instantly. On cold startup the order is: the
   * silent attempt opens the vault, `connect()` gets `device-revoked`, the core
   * emits the status and only then rejects, and Unlock calls `enter`. The
   * `vault.lock()` from `handleStatus` is async and arrives later: without this
   * latch, `enter` put the app "ready" with the vault locking, and the gate
   * mounted again with no phrase and retried, in a loop. Only `checkVault`
   * (start over, try again) stops it.
   */
  const aparelhoRevogadoRef = useRef(false)
  /** The removal came with the proof, and the vault is being erased (1.3.16): the stage is decided there. */
  const aparelhoRemovidoRef = useRef(false)
  /**
   * The server suspended this account (`account-suspended`, reports §8). Unlike
   * revocation, the vault stays open: the review request goes signed by this
   * device. The gate shows `ContaSuspensa` with the notice (or without it, if
   * unread). The ref is the same latch as `aparelhoRevogadoRef`: the status
   * arrives before `connect()` rejects, and `enter` reads it.
   */
  const [avisoDeSuspensao, setAvisoDeSuspensao] = useState<AvisoDeSuspensao | null>(null)
  const contaSuspensaRef = useRef(false)
  /** Switch to the gate and remount, idle, when `enter` is refused. */
  const [vezDoPortao, setVezDoPortao] = useState(0)
  /** The stage, as read by the caller at the moment of a session event. */
  const stageRef = useRef<Stage>("loading")
  stageRef.current = stage
  const [bootError, setBootError] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  /*
    The images decrypted from the store (the `blob:` cache, up to 64 MB) do
    not survive locking, signing out or switching account: outside the
    "ready" screen and on each new account, everything is revoked (Task 10).
  */
  useEffect(() => {
    if (stage !== "ready") cacheDeMedia.esvaziar()
  }, [stage])
  useEffect(() => () => cacheDeMedia.esvaziar(), [address])
  const [channels, setChannels] = useState<string[]>([])
  /**
   * The channel open at the conversation destination. Never a direct message.
   *
   * Two pointers, not one, because there are two destinations: channels live in
   * "Conversations" and two-person chats live in "Friends". With one pointer
   * alone, opening a direct would leave the channel destination pointing to a
   * channel that the sidebar no longer lists, and tapping "Conversations" would
   * bring the direct back to a place from which it had been deliberately removed.
   */
  const [canal, setCanal] = useState<string | null>(null)
  /** The direct message open in Friends. The other pointer. */
  const [directa, setDirecta] = useState<string | null>(null)
  /**
   * Conversations removed from the list, and when they were removed.
   *
   * **Closing is not deleting**, and that is why this is a cleanup marker and
   * not a removal: the group stays intact, the history stays in the vault, and
   * the line reappears by itself as soon as a message arrives. It is the account
   * archive (phase 5): closing on the phone closes on the computer. See
   * `lib/directs.ts` and `lib/estadoDaConta.ts`.
   */
  const directasFechadas = useEstadoDaConta().arquivo
  /** The tab chosen in Friends. Lives here because the banner and the body share
   * it, and two states of the same choice diverge at the first distraction. */
  const [peopleTab, setPeopleTab] = useState<PeopleTab>("amigos")
  /** The conversation list, open as a drawer. Only counts on narrow screens. */
  const [listaAberta, setListaAberta] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState<"channel" | "amigo" | "link" | null>(null)
  /**
   * The invite sheet open: to which channel, to whom, and in what mode.
   *
   * The channel is ALWAYS written, and it is the one from the click location:
   * the menu of a channel in the sidebar may be from a different channel than
   * the one open, and the old invite prompt used the open one. Null only when
   * the source is a person's menu, which does not know which channel: there you
   * pick one first from the channel list.
   */
  const [convidar, setConvidar] = useState<{
    channel: string | null
    pessoa?: string
    modo?: ModoDeConvite
    /** The channel the choice list brings marked. */
    preferido?: string
  } | null>(null)
  /**
   * What is being renamed with the `Prompt`: a room of the open channel, or a
   * category of it. Used to be a `window.prompt`, with no theme and no house words.
   */
  const [aRenomear, setARenomear] = useState<
    | { tipo: "sala"; canal: string; room: string; nome: string }
    | { tipo: "categoria"; canal: string; categoria: string }
    | null
  >(null)
  /**
   * A request for the status line to enter edit mode, coming from "Custom…" in
   * the activity menu. A number that goes up, not a click on the DOM: the menu
   * was clicking any `.status-line` it found on the page.
   */
  const [pedidoDeEstado, setPedidoDeEstado] = useState(0)
  /**
   * The person pages open, bottom to top, mirroring the browser history. See
   * `usePilhaDaPessoa`.
   */
  /**
   * The browser back button took phone levels away (option B, 20/11/2026).
   * A ref, because the stack is made once and the levels are decided below.
   */
  const voltarAteRef = useRef<(base: number) => void>(() => {})
  const pilhaDaPessoa = usePilhaDaPessoa((base) => voltarAteRef.current(base))
  const fecharPessoa = pilhaDaPessoa.fechar
  const [view, mudarDeVista] = useState<View>("chat")
  /**
   * The phone layout (option B, 20/11/2026), and the state it adds.
   *
   * Four tabs at the bottom. Each tab is a list, and a conversation (or a
   * screen of "Tu") is pushed over it. These are the levels the desktop does
   * not have; `view`, `canal` and `directa` stay what they always were, and
   * the tab is read from them (see `separador` below).
   *
   * Only `useTelemovel()` turns this on: at 841 px and up nothing here is read.
   */
  const telemovel = useTelemovel()
  /** The last tab chosen by hand. Decides Messages or Friends when no conversation is open. */
  const [separadorEscolhido, setSeparadorEscolhido] = useState<Separador>("comunidades")
  /** Communities: the conversation of the open channel is pushed over the list. */
  const [conversaNoTelemovel, setConversaNoTelemovel] = useState(false)
  /** The conversation whose members are pushed over it. A key, so a new conversation starts closed. */
  const [membrosDe, setMembrosDe] = useState<string | null>(null)
  /** "Tu": the screen pushed over its list (Profile, Feed or Settings), and whether it is open. */
  const [tuAberto, setTuAberto] = useState(false)
  /** The screen "Tu" shows when its tab is chosen: the last one opened. */
  const [ecraDoTu, setEcraDoTu] = useState<"perfil" | "social" | "config">("perfil")
  /** Messages' open direct conversation, kept while Friends is on screen. */
  const directaGuardada = useRef<string | null>(null)
  /** Each tab's scroll positions, kept while another tab is on screen. */
  const rolagens = useRef(new Map<Separador, Map<string, number>>())
  const guardarRolagem = (deste: Separador): void => {
    const raiz = document.querySelector(".app.telemovel")
    if (raiz) rolagens.current.set(deste, lerRolagens(raiz))
  }
  /**
   * Switching destination closes the person page.
   *
   * The page occupies the main area above the open destination, and any move to
   * another place (the rail, a channel, a conversation, a notification) exits it.
   * In one place, not in each of twenty calls: whichever forgot would leave the
   * page on top of the new destination.
   */
  const setView = useCallback(
    (vista: View, origem?: "separador") => {
      fecharPessoa()
      mudarDeVista(vista)
      /*
        On the phone, a move to a destination that did not come from a tab is
        a move to something IN it: a notification, a link, "Open channel" on a
        page, a new channel. It pushes the conversation (or the screen of
        "Tu") over the list. A tab shows the list. On a computer these
        three states are never read.
      */
      if (origem === "separador") return
      if (vista === "chat") setConversaNoTelemovel(true)
      else if (vista === "pessoas") setSeparadorEscolhido("amigos")
      else setTuAberto(true)
    },
    [fecharPessoa],
  )
  /**
   * The open conversation RIGHT NOW, the channel whose messages, members and
   * roles are read.
   *
   * Derived and not stored: who is in Friends is in a direct message, who is in
   * Conversations is in a channel, and neither can take the other's place. All
   * that followed `active` keeps following without changing a line, what
   * changes is that there is now a right answer for "which conversation is open"
   * at each destination, instead of one blindly shared by both.
   */
  const active = view === "pessoas" ? directa : canal
  /**
   * The phone tab on screen, read from the destination: Communities is the
   * channels, "Tu" is Profile, Feed and Settings. In Friends, an open direct
   * conversation is Messages; with none, the last of the two chosen by hand.
   */
  const separador: Separador =
    view === "chat"
      ? "comunidades"
      : view === "pessoas"
        ? directa !== null || separadorEscolhido === "mensagens"
          ? "mensagens"
          : "amigos"
        : "tu"
  /** A conversation is pushed full screen over its list (phone only). */
  const naConversa =
    telemovel &&
    ((separador === "comunidades" && conversaNoTelemovel && canal !== null) ||
      (separador === "mensagens" && directa !== null))
  const membrosNoTelemovel = naConversa && active !== null && membrosDe === active
  /**
   * How many screens sit over the list: 1 a conversation (or a screen of
   * "Tu"), 2 the members over a conversation. Each one is a history entry,
   * so the browser back button and the system back gesture go back one.
   */
  const profundidade = !telemovel
    ? 0
    : naConversa
      ? membrosNoTelemovel
        ? 2
        : 1
      : separador === "tu" && tuAberto
        ? 1
        : 0
  /**
   * The conversation on screen, for what reading marks as read. On the phone
   * the list of a channel is not its conversation: the unread counts stay
   * until the conversation is opened. On a computer this is `active`.
   */
  const activoNoEcra = telemovel && !naConversa ? null : active
  /* The history follows the phone levels: one entry per pushed screen. See `definirBase`. */
  const definirBase = pilhaDaPessoa.definirBase
  useEffect(() => {
    definirBase(profundidade)
  }, [definirBase, profundidade])
  /**
   * Back on the phone, to `ate` screens over the list (option B, 20/11/2026).
   *
   * The same function for the back arrow, the swipe from the left edge, a tap
   * on the open tab, and the browser back button (`voltarAteRef`, called by
   * `usePilhaDaPessoa`). The history follows by itself: see the effect that
   * calls `definirBase`.
   */
  const voltarAte = (ate: number): void => {
    if (ate < 2) setMembrosDe(null)
    if (ate >= 1) return
    if (separador === "comunidades") setConversaNoTelemovel(false)
    else if (separador === "mensagens") {
      setDirecta(null)
      directaGuardada.current = null
    } else if (separador === "tu") setTuAberto(false)
  }
  voltarAteRef.current = voltarAte
  const voltarNoTelemovel = (): void => voltarAte(profundidade - 1)

  /* "Tu" opens on the last of its screens. */
  useEffect(() => {
    if (view === "perfil" || view === "social" || view === "config") setEcraDoTu(view)
  }, [view])
  /* A tab that comes back has its lists where they were. */
  useLayoutEffect(() => {
    if (!telemovel) return
    const raiz = document.querySelector(".app.telemovel")
    const lidas = rolagens.current.get(separador)
    if (raiz && lidas) reporRolagens(raiz, lidas)
  }, [telemovel, separador])
  const [profile, setProfile] = useState<Profile>({ displayName: "", donations: [] })
  const [editingProfile, setEditingProfile] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>("offline")
  const [connectionDetail, setConnectionDetail] = useState<string | null>(null)
  /**
   * When the connection dropped, for the banner to say "2 min ago".
   *
   * Only after it has been connected once: the first "connecting" at startup is
   * not a drop, and saying "no connection for less than 1 min" to someone who
   * just opened the app reads as a fault. A first connection that fails is
   * something else, and `enter` marks it.
   */
  const [caiuEm, setCaiuEm] = useState<number | null>(null)
  const jaEsteveLigada = useRef(false)
  /** The connection right now, so window listeners do not register on every change. */
  const connectionRef = useRef<ConnectionState>("offline")
  connectionRef.current = connection
  const [callChannel, setCallChannel] = useState<string | null>(null)
  /** The call as a floating popup, chosen by the person — or forced by
   * leaving the room/tab, which is handled where the dock renders. */
  const [callPopup, setCallPopup] = useState(false)
  /**
   * "Watch stage only": the call takes the whole window, with no rail, sidebar
   * and member list. Exit with the same button or with Esc, and exits by itself
   * when the call ends.
   */
  const [soPalco, setSoPalco] = useState(false)
  useEffect(() => {
    if (!soPalco) return
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === "Escape" && !evento.defaultPrevented) setSoPalco(false)
    }
    window.addEventListener("keydown", aoTeclar)
    return () => window.removeEventListener("keydown", aoTeclar)
  }, [soPalco])
  const ecraLargo = useEcraLargo()
  /** Right click on a conversation in the Friends list. See `itensDaConversa`. */
  const [conversaMenu, setConversaMenu] = useState<{ channel: string; at: { x: number; y: number } } | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  /**
   * Where this call's media goes: through the SFU, or through the mesh.
   *
   * The core says it at the moment it is decided, in the `call-caminho`
   * diagnostic, and until here that went straight to telemetry and nothing else.
   * The screen needs it for one reason only, the reason this state exists: in an
   * SFU call a person's `connected` means "media reaches me from them", not
   * "they are connecting". Without knowing the path, the interface cannot say
   * different things for different states. See `lib/estadoDaChamada.ts`.
   *
   * `null` until the core speaks, and `null` speaks as the mesh always did.
   */
  const [caminhoDeMedia, setCaminhoDeMedia] = useState<CaminhoDeMedia>(null)
  /**
   * The alert for this call, when there is one the person has the right to read.
   *
   * One at a time, and the last to arrive wins: two alerts stacked in a banner
   * inside the call card is the popup column that `statusPolicy` exists to not
   * repeat. Which ones go in is decided in `avisoDaChamada`, and the whole
   * mechanic keeps going to telemetry.
   */
  const [avisoDeChamada, setAvisoDeChamada] = useState<AvisoDaChamada | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  /**
   * The screen this account is sharing, if it is.
   *
   * Stored here and not in the call panel because it has two readers: the panel,
   * which puts it on stage, and the DOCK, which swaps "In call" for "Sharing
   * screen". The dock exists precisely when the panel is not on screen, keeping
   * the fact inside the panel was hiding it from who needs it.
   */
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  /**
   * Are we playing music in the call? Only for the transmission signal in the
   * banner: it hears the same `music` event that the player hears, without
   * mounting it.
   */
  const [minhaMusica, setMinhaMusica] = useState(false)
  useEffect(() => {
    const chamada = bridge.call as EnclaveBridge["call"] & { musica?: unknown }
    setMinhaMusica((chamada.musica ?? null) !== null)
    if (typeof chamada.on !== "function") return
    return chamada.on("music", (evento) => setMinhaMusica(evento.estado !== null))
  }, [bridge])
  /**
   * The camera off by choice, here and not just in the call panel, so the
   * keyboard shortcut and the button move the SAME state. Turns back on when
   * the call ends: the choice was for that call.
   */
  const [cameraOff, setCameraOff] = useState(false)
  const [menu, setMenu] = useState<{ channel: string; at: { x: number; y: number } } | null>(null)
  /**
   * The room open inside the channel. Empty is the default room.
   *
   * Stored per channel: switching channels and coming back returns the person
   * to the room they were in, which is what anyone expects from a structured list.
   */
  const [activeRooms, setActiveRooms] = useState<Record<string, string>>({})
  /** The voice room where the call is. Empty is the channel call. */
  const [callRoom, setCallRoom] = useState("")
  /** Channel whose properties are open. */
  const [propriedades, setPropriedades] = useState<string | null>(null)
  /** The sheet was opened from the "manage roles" entry: it opens with the section in view. */
  const [propriedadesNosPapeis, setPropriedadesNosPapeis] = useState(false)
  /** Channel where a room is being created. */
  const [novaSalaEm, setNovaSalaEm] = useState<string | null>(null)
  /** The category a new room starts in, from a category's `+` or menu (1.3.25). Empty: none. */
  const [categoriaDaNovaSala, setCategoriaDaNovaSala] = useState("")
  /** Internal channel (room) under the context menu. */
  const [roomMenu, setRoomMenu] = useState<{ room: string; at: { x: number; y: number } } | null>(null)
  /** Right click on a category header. See `itensDaCategoria`. */
  const [categoriaMenu, setCategoriaMenu] = useState<{ category: string; at: { x: number; y: number } } | null>(null)
  /**
   * Who is in each voice room, by channel and room.
   *
   * Built from the join and leave announcements this device heard, and that is
   * what it promises: life as seen, not a server record, which does not exist,
   * because the server does not know what a voice room is. Who was already there
   * before we connected appears when they announce again.
   *
   * The key joins channel and room: two voice rooms are two calls, and adding
   * them was going back exactly to what we tried to undo.
   */
  /** Per voice room: who is there, and when they last said so. */
  const [vozPorSala, setVozPorSala] = useState<Map<string, Map<string, number>>>(new Map())
  /**
   * What each person transmits in each voice room (screen, music), read from the
   * presence announcement (phase 1i). It is what lights the transmission signal
   * in rooms where WE are not. Only read with a live presence in `vozPorSala`.
   */
  const [transmitePorSala, setTransmitePorSala] = useState<Map<string, Map<string, Transmissao>>>(new Map())
  /** Right click on someone in a voice room. See `itensDaPessoaEmVoz`. */
  const [vozMenu, setVozMenu] = useState<{ room: string; address: string; at: { x: number; y: number } } | null>(
    null,
  )
  /** Channel where a category is being created. Sheet separate from the rooms one. */
  const [novaCategoriaEm, setNovaCategoriaEm] = useState<string | null>(null)
  /**
   * The category whose visibility is open, by name.
   *
   * By name because the name IS the key of a category, unlike rooms and roles,
   * where the identifier and the label are different things. See
   * `channel.category`. Always from the open channel: the sheet only reaches it
   * from the menu of a category header, and that header lives in the open
   * channel's tree.
   */
  const [visibilidadeDe, setVisibilidadeDe] = useState<string | null>(null)
  /** The text room whose "who writes" sheet is open (read-only rooms, 12/11/2026). Always in the open channel. */
  const [quemEscreveEm, setQuemEscreveEm] = useState<{ room: string; nome: string } | null>(null)
  /**
   * The removal waiting for confirmation: who, and from which channel.
   *
   * The two together, not just the address, because the same person may be in
   * several channels and the gesture is from one channel only. Null is "none in
   * progress".
   */
  const [expelling, setExpelling] = useState<{ who: string; channel: string } | null>(null)
  /**
   * The person to report, and the shared channel through which they were found.
   * No channel (the Friends list), the report goes without messages. See
   * `DenunciarSheet`.
   */
  const [aDenunciar, setADenunciar] = useState<{ who: string; canal: string | null } | null>(null)
  /**
   * The person whose profile is open, and the channel through which they were found.
   *
   * Lives up here because a profile shows the person's posts, and the whole
   * thread only exists at this moment. The channel travels along because of the
   * safety number: it comes from the keys of both people inside a group, and
   * without a shared group there is no number to offer.
   */
  const entradaDaPessoa = pilhaDaPessoa.actual
  const pessoaAddress = entradaDaPessoa?.address ?? null
  const pessoaChannel = entradaDaPessoa?.channel ?? null
  const pessoa = useMemo(
    () => (pessoaAddress === null ? null : { address: pessoaAddress, channel: pessoaChannel }),
    [pessoaAddress, pessoaChannel],
  )
  const abrirPessoa = pilhaDaPessoa.abrir
  /** Member being verified, with the number once resolved. */
  const [verifying, setVerifying] = useState<{ address: string; number: string | null } | null>(null)
  /** Right-click over a person, anywhere: member list, feed author, Pessoas. */
  const [userMenu, setUserMenu] = useState<{
    address: string
    /** A channel the two of us share, when the click site knows one. */
    channel: string | null
    at: { x: number; y: number }
  } | null>(null)
  const [members, setMembers] = useState<string[]>([])
  const [membersState, setMembersState] = useState<"loading" | "error" | "ready">("loading")
  /** Accounts in the open channel with keys that the server says are gone (P7). */
  /** Channel → people currently in a call there. */
  const [ringing, setRinging] = useState<Map<string, Map<string, number>>>(new Map())
  /** The social composer's unpublished post. Held here, like the chat drafts,
   * so leaving the Social tab and coming back finds it intact. */
  const [socialDraft, setSocialDraft] = useState<SocialDraft>({ caption: "", images: [], links: [] })
  /** Bumped by "Nova publicação": the Social screen focuses its composer on
   * the change, so the button lands you ready to type, not just on the tab. */
  const [composeSignal, setComposeSignal] = useState(0)
  /** Names remembered by the vault, seeded once after unlock. */
  /** Reading the saved notifications failed, and the bell needs to report it. */
  const [notifFalhou, setNotifFalhou] = useState(false)
  const [directorySeed, setDirectorySeed] = useState<ReadonlyMap<string, Profile>>(() => new Map())
  /** Channels whose vault history was non-empty at unlock — they get the divider. */
  const [seededChannels, setSeededChannels] = useState<ReadonlySet<string>>(() => new Set())
  /** Channels with stored messages older than what is in memory. */
  const [olderAvailable, setOlderAvailable] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  /** Bumped on every epoch event, which is when membership can have changed. */
  const [epochTick, setEpochTick] = useState(0)
  /** Who is connected right now, straight from the server's presence relay. */
  const [online, setOnline] = useState<ReadonlySet<string>>(() => new Set())
  /** Whether the connected server relays live presence at all. */
  const [livePresence, setLivePresence] = useState(false)
  /**
   * The common channel that THIS server announces, and the only source of truth.
   *
   * State, not a constant: it comes from `hello.ok`, so it only exists after the
   * connection opens, and changes if the user moves the account to another server.
   * Until it arrives, it is `null`, and a `null` makes `ehCanalOficial` answer no to
   * everything, the common channel appears as a normal channel for the second while
   * the connection is opening, which is the right mistake to make: showing the badge
   * too early is a delay, showing it too late would be a lie.
   */
  const [commonRoom, setCommonRoom] = useState<string | null>(null)
  /** Who is seated in MY feed, read from its own key tree. The other half of
   * the circle: these people read me, whether or not I read them yet. */
  const [myFeedMembers, setMyFeedMembers] = useState<string[]>([])
  /** Accounts on this server, when the operator runs community mode. */
  const [community, setCommunity] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * Who has a response halfway through being given to an INVITE to join a channel.
   *
   * Friend requests have theirs, inside `useAmizade`.
   *
   * Not state about the invite, that all comes from the folded events. It is state
   * about the button, and it exists because the response takes time: accepting is an
   * MLS commit, and between the click and the end there are seconds when a second
   * click should send nothing and the screen should not go silent.
   */
  const [respondendo, setRespondendo] = useState<string | null>(null)
  /** The in-app notification log, seeded from the vault after unlock. */
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  /**
   * The ids already in the bell, read at event time (12/11/2026). An entry that
   * is already there (the same message again, by recovery, a relay or a second
   * path) does not ring or alert twice.
   */
  const idsNoSino = useRef(new Set<string>())
  for (const entrada of notifications) idsNoSino.current.add(entrada.id)
  // Bounded: the oldest leave first (a `Set` keeps insertion order).
  while (idsNoSino.current.size > IDS_NO_SINO_MAX) {
    const [primeiro] = idsNoSino.current
    if (primeiro === undefined) break
    idsNoSino.current.delete(primeiro)
  }
  const [notifAt, setNotifAt] = useState<{ x: number; y: number } | null>(null)
  /** The account's devices, read when the bell opens: "Remove" on a new-device entry only while it is here (1.3.26). */
  const [aparelhosNaConta, setAparelhosNaConta] = useState<ReadonlySet<string> | undefined>(undefined)
  const [aparelhoARemover, setAparelhoARemover] = useState<string | null>(null)
  /** Where the activity menu is anchored, when open. */
  const [activityMenu, setActivityMenu] = useState<{ x: number; y: number } | null>(null)
  /**
   * The open section of settings.
   *
   * It lives here because it is read in two places: the sidebar draws the menu, the
   * panel shows the chosen one. In memory and not on disk, opening settings restarts
   * at Account, which is the first section.
   */
  const [seccaoConfig, setSeccaoConfig] = useState<SeccaoConfig>("conta")
  /**
   * The menus for the microphone and sound dropdown arrows, and where they are anchored.
   *
   * One state with just the kind inside it, not two: they are mutually exclusive,    * opening one has to close the other, and with two states that would become a rule
   * written by hand everywhere one opens.
   */
  const [audioMenu, setAudioMenu] = useState<{ qual: "mic" | "som"; at: { x: number; y: number } } | null>(null)
  /** How this device chose to appear. Read from prefs before the first
   * connect, so invisibility never flickers online on reload. */
  const [activity, setActivity] = useState<Activity>(() => readPrefs().activity)
  /**
   * The microphone and sound of calls, in one place.
   *
   * Up here and not inside the call panel, which is where they used to be: the buttons
   * moved to the identity card in the sidebar, which exists with or without a call,
   * and the panel still shows them. Two components with their own state for the same
   * fact end up disagreeing, and a button saying "muted" next to another saying it
   * is not is no worse than not having them at all.
   *
   * Read from preferences on startup, like activity: someone who muted themselves
   * yesterday does not want to be heard today because the app forgot.
   */
  const [micMuted, setMicMuted] = useState(() => readPrefs().micMuted)
  const [soundOff, setSoundOff] = useState(() => readPrefs().soundOff)
  /** Guards persistence until the stored log has been loaded. */
  const notifLoaded = useRef(false)
  /** Channels this device opened itself: their appearance is not news. */
  const selfOpened = useRef(new Set<string>())
  /** The previous channels list, to tell arrivals from the initial seed. */
  const prevChannels = useRef<string[] | null>(null)

  /** Mirrored for callbacks that must read the current list without re-binding. */
  const messagesRef = useRef<ChatMessage[]>([])
  /**
   * Per channel, how much the reader loaded by hand with "load older" (carregar-antigas,
   * 18/11/2026). The next arrival used to drop the oldest lines, which were exactly the
   * ones just asked for. With something loaded by hand, the bound is what was loaded plus
   * twice `MEMORY_HARD_CAP`: memory was often already at the bound before the click (a
   * catch-up fills it), and the reader at the top gets a full bound of arrivals before
   * anything above them is cut. Only grows by a click, and only for this session.
   */
  const carregadasAMao = useRef(new Map<string, number>())
  messagesRef.current = messages

  // Provided by ToastProvider above the shell; stable, so it can be handed to
  // subscriptions registered once on mount.
  const pushToast = useToast()
  const confirmar = useConfirmar()
  /** The rooms this device cannot read now (1.3.25, P5). The room says so; the outbox waits for them. */
  const [canaisSurdos, setCanaisSurdos] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    /*
      The event says each change; the read says the state now. Without the read,
      a desktop window that reloads in the middle of a session showed no notice
      until the set changed again. An event that arrives first wins: it is newer.
    */
    let porEvento = false
    const largar = bridge.on.surdez?.((evento) => {
      porEvento = true
      setCanaisSurdos(new Set(evento.canais))
    })
    void bridge.social.canaisSurdos?.()
      .then((canais) => {
        if (!porEvento) setCanaisSurdos(new Set(canais))
      })
      .catch(() => {})
    return () => {
      porEvento = true
      largar?.()
    }
  }, [bridge])
  const outbox = useOutbox(bridge, connection, pushToast, canaisSurdos)
  // Notifications when the app is closed: renewed on each connect and settings change. See `usePushFechada`.
  const avisarDoPush = useCallback((erro: Error) => pushToast(traduzirErro(erro), "error"), [pushToast])
  usePushFechada(bridge, connection, avisarDoPush)

  /** The send sound plays inside the outbox, when the bridge confirms. See `useOutbox`. */
  const sendMessage = useCallback(
    (channel: string, body: string, room?: string, extras?: MessageExtras) => {
      outbox.send(channel, body, room, extras)
    },
    [outbox.send],
  )

  /** The channel drawer, on narrow screens only (the toggle is CSS-hidden when
   * the sidebar is a plain grid column, so this never opens when wide). */
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { draftFor, setDraft } = useDrafts()

  /**
   * The channel a redeemed invite link should open once a member admits us.
   * A ref, not state: the channels handler below is registered once, on mount,
   * and must always read the current value.
   */
  const pendingJoin = useRef<string | null>(null)
  /**
   * The same channel, in state, so the sidebar draws it.
   *
   * The ref stays, because the channel listener is registered once and has to read
   * the current value; the state exists so the "Waiting for entry" line appears and
   * disappears. Always written by both at the same time: `esperarEntrada`.
   */
  const [entradaAEspera, setEntradaAEspera] = useState<string | null>(null)
  /**
   * The name the invite badge gave to the waiting channel (1.0 "Arca"). With an
   * opaque address it is the only name there is until the channel arrives: the
   * prompt already showed it, and the "waiting" line and entry notice say the same
   * thing. Ref and state for the same reason as `pendingJoin` and `entradaAEspera`.
   */
  const nomeDaEntrada = useRef<string | null>(null)
  const [nomeDaEntradaAEspera, setNomeDaEntradaAEspera] = useState<string | null>(null)
  /**
   * The published name of a channel (`space.meta`), for the channel listener, which
   * is registered once and does not see the current `spaceMeta`. It is filled where
   * the `spaceMeta` is born, further down.
   */
  const nomePublicado = useRef<(canal: string) => string | undefined>(() => undefined)
  /** The channel that arrived by a followed link has a different name. See `arrivedMismatch`. */
  const [entradaComOutroNome, setEntradaComOutroNome] = useState(false)
  const esperarEntrada = useCallback((canal: string | null, nome: string | null = null) => {
    pendingJoin.current = canal
    nomeDaEntrada.current = canal ? nome : null
    setEntradaAEspera(canal)
    setNomeDaEntradaAEspera(canal ? nome : null)
    setEntradaComOutroNome(false)
  }, [])
  /**
   * The channels that existed when the link request went out, and whether the
   * spoofed-name warning has already been said by this request. See `onChannels`.
   * Its own snapshot, not `prevChannels`: that only exists after the first channels
   * event, and for someone who just created an account the first event is precisely
   * the one that brings the channel they were admitted to.
   */
  const canaisAoPedir = useRef<readonly string[] | null>(null)
  const avisouDoNomeErrado = useRef(false)

  /**
   * The page opened with an invite link that cannot be read. At the gate it is one
   * line; inside here it is said once and cleaned up, so it does not come back every
   * unlock.
   */
  useEffect(() => {
    if (stage !== "ready" || !conviteInvalido) return
    pushToast(strings.invite.gateInvalid, "error")
    onConviteResolvido()
  }, [stage, conviteInvalido, onConviteResolvido, pushToast])

  /**
   * What to do with the startup invite, decided WHEN THE WINDOW OPENS and not on
   * click: an invite from another server shows right away why it does not work, with
   * one button only, instead of offering an "Enter" that would end in an error.
   */
  const destinoDoArranque = useMemo(
    () => (conviteAEspera && stage === "ready" ? destinoDoConvite(conviteAEspera, address, channels) : null),
    [conviteAEspera, stage, address, channels],
  )

  /**
   * The short startup link (1.0 "Arca", slice 5b-2).
   *
   * It does not say the channel, so you cannot ask "Enter …?" before the server
   * replies. It resolves once, inside and linked (resolving is a server query, and
   * without a connection there is no one to ask). Resolved, it becomes the usual
   * startup invite, with the usual question: nothing enters without a yes. Failed
   * (code wrong, invite expired, rate limit), it says why and cleans up, like the
   * link that cannot be read.
   */
  const curtaPedida = useRef<string | null>(null)
  useEffect(() => {
    // Resolved or dropped: the same link clicked again in the app is a new request (1.3.25).
    if (!conviteCurtoAEspera) curtaPedida.current = null
    if (!conviteCurtoAEspera || stage !== "ready" || connection !== "online") return
    if (curtaPedida.current === conviteCurtoAEspera) return
    curtaPedida.current = conviteCurtoAEspera
    const lida = parseShortInviteLink(conviteCurtoAEspera)
    const resolver = bridge.invites.resolve
    if (!lida || !resolver) {
      pushToast(strings.invite.gateInvalid, "error")
      onConviteResolvido()
      return
    }
    // The short code only exists in the database of who gave it: our server has
    // nothing to say about it and does not need to know it.
    if (!sameHomeserver(lida.server, serverOf(address))) {
      pushToast(strings.invite.otherServer(servidorParaMostrar(lida.server), servidorParaMostrar(serverOf(address))), "error")
      onConviteResolvido()
      return
    }
    void resolver(conviteCurtoAEspera)
      .then((longa) => {
        const convite = parseInviteLink(longa)
        if (!convite) throw new Error("that is not a valid invite link")
        onCurtaResolvida?.(convite)
      })
      .catch((error: Error) => {
        pushToast(traduzirErro(error), "error")
        onConviteResolvido()
      })
  }, [conviteCurtoAEspera, stage, connection, address, bridge, onCurtaResolvida, onConviteResolvido, pushToast])

  /**
   * The channel name for the prompt, opened from the invite badge (1.0 "Arca",
   * slice 5c). Asked once per connection, inside and linked, and the prompt only
   * opens with the answer (or lack of it) in hand: opening with "a channel" and
   * swapping it for the name an instant later was changing the sentence under the
   * eyes of someone deciding. The core never throws it here, and answers in five
   * seconds at most.
   */
  const [nomeDoArranque, setNomeDoArranque] = useState<{ link: string; nome: NomeDoConvite | null } | null>(null)
  const nomePedido = useRef<string | null>(null)
  useEffect(() => {
    if (destinoDoArranque?.que !== "redimir" || connection !== "online") return
    const link = destinoDoArranque.link
    if (nomePedido.current === link) return
    nomePedido.current = link
    const pedir = bridge.invites.nome
    if (!pedir) {
      setNomeDoArranque({ link, nome: null })
      return
    }
    void pedir(link)
      .catch(() => null)
      .then((nome) => setNomeDoArranque({ link, nome }))
  }, [destinoDoArranque, connection, bridge])

  /**
   * Someone already in the channel has nothing to answer: there is no request to
   * send and no address to show to anyone. They go in, and the invite cleans up.
   */
  useEffect(() => {
    if (destinoDoArranque?.que !== "ja-la-estou" || connection !== "online") return
    setCanal(destinoDoArranque.canal)
    setView("chat")
    // An opaque address (1.0) is not a name: do not show it.
    pushToast(
      eMoradaOpaca(destinoDoArranque.canal)
        ? strings.invite.alreadyInOpaco
        : strings.invite.alreadyIn(canalParaMostrar(destinoDoArranque.canal)),
    )
    onConviteResolvido()
  }, [destinoDoArranque, connection, onConviteResolvido, pushToast])

  /** A community-mode transition by connection. The friendship seat itself is
   * in the core, and runs at each connection without passing through here. */
  const repaired = useRef(false)

  // Saved appearance applies before anything renders meaningfully, so even
  // the gate screens come up in the chosen accent and density.
  useEffect(() => applyPrefs(readPrefs()), [])

  // Audio may only start after a gesture, so the engine waits for the first
  // click or keypress and builds its context there — never on mount.
  useEffect(() => armSounds(), [])

  /*
    "Show when I am online" (Privacy), off: presence goes out as
    "Invisible", via the same `setVisible` as the identity card state, whatever
    state was chosen. Read from `usePrefs` to take effect as soon as it arrives
    from another device on the account (`lib/privacidadeDaConta.ts`).
  */
  const { prefs: prefsDaPresenca } = usePrefs()
  const visivel = activity !== "invisivel" && prefsDaPresenca.mostrarOnline

  // Invisibility is applied to the session before it is asked to connect, and
  // re-applied on every change; the session also replays it on reconnect.
  useEffect(() => {
    void bridge.session.setVisible(visivel).catch(() => {})
  }, [visivel, stage, connection])

  /** Chosen state, published to channel-mates and remembered locally. */
  const chooseActivity = useCallback(
    (next: Activity) => {
      setActivity(next)
      const prefs = readPrefs()
      writePrefs({ ...prefs, activity: next })
      // "invisivel" is never published — being invisible IS the absence of an
      // announcement, so there is nothing to tell anyone.
      const published: Profile = { ...profile }
      if (next === "ocupado" || next === "ausente") published.activity = next
      else delete published.activity
      setProfile(published)
      void bridge.profile.set(published).catch(() => {})
    },
    [profile],
  )

  /**
   * An audio choice: recorded, applied to the screen and sent to the core.
   *
   * Merges over what is ON DISK and never over the React snapshot, for the same
   * reason as `chooseActivity`: preferences are written from more than one place,
   * and recording an old snapshot would undo the choice someone just made on another
   * screen.
   */
  const escolherAudio = useCallback(
    (patch: { micMuted?: boolean; soundOff?: boolean }) => {
      const proximo = { ...readPrefs(), ...patch }
      writePrefs(proximo)
      setMicMuted(proximo.micMuted)
      setSoundOff(proximo.soundOff)
      /**
       * To the core goes the EFFECT, not the choice.
       *
       * Without sound you do not talk: answering a conversation you are not hearing
       * is the worse of two evils, and that is why muting the sound also silences
       * the microphone. The user's choice (`micMuted`) stays intact on disk, so
       * unmuting returns the microphone to the state they left it in.
       */
      bridge.call.setMuted(proximo.micMuted || proximo.soundOff)
    },
    [bridge],
  )

  /**
   * A gesture in muting: the choice, and the sound that confirms it (point 3).
   *
   * The sound is here, in both gestures (buttons, Settings and shortcuts), not in
   * `escolherAudio`: "Enter calls muted" also goes through there, and no one
   * pressed anything to hear a sound.
   */
  const silenciarComSom = useCallback(
    (patch: { micMuted?: boolean; soundOff?: boolean }) => {
      const antes = readPrefs()
      escolherAudio(patch)
      const som = somDoSilencio(antes, { ...antes, ...patch })
      if (som) motor.tocar({ tipo: som })
    },
    [escolherAudio],
  )

  const alternarMicrofone = useCallback(() => {
    // With sound off the microphone is muted as a side effect, and changing only
    // `micMuted` would give a button that you click, changes state inside and stays
    // red, looks broken. This returns both.
    if (readPrefs().soundOff) silenciarComSom({ micMuted: false, soundOff: false })
    else silenciarComSom({ micMuted: !readPrefs().micMuted })
  }, [silenciarComSom])

  const alternarSom = useCallback(() => {
    silenciarComSom({ soundOff: !readPrefs().soundOff })
  }, [silenciarComSom])

  /**
   * "Enter calls with microphone muted" (Microphone and camera).
   *
   * An entry is the call or room changing: entering a call, or switching voice
   * rooms. There are four doors to enter (the conversation menu, the room in the
   * sidebar, the direct button and the person button), and they all end here, in
   * `callChannel`. Being MOVED by a moderator does not count: the user was talking,
   * and silencing them without asking was the opposite of their choice.
   *
   * Silencing is the usual `escolherAudio`, not a separate mute: the identity card
   * button goes red, and one click returns the voice.
   */
  const entradaNaChamada = callChannel === null ? null : `${callChannel}/${callRoom}`
  const salaAnterior = useRef<string | null>(null)
  const movidoPara = useRef<string | null>(null)
  useEffect(() => {
    const antes = salaAnterior.current
    salaAnterior.current = entradaNaChamada
    if (entradaNaChamada === null || entradaNaChamada === antes) return
    if (movidoPara.current === entradaNaChamada) {
      movidoPara.current = null
      return
    }
    const guardadas = readPrefs()
    if (guardadas.entrarSilenciado && !guardadas.micMuted) escolherAudio({ micMuted: true })
  }, [entradaNaChamada, escolherAudio])

  /**
   * Choose the microphone that the next capture will open.
   *
   * Merges over disk and sends to the core by the same path as the other media
   * options, `applyMediaPrefs`, not by a new path, which is how two truths about
   * the same device are born. Takes effect for the NEXT capture: switching
   * microphones mid-call would mean redoing the track on all peer connections, and
   * that is something else, bigger, that no one asked for.
   */
  const escolherMicrofone = useCallback(
    (inputDeviceId: string) => {
      const proximo = { ...readPrefs(), inputDeviceId }
      writePrefs(proximo)
      bridge.applyMediaPrefs?.(prefsDeMediaParaONucleo(proximo))
    },
    [bridge],
  )

  /**
   * The latency, measured only while the mouse is over the status indicator.
   *
   * Lives up here and not inside the identity card because there are two cards
   * drawn in the app, the one in the channel column and the Friends one, and a
   * clock inside each one would put two ticking on the same socket. Same reason as
   * the bell.
   */
  const { latencia, comecar: comecarLatencia, parar: pararLatencia } = useLatencia(bridge)
  /*
    The phone has no hover, and the round trip time was measured only while the
    mouse was over the account card. On the phone it is measured while the list
    of "Tu" (where the card lives) is on screen.
  */
  const cartaoNoEcra = telemovel && separador === "tu" && !tuAberto
  useEffect(() => {
    if (!cartaoNoEcra) return
    comecarLatencia()
    return pararLatencia
  }, [cartaoNoEcra, comecarLatencia, pararLatencia])

  /**
   * "There is a new version", asked once after entering.
   *
   * Up here and not inside a screen because it is not a screen state: it is app
   * state, and does not change with the open destination. In the browser it does
   * not exist, `bridge.actualizacao` only comes from the Electron `preload`, and
   * its absence decides this, not an `if` written here.
   */
  const { aviso: avisoDeVersao, descarregar: descarregarVersao, dispensar: dispensarVersao } = useAvisoDeVersao(
    bridge,
    stage === "ready",
  )

  /**
   * The screen share of the installed app, mounted in the shell.
   *
   * Up here and not inside the call panel, for a reason that is always the same at
   * this layer: what the hook draws is a response to a request already on its feet
   * on the Chromium side, and a selector that died when changing conversations
   * would leave that request waiting for the two-minute timeout. The shell survives
   * navigation; the panel does not.
   *
   * In the browser this does nothing: `bridge.ecra` does not exist, `folhaDeEcra`
   * is always nothing, and `pedirPartilhaDeEcra` is the usual `startScreenShare`.
   */
  const { pedirPartilha: pedirPartilhaDeEcra, folha: folhaDeEcra } = usePartilhaDeEcra(bridge)

  /**
   * The device microphones, listed only with the menu open.
   *
   * `enumerateDevices()` on every startup was work for nothing: the list is only
   * read when someone opens it, and at that moment it is read fresh, which is also
   * what makes newly plugged-in headphones appear. See `useMicrofones`, and why the
   * names can come empty.
   */
  const { microfones, nomeados: microfonesNomeados } = useMicrofones(audioMenu?.qual === "mic")

  /**
   * Friendship reconciliation moved out of here.
   *
   * It was in this shell and read the timeline in memory to find who it owed a spot
   * in the feed. Two things condemned it. Memory is limited and the notice of an old
   * acceptance falls out of it, so the obligation disappeared without ever being
   * fulfilled. And what it read were the acceptances: a broken friendship still has
   * the acceptance in history that made it, so this passage would seat in my feed
   * someone I had just removed, minutes later and with nothing on screen saying so.
   *
   * Now it is `syncFriendships`, in the core, from the vault and the folded state
   *, where a broken connection does not appear in any list. It runs at each
   * connection, without anyone having to open Friends. What stays here is community
   * mode, which is not a requested friendship: it is the operator saying that
   * everyone on this server already knows each other.
   */
  useEffect(() => {
    if (connection !== "online") {
      // The next successful connect earns a fresh pass.
      repaired.current = false
      return
    }
    if (stage !== "ready" || !address || seededChannels.size === 0 || repaired.current) return
    void (async () => {
      try {
        // Community mode: everyone here is already a friend, so seat them
        // all. Idempotent — inert seats are renewed, working ones untouched.
        setCommunity(new Set(await bridge.social.syncCommunity()))
        // Marked done only once it actually finished. Set before the work, a
        // pass that threw halfway — an unstable reconnect is exactly when that
        // happens — was recorded as done and never retried.
        repaired.current = true
        recordDiagnostic({ kind: "action", code: "repair-pass", outcome: "ok" })
      } catch (error) {
        recordDiagnostic({ kind: "action", code: "repair-pass", outcome: "falhou", detail: (error as Error).message })
        // Deliberately leaves `repaired` false: the next pass tries again.
      }
    })()
  }, [stage, connection, address, seededChannels])

  // Who is seated in my own feed, refreshed whenever membership can have
  // changed. This is the half of the circle the channel list cannot see —
  // people who read me before I read them — and it exists so that nobody ends
  // up filed under "Outras pessoas" while the relationship plainly holds.
  useEffect(() => {
    if (stage !== "ready" || connection !== "online") return
    void bridge.social
      .feedChannel()
      .then((feed) => bridge.channels.members(feed))
      .then(setMyFeedMembers)
      .catch(() => {})
  }, [stage, connection, epochTick])

  /** Our own posts. Kept apart from the feed: only these are ours to show. */
  const myPosts = useMemo(() => feedOf(messages).filter((post) => post.sender === address), [messages, address])

  const patchSocialDraft = useCallback((patch: Partial<SocialDraft>) => {
    setSocialDraft((current) => ({ ...current, ...patch }))
  }, [])

  /**
   * The same event, told outside the app.
   *
   * Receives the entry that already entered the bell: that is how there is one rule
   * only about what deserves a notice, not one inside and another outside that drift
   * on the first change. The decider is `systemNoticeVerdictOf`, in
   * `lib/notifications.ts`, with the reason for each silence written alongside.
   *
   * The body obeys "Show content". Off, nothing the user sent to hide crosses: not
   * the writer's name, not the text. Not even the channel label, which in a direct
   * conversation IS the person's name, so what is said is the short identifier, as
   * it always was.
   */
  /** The last real label of each channel, for an alert that comes before the name is decrypted again. Memory only. */
  const rotulosConhecidos = useRef(new Map<string, string>())
  const avisarSistema = useCallback((entry: AppNotification): boolean => {
    // Never a notice for what this account wrote, from any device (16/11/2026).
    if (daPropriaConta(entry.actor, notifyRef.current.me)) return false
    const { pronto, labelFor: rotulo, abrir } = avisoRef.current
    const prefs = readPrefs()
    const verdict = systemNoticeVerdictOf(entry, {
      enabled: prefs.notifications,
      busy: prefs.activity === "ocupado",
      preview: prefs.notifyPreview,
      // The desktop host answers better than the document: a hidden Electron window
      // still says it is visible and has focus. In the browser there is no host and
      // the document is the only truth.
      windowInFront: hostWindowInFront() ?? windowIsFocused(),
      // With the window in front, only the open and being-read conversation silences (point 6).
      canalAberto: soundRef.current.active,
      // With the vault locked this shell does not even get drawn, and the session
      // is disconnected: "ready" is what that looks like from in here. The refusal
      // that counts is the one from the process that has the keys.
      unlocked: pronto,
      // Read from disk this instant, like the rest: muting on another device
      // arrives via `PREFS_EVENT` and has to take effect already for the next notice.
      silenciado: entry.channel !== undefined && estaSilenciado(prefs.silenciados, entry.channel),
      // "Pause" (Notifications): read from disk this instant, like the rest.
      pausado: estaEmPausa(prefs),
    })
    if (verdict === "silent") return false
    /*
      The room's name, or the last one known, or nothing (12/11/2026). Never the
      identifier: `labelFor` falls back to it while the name is not decrypted
      yet (a direct whose peer arrives after the channel list, a channel whose
      `space.meta` has not arrived), and outside the app `!abc…` reads as broken
      encryption. The discreet body had it on purpose; it now says only that
      there is a message.
    */
    const rotuloDoAviso = (canal: string): string | null => rotuloParaAviso(canal, rotulo(canal), rotulosConhecidos.current)
    const body =
      verdict === "detailed"
        ? notificationTextOf(entry, notifyRef.current.nameFor, rotuloDoAviso)
        : entry.channel
          ? strings.notifications.novaMensagem
          : strings.notifications.newNotice
    const caminho = showSystemNotice(
      {
        id: entry.id,
        title: strings.notifications.title,
        body,
        ...(entry.channel ? { channel: entry.channel } : {}),
        countable: verdict === "detailed",
      },
      () => abrir(entry),
    )
    return avisoTemSomProprio(caminho)
  }, [])

  /**
   * The sound of a bell entry. The single point: the sound follows the same entry
   * that makes the notice, and `avisoComSom` says whether the system notice already
   * played.
   */
  const tocarPelaEntrada = useCallback((entry: AppNotification, avisoComSom: boolean, sala?: string) => {
    const tipo = somDaNotificacao(entry.kind)
    if (!tipo) return
    if (caladaPeloSilencio(entry.kind, entry.channel !== undefined && estaSilenciado(readPrefs().silenciados, entry.channel))) return
    const { me } = notifyRef.current
    motor.tocar({ tipo, canal: entry.channel ?? null, deMim: daPropriaConta(entry.actor, me), avisoComSom, ...(sala !== undefined ? { sala } : {}) })
  }, [])

  /**
   * Does the friend request match the privacy rule? See `pedidoCabe`. A
   * reference, because session handlers hold the closure from the first
   * render; filled below, where the connections exist.
   */
  const pedidoCabeRef = useRef<(quem: string) => boolean>(() => true)
  const pushNotification = useCallback(
    // `sala`: where the mention was written, so the engine knows if it is visible.
    // `aoVivo`: false for what came from history (recovery, reports): it goes into the bell, silent.
    (entry: AppNotification, sala?: string, aoVivo = true) => {
      /*
        A request from someone who does not fit in "Who can send me friend
        requests" does nothing and does not alert. It goes into the bell already
        read and hidden (the filter is in `notificacoesVisiveis`). We store it
        anyway: changing the rule shows it, without the badge lighting up from
        an old request.
        */
      if (entry.kind === "friend-request" && entry.actor && !pedidoCabeRef.current(entry.actor)) {
        setNotifications((current) => appendNotification(current, { ...entry, read: true }))
        return
      }
      /*
        Once, and only for what happens now (12/11/2026). A mention read in a
        recovery rang and alerted as if new, on every login that replayed it, and
        the same message coming a second way rang again: "sounds and notices out
        of time". The bell keeps it either way.
      */
      if (aoVivo && !idsNoSino.current.has(entry.id)) {
        idsNoSino.current.add(entry.id)
        tocarPelaEntrada(entry, avisarSistema(entry), sala)
      }
      setNotifications((current) => appendNotification(current, entry))
    },
    [avisarSistema, tocarPelaEntrada],
  )

  /**
   * The other direction: the bell swings when the count goes up.
   *
   * The sound goes through `pushNotification`, above; the movement is
   * calculated from the badge, not from the event, because not every
   * notification goes through there, the private message enters the list by
   * its own path, to have one entry per conversation, not one per message. The
   * count covers them all.
   *
   * Two silences, and they are the same silence for two reasons: "Busy" is
   * the person saying they do not want to be interrupted, and a bell swinging
   * in a corner is an interruption even without sound; with the notification
   * center open, they are already looking at the list where it just landed.
   * In both cases the badge counts the same, the alert is muted, not the
   * information.
   */
  const lerAparelhosDaConta = useCallback(() => {
    void Promise.resolve()
      .then(() => bridge.pairing?.devices())
      .then((lista) => setAparelhosNaConta(lista ? new Set(lista.map((aparelho) => aparelho.deviceKey)) : undefined))
      .catch(() => {})
  }, [bridge])
  // Only when the bell opens and it holds a new-device entry: one manifest read, not one per render.
  const temAparelhoNovo = notifications.some((entry) => entry.kind === "device-new")
  useEffect(() => {
    if (notifAt !== null && temAparelhoNovo) lerAparelhosDaConta()
  }, [notifAt, temAparelhoNovo, lerAparelhosDaConta])
  /**
   * "Remover" on the new-device card and in the bell. It asks first, as in
   * Settings › Devices: a removed device erases its vault, and the button sits
   * next to "Fui eu". Resolves `true` when the person confirmed.
   */
  // One question at a time: the card sits above the dialog's backdrop and can be tapped again.
  const confirmingRemoval = useRef(false)
  const removerAparelhoNovo = useCallback(
    async (deviceKey: string): Promise<boolean> => {
      const revogar = bridge.pairing?.revoke
      if (!revogar || aparelhoARemover !== null || confirmingRemoval.current) return false
      confirmingRemoval.current = true
      let confirmed: boolean
      try {
        confirmed = await confirmar({
          titulo: strings.settings.revokeTitle,
          corpo: strings.settings.revokeBody,
          verbo: strings.settings.revoke,
          destructive: true,
        })
      } finally {
        confirmingRemoval.current = false
      }
      if (!confirmed) return false
      setAparelhoARemover(deviceKey)
      void revogar(deviceKey)
        .then(() => pushToast(strings.notifCenter.aparelhoRemovido))
        .catch((erro: Error) => pushToast(traduzirErro(erro), "error"))
        .finally(() => {
          setAparelhoARemover(null)
          lerAparelhosDaConta()
        })
      return true
    },
    [bridge, aparelhoARemover, confirmar, pushToast, lerAparelhosDaConta],
  )

  /**
   * "Novo aparelho na tua conta", as a card in the corner (21/11/2026): the
   * newest unread entry of a device this one did not add. "Fui eu" and "Remover"
   * both mark it read; the bell keeps the record.
   */
  const cartaoDeAparelho = useMemo(
    () =>
      notifications
        .filter((entry) => entry.kind === "device-new" && !entry.read && entry.aparelho)
        .reduce<AppNotification | null>((maisNova, entry) => (maisNova === null || entry.at > maisNova.at ? entry : maisNova), null),
    [notifications],
  )

  const sinoAvisa = useSinoAvisa(
    unreadCountOf(notifications),
    // Pausing also mutes the swinging bell: it is an interruption, even without sound.
    activity === "ocupado" || notifAt !== null || estaEmPausa(readPrefs()),
  )

  // Load once per unlock; persist on every change after that. The log lives
  // in the vault: local memory, no server inbox, no read receipts leaving.
  useEffect(() => {
    if (stage !== "ready" || notifLoaded.current) return
    void bridge.notifications
      .list()
      .then((entries) => {
        /*
          Merged, not overwritten.

          This used to be `setNotifications(entries)` flat, and what got lost
          between opening the vault and the response from this read was lost
          forever. The catch delivers late messages in the first few seconds,
          which is exactly this window: someone who opened the app with a
          pending friend request heard the sound and saw an empty bell. See
          `fundirNotificacoes`.
        */
        setNotifications((chegadas) => fundirNotificacoes(entries as AppNotification[], chegadas))
        notifLoaded.current = true
        setNotifFalhou(false)
      })
      .catch(() => {
        // Deliberately NOT marking it loaded. The guard below is what stops an
        // empty state from being written over the stored log: one failed read
        // used to open the gate, and the next notification saved a list of one
        // on top of fifty.
        recordDiagnostic({ kind: "action", code: "notifications-load", outcome: "falhou" })
        /*
          And tell about it, the half that was missing.

          This stayed only in the log, and the bell opened saying "Nothing
          here. Good sign." over a read that had failed. The app KNOWS it
          failed, the line above writes it, and `notifLoaded` stays unmarked
          precisely to avoid saving the void over what is in the vault, and
          yet it claimed the opposite to whoever looked.

          Empty and unreadable are two different things, and the second dressed
          as the first is the worse of the two: it sends the person away
          convinced they have nothing to see.
        */
        setNotifFalhou(true)
      })
  }, [stage])

  useEffect(() => {
    if (!notifLoaded.current) return
    void bridge.notifications.save(notifications).catch(() => {})
  }, [notifications])

  /**
   * Open a conversation, whatever its type, and go to where it lives.
   *
   * The destination comes from the channel ID and nothing else: a two-person
   * conversation opens in Friends, a channel opens in Conversations. In one
   * place only, because this is called from five places, a system notification,
   * the bell, the channel menu, the call return, and the conversation list,    * and any one of them deciding alone would make the panel open at the wrong
   * destination.
   */
  const abrirConversa = useCallback(
    (channel: string) => {
      if (isDirect(channel)) {
        setDirecta(channel)
        setView("pessoas")
        // A direct conversation lives in Messages on the phone: back goes to that list.
        setSeparadorEscolhido("mensagens")
        return
      }
      setCanal(channel)
      setView("chat")
    },
    [setView],
  )

  /** Open the thing a notification points at, and mark it read. */
  const openNotification = useCallback(
    (entry: AppNotification) => {
      setNotifications((current) => markRead(current, entry.id))
      setNotifAt(null)
      if (entry.kind === "friend-request") {
        // For requests, not where Friends was. With a conversation open the body was
        // its own and the request was not visible; close it, the way picking a tab by
        // hand does.
        setView("pessoas")
        setPeopleTab("recebidos")
        setDirecta(null)
        return
      }
      if (entry.kind === "friend-accept") {
        // "Accepted" opens the profile of who accepted: that is where the friendship
        // shows, with their posts. No actor, the feed is the best there is.
        if (entry.actor) abrirPessoa({ address: entry.actor, channel: null })
        else setView("social")
        return
      }
      if (entry.channel) abrirConversa(entry.channel)
    },
    [abrirConversa, abrirPessoa, setView],
  )

  /**
   * Leave the call, and leave it even if leaving fails.
   *
   * A rejected `leave()` used to be swallowed whole: `onCallEnded` never
   * fired, so the dock stayed on screen with a hang-up button that did
   * nothing. Being stuck in a call that is already over is worse than a
   * local state that got ahead of the machinery.
   */
  const leaveCall = useCallback(() => {
    void bridge.call.leave().catch((error: Error) => {
      recordDiagnostic({ kind: "action", code: "call-leave", outcome: "falhou", detail: error.message })
      setCallChannel(null)
      setCallRoom("")
      setParticipants([])
      setCallPopup(false)
      pushToast(traduzirErro(error), "error")
    })
  }, [pushToast])

  /**
   * Leave a channel call that stopped being ours (2/11/2026).
   *
   * Whoever is kicked loses the channel from the list, but their call kept
   * going: they stayed speaking in a room of a channel they no longer saw, as
   * if nothing happened. We only look at the TRANSITION (the channel was in the
   * list and left), not a list still to come to remove anyone from a call.
   */
  const canaisAntes = useRef<string[]>([])
  useEffect(() => {
    const antes = canaisAntes.current
    canaisAntes.current = channels
    if (callChannel !== null && antes.includes(callChannel) && !channels.includes(callChannel)) leaveCall()
  }, [channels, callChannel, leaveCall])

  /**
   * The voice commands that a keyboard shortcut can give (see `useAtalhos` and
   * `lib/atalhosDeVoz`). Outside a call they do nothing: a shortcut that left
   * a call that does not exist was a shock with no explanation.
   */
  const alternarCamara = useCallback(() => {
    if (callChannel === null) return
    setCameraOff((actual) => {
      bridge.call.setCameraOff(!actual)
      return !actual
    })
  }, [bridge, callChannel])

  const alternarEcra = useCallback(() => {
    if (callChannel === null) return
    if (screenStream) void bridge.call.stopScreenShare().catch(() => {})
    else pedirPartilhaDeEcra()
  }, [bridge, callChannel, screenStream, pedirPartilhaDeEcra])

  const sairDaChamada = useCallback(() => {
    if (callChannel !== null) leaveCall()
  }, [callChannel, leaveCall])

  /**
   * The AFK room (2/11/2026): anyone muted in a voice room for the channel's
   * duration moves themselves to the AFK room. The rule is in `lib/relogioAfk.ts`.
   *
   * We change the CALL, not the view: someone who is silent might be reading
   * another room, and pulling them away was worse than the silence. Being moved
   * like this does not count as entering (the "enter muted" rule does not apply),
   * like `voice.move`.
   */
  const [avisoAfk, setAvisoAfk] = useState<MudancaAfk | null>(null)
  // Read when the timer fires, which runs outside render.
  const activeRoomsRef = useRef(activeRooms)
  activeRoomsRef.current = activeRooms
  const activeRef = useRef(active)
  activeRef.current = active
  const { actividade: actividadeAfk, salaAfk: salaAfkDaChamada } = useSalaAfk({
    bridge,
    callChannel,
    callRoom,
    privada: callChannel !== null && isDirect(callChannel),
    silenciado: micMuted || soundOff,
    aPartilharEcra: screenStream !== null,
    aEmitirMusica: minhaMusica,
    aoMover: (mudanca) => {
      movidoPara.current = `${mudanca.canal}/${mudanca.para}`
      setCallRoom(mudanca.para)
      setAvisoAfk(mudanca)
      motor.tocar({ tipo: "sala-afk" })
      /*
        The view follows the call only if it was already in it: the call panel
        was visible, and that is where the alert with "Return" shows. Anyone
        reading another room stays where they are, and reads the alert in a toast.
      */
      const vista = activeRoomsRef.current[mudanca.canal] ?? ""
      if (activeRef.current === mudanca.canal && vista === mudanca.de) {
        setActiveRooms((actual) => ({ ...actual, [mudanca.canal]: mudanca.para }))
      } else {
        pushToast(strings.salaAfk.movido(mudanca.minutos))
      }
      void bridge.call.join(mudanca.canal, { room: mudanca.para }).catch((error: Error) => {
        setAvisoAfk(null)
        pushToast(traduzirErro(error), "error")
      })
    },
  })
  const chamadaNaSalaAfk = callChannel !== null && salaAfkDaChamada !== null && callRoom === salaAfkDaChamada.room
  // For handlers registered once (see `useSessionEvents`).
  const naSalaAfkRef = useRef(false)
  naSalaAfkRef.current = chamadaNaSalaAfk
  // The alert is from this transition: leaving the AFK room (to anywhere) clears it.
  useEffect(() => {
    if (avisoAfk && (callChannel !== avisoAfk.canal || callRoom !== avisoAfk.para)) setAvisoAfk(null)
  }, [avisoAfk, callChannel, callRoom])
  const voltarDaSalaAfk = useCallback(() => {
    if (!avisoAfk) return
    const { canal, de, para } = avisoAfk
    setAvisoAfk(null)
    setCallRoom(de)
    // Anyone viewing the AFK room sees their room of origin again.
    setActiveRooms((actual) => ((actual[canal] ?? "") === para ? { ...actual, [canal]: de } : actual))
    void bridge.call.join(canal, { room: de }).catch((error: Error) => pushToast(traduzirErro(error), "error"))
  }, [avisoAfk, bridge, pushToast])
  const nomeDaSalaDe = (canal: string, sala: string): string =>
    bridge.channels.rooms?.(canal)?.find((cada) => cada.room === sala)?.name ?? strings.salaAfk.voltar
  const avisoAfkDoPainel = avisoAfk
    ? {
        texto: strings.salaAfk.movido(avisoAfk.minutos),
        voltar: strings.salaAfk.voltarPara(nomeDaSalaDe(avisoAfk.canal, avisoAfk.de)),
        onVoltar: voltarDaSalaAfk,
        onFechar: () => setAvisoAfk(null),
      }
    : null

  /**
   * Push to talk: while the key is down the microphone opens; releasing it
   * returns to what the preferences say. Does not touch preferences or the
   * screen toggle: it is a gesture, not a choice.
   */
  const falar = useCallback(
    (aCarregar: boolean) => {
      if (callChannel === null) return
      // Push to talk means you are here: the AFK timer restarts.
      if (aCarregar) actividadeAfk()
      const guardadas = readPrefs()
      bridge.call.setMuted(aCarregar ? false : guardadas.micMuted || guardadas.soundOff)
    },
    [bridge, callChannel, actividadeAfk],
  )

  /** "New post", from anywhere: the composer lives in the Social tab. */
  const compose = useCallback(() => {
    setView("social")
    setComposeSignal((signal) => signal + 1)
  }, [])

  /**
   * Open someone's profile, no matter where the click came from.
   *
   * Your own profile does not open a person page: it goes to the profile
   * screen, the only place where you edit it. It is also what makes another
   * person's profile not need to know what editing is, your own never reaches
   * their hands.
   */
  const openProfile = useCallback(
    (who: string, channel: string | null) => {
      if (who === address) {
        setView("perfil")
        return
      }
      abrirPessoa({ address: who, channel })
    },
    [address, abrirPessoa, setView],
  )

  /**
   * The friend link that the page opened with, after the gate: opens the
   * profile page of that address, with "Send friend request". A profile that
   * never arrived shows the address and says there is nothing. An unreadable
   * link gives a warning. In both cases it gets cleaned up right away, so it
   * does not come back with every unlock.
   */
  useEffect(() => {
    if (stage !== "ready" || !address) return
    if (amigoInvalido) {
      pushToast(strings.people.friendLinkInvalid, "error")
      onAmigoResolvido?.()
      return
    }
    if (!amigoAEspera) return
    /*
      An account from another server cannot be requested today: the sheet
      offered a button that failed. We say why, and clean it up.
    */
    if (serverOf(amigoAEspera) !== serverOf(address)) {
      pushToast(strings.people.friendLinkOtherServer, "error")
      onAmigoResolvido?.()
      return
    }
    openProfile(amigoAEspera, null)
    onAmigoResolvido?.()
  }, [stage, address, amigoAEspera, amigoInvalido, openProfile, onAmigoResolvido, pushToast])

  /**
   * The security number, the Signal way. It was what opened when you clicked
   * someone in the list; now it is in the "⋯" on their page, where you look
   * for it. The sheet opens ON TOP of the page, and closing it returns to the
   * page: the page is not a dialog, and Escape is only the sheet's while it is
   * open.
   */
  const openVerify = useCallback((channel: string, member: string) => {
    void bridge.channels
      .safetyNumber(channel, member)
      .then((number) => setVerifying({ address: member, number }))
      .catch(() => setVerifying({ address: member, number: null }))
  }, [])

  /**
   * Respond to a channel invite from the conversation where it arrived.
   *
   * One path only, like friend requests and for the same reason: if the
   * conversation button had its own path, the two would diverge at the first
   * change, and what diverges here is not cosmetic, it is who enters which
   * channel.
   *
   * Validated and not optimistic: the invite only leaves the screen after the
   * response is really sent, and it leaves because the fold stops counting it.
   * An invite that vanishes when you press it and fails later evaporates with
   * no error anywhere, whoever invited waits forever, and whoever accepted
   * thinks they accepted.
   *
   * What the message says next is the honest part: accepting is not entering.
   * Nobody enters an encrypted group alone, and whoever admits is the device of
   * the person who invited. When that person is here right now it is immediate
   * and we say so; when they are not, we say what is missing instead of
   * pretending it is done.
   */
  const answerInvite = useCallback(
    (dmChannel: string, target: string, who: string, aceitar: boolean) => {
      if (respondendo) return
      setRespondendo(who)
      const acto = aceitar
        ? bridge.channels.acceptChannelInvite(dmChannel, target)
        : bridge.channels.declineChannelInvite(dmChannel, target)
      void acto
        .then(() => {
          if (!aceitar) return pushToast(strings.convite.recusado)
          const nome = notifyRef.current.nameFor(who)
          pushToast(online.has(who) ? strings.convite.aceiteDado : strings.convite.aceiteFalta(nome))
        })
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
        .finally(() => setRespondendo(null))
    },
    [pushToast, respondendo, online],
  )

  // Membership changes on every commit, which is exactly what an epoch event
  // signals — so the list refreshes on those rather than on a timer.
  const refreshMembers = useCallback(() => {
    if (!active) {
      setMembers([])
      return
    }
    // The channel this answer belongs to, captured now. Switching rooms while
    // a slow reply is in flight used to paint the previous room's roster into
    // the new room and mark it "ready" — a confident wrong answer to the one
    // question this app exists to answer honestly: who can read this.
    const requested = active
    void bridge.channels
      .members(active)
      .then((list) => {
        if (requestedChannel.current !== requested) return
        setMembers(list)
        setMembersState("ready")
      })
      .catch(() => {
        if (requestedChannel.current !== requested) return
        setMembersState("error")
      })
  }, [active])

  /** The channel the member panel is currently asking about. */
  const requestedChannel = useRef<string | null>(null)

  // Switching channels resets the panel: the old roster must never pose as the
  // new one, and an empty list must not pretend to be a loaded one.
  useEffect(() => {
    requestedChannel.current = active
    setMembers([])
    setMembersState("loading")
  }, [active])

  // Membership changes exactly when a commit lands — the epoch event — not on
  // every message. The callback identity also changes on channel switch, so
  // both triggers are covered here.
  useEffect(refreshMembers, [refreshMembers, epochTick])

  const retryMembers = useCallback(() => {
    setMembersState("loading")
    refreshMembers()
  }, [refreshMembers])

  /**
   * What the notification path needs at event time, mirrored into a ref: the
   * session handlers are registered once, on mount, so they must never read
   * these through a stale closure.
   */
  /*
    The resource is `nomeEmFalta` (the first word of the address, since 4
    November 2026), never the raw address.

    It used to be `(sender) => sender`, and that put the entire address inside
    an operating system alert, a notification saying
    "@garbicis-xapsensis-giprete-birmyris:orwell.pt sent a message". Only read
    in this window: the `notifyRef` is written with `nameFor` for real in the
    same render, but session handlers are registered on `mount` and can fire
    before that write. It is short and it happens, and that is why the resource
    also has to be readable. `nomes.test.ts` pins it down.
  */
  const notifyRef = useRef<{ me: string | null; nameFor: (sender: string) => string }>({
    me: null,
    nameFor: nomeEmFalta,
  })
  /** Who is blocked on this device, for the session handlers. Written where the set is made. */
  const bloqueadosRef = useRef<ReadonlySet<string>>(new Set())

  /**
   * The same mirror, for the operating system alert.
   *
   * In a ref, not a dependency, because the two things it needs are born after
   * whoever uses them: `avisarSistema` is called from `pushNotification`, which
   * is declared well above the label of a channel and the route of a click. Read
   * at the instant the event happens, like everything else in this flow.
   */
  const avisoRef = useRef<{
    pronto: boolean
    labelFor: (channel: string) => string
    abrir: (entry: AppNotification) => void
  }>({ pronto: false, labelFor: (channel) => channel, abrir: () => {} })

  /** The same trick for the sound rules: which channel is on screen, and which
   * call this device is already in. Read at event time, never closed over. */
  const soundRef = useRef<{
    active: string | null
    /** The room open inside `active`. */
    room: string
    callChannel: string | null
    /** The voice room we are in, inside `callChannel`. */
    callRoom: string
    ringing: ReadonlyMap<string, Map<string, number>>
    /** The peers in this call: the truth about who is in the room we are in. */
    participants: readonly Participant[]
    /** Our microphone has already opened. See the empty room alarm, below. */
    mediaPronta: boolean
  }>({ active: null, room: "", callChannel: null, callRoom: "", ringing: new Map(), participants: [], mediaPronta: false })

  /**
   * Who enters and who leaves the voice room we are in, so we can give them
   * sound.
   *
   * In a ref, not state: this is read and written inside the `onCallActivity`
   * handler, which is registered once at mount, and none of this has an image
   * on screen, the screen already shows who is there. The entire rule,
   * including the reason for each silence, lives in `lib/sounds.ts`.
   */
  const vozOuvida = useRef(createVoiceRoomWatcher())

  /**
   * The gate for the call ring: closed while the connection settles.
   *
   * When the app opens, calls already running arrive as entries, and rang as if
   * they were starting. See `createCallRingGate`.
   */
  const portaoDoToque = useRef(createCallRingGate())
  /**
   * The MSN-style alerts (point 6): who arrived, and when they last got an
   * alert. Opening the connection is the same as the ring: the `portaoDoToque`
   * says when presences that arrive are no longer a snapshot of who was there.
   */
  const vigiaDosAmigos = useRef(criarVigiaDosAmigos())
  /**
   * The other friend alerts: who enters a
   * voice room or starts sharing the screen (`vigiaDaVoz`), and who enters one
   * of our communities (`vigiaDasComunidades`). See `lib/avisosDeAmigos.ts`.
   */
  const vigiaDaVoz = useRef(criarVigiaDaVoz())
  const vigiaDasComunidades = useRef(criarVigiaDasComunidades())
  /** The private calls ringing, so the bell knows about missed ones. */
  const vigiaDasChamadas = useRef(criarVigiaDasChamadas())
  /**
   * The notice of the call ringing on this device (21/11/2026): who calls, with
   * "Decline". Kept to take it away when the ring stops for any other reason.
   */
  const avisoDoToque = useRef<{ canal: string; texto: string } | null>(null)
  /** Takes away an alert whose text is no longer true. Stable. */
  const dispensarToast = useDispensarToast()
  /** Filled where the bell already exists (`pushNotification`). */
  const registarChamadaPerdidaRef = useRef<(perdida: ChamadaPerdida) => void>(() => {})
  /** The communities whose member snapshot was already requested. */
  const comunidadesLidas = useRef(new Set<string>())
  /**
   * Read the members of a community and say who entered since last time.
   *
   * `fotografia`: it is the first read (the channel list arrived), and we just
   * store it. Only reads refs and the bridge, because it is called by session
   * events, registered once at mount.
   */
  const lerMembrosDaComunidade = (channel: string, fotografia: boolean): void => {
    if (isDirect(channel) || isFeed(channel)) return
    comunidadesLidas.current.add(channel)
    const aAssentar = fotografia || portaoDoToque.current.aAssentar(Date.now())
    void bridge.channels
      .members(channel)
      .then((lista) => {
        for (const quem of vigiaDasComunidades.current.membros(channel, lista, aAssentar)) {
          if (quem !== notifyRef.current.me) avisarAmigoRef.current(quem, "comunidade", { canal: channel })
        }
      })
      .catch(() => {})
  }

  /**
   * A private chat rang and no one picked up: it goes into the bell, in the
   * "Calls" filter. It doesn't ring again (`somDaNotificacao`): the ring was already heard.
   */
  registarChamadaPerdidaRef.current = (perdida: ChamadaPerdida): void => {
    pushNotification({
      id: `perdida:${perdida.canal}:${perdida.em}`,
      kind: "missed-call",
      at: Date.now(),
      actor: perdida.quem,
      channel: perdida.canal,
      read: false,
    })
  }
  /** Filled in below, once friends, names, and faces exist. */
  const avisarAmigoRef = useRef<(quem: string, tipo: TipoDeAvisoDeAmigo, onde?: SitioDoAviso) => void>(() => {})

  /**
   * And next to it, confirmation that the call actually stayed up.
   *
   * A different watcher, not the same one on purpose: one reads announcements
   * of people, the other reads the state of connections, and those are two
   * different questions, see `lib/sounds.ts`, where the whole rule lives
   * and why the two coexist.
   */
  const ligacaoOuvida = useRef(createCallConnectedWatcher())

  /*
    The moments of the call matching Discord's behavior (3/11/2026): the
    connection that drops, the broadcast (mine and others', and who sees mine).
    Rules are in `sons/chamada.ts`; here we just feed the watchers.
  */
  const vigiaDaQueda = useRef(criarVigiaDaQueda())
  const vigiaDasTransmissoes = useRef(criarVigiaDasTransmissoes())
  /**
   * The room a moderator moved us to, up to the entry effect being read.
   * Being moved already triggers `movido`: entering the new room doesn't ring again.
   */
  const entradaMovida = useRef<string | null>(null)

  /**
   * The room we are in, told to the watchers.
   *
   * Entering, leaving, and being moved by someone in charge all go through here,
   * and that is what must happen: each room has its list and its clock, and
   * the one we came from says nothing about this one.
   */
  useEffect(() => {
    const sala = callChannel === null ? null : chaveDaSala(callChannel, callRoom)
    const agora = Date.now()
    const movido = sala !== null && entradaMovida.current === sala
    entradaMovida.current = null
    vozOuvida.current.enter(sala, agora, { movido })
    ligacaoOuvida.current.enter(sala, agora, { movido })
    vigiaDasTransmissoes.current.enter(sala, agora)
    if (callChannel === null || sala === null) return
    /*
      The call going out: I entered a private chat where no one is yet, so I
      made the call. The ring stops at the ring effect below, or at the engine
      after 30 s. See `comecaAChamar`.
    */
    if (
      comecaAChamar({
        canal: callChannel,
        eu: notifyRef.current.me ?? "",
        naChamada: soundRef.current.ringing.get(callChannel)?.keys() ?? [],
        pares: soundRef.current.participants,
        movido,
      })
    ) {
      motor.chamar(callChannel)
    }
    /**
     * The empty room alarm.
     *
     * Entering alone produces no event: there is no peer to show up or call,
     * so the effect below never runs again and confirmation stays waiting for
     * a change that never comes. This checks at the deadline.
     * Reads the call from `soundRef`, which is rewritten each render, not from
     * the closure, three seconds from now what this closure saw is no longer true.
     *
     * The slack is for the clock: a timer might wake a thread a second before
     * the hour, and without it the comparison with `SALA_VAZIA_MS` would fail
     * by milliseconds and the sound would not play at all.
     */
    const despertador = setTimeout(() => {
      const toque = ligacaoOuvida.current.observe(
        {
          room: sala,
          peers: soundRef.current.participants,
          temSala: !isDirect(callChannel),
          mediaPronta: soundRef.current.mediaPronta,
          deafened: readPrefs().soundOff,
        },
        Date.now(),
      )
      if (toque) playSound(toque)
    }, SALA_VAZIA_MS + 50)
    return () => clearTimeout(despertador)
  }, [callChannel, callRoom])

  /**
   * And the normal path: a peer changed state, or the microphone opened.
   *
   * Separate from the effect above because `enter` must run once per room and
   * this must run always, merging them would re-arm the latch each time a peer
   * showed up, and then a room of eight would ring seven times, which is
   * exactly the bug the watcher exists to prevent. The order between the two
   * matters and is the order of declaration: we enter the room before observing
   * what is in it.
   */
  useEffect(() => {
    if (callChannel === null) return
    const toque = ligacaoOuvida.current.observe(
      {
        room: chaveDaSala(callChannel, callRoom),
        peers: participants,
        temSala: !isDirect(callChannel),
        mediaPronta: localStream !== null,
        // Read from disk, not from the React snapshot, as in `onCallActivity`.
        deafened: readPrefs().soundOff,
      },
      Date.now(),
    )
    if (toque) playSound(toque)
  }, [participants, localStream, callChannel, callRoom])

  /**
   * The broadcast: mine starting and ending, others' in the room where I am,
   * and who starts or stops seeing mine. See `criarVigiaDasTransmissoes`.
   *
   * The end of MY broadcast waits `FIM_DA_TRANSMISSAO_MS` and only rings if
   * the call continues: leaving the call to share also ends the share, and
   * that exit already has its own sound.
   */
  useEffect(() => {
    if (callChannel === null) return
    const sons = vigiaDasTransmissoes.current.observar(
      {
        eu: address ?? "",
        euPartilho: screenStream !== null,
        pares: participants,
        ensurdecido: readPrefs().soundOff,
        naSalaAfk: chamadaNaSalaAfk,
      },
      Date.now(),
    )
    for (const som of sons) {
      if (!som.minha) {
        motor.tocar({ tipo: som.tipo })
        continue
      }
      const canal = callChannel
      setTimeout(() => {
        if (soundRef.current.callChannel === canal) motor.tocar({ tipo: som.tipo })
      }, FIM_DA_TRANSMISSAO_MS)
    }
  }, [participants, screenStream, callChannel, callRoom, address, chamadaNaSalaAfk])

  /**
   * Who this device believes is in the room where we are.
   *
   * Two sources, not one, and why they are two is in `quemEstaNaSala`: call
   * peers always arrive late compared to the announcement, and reading only
   * from them would make the exit ring over the entry of someone who just
   * arrived. Room announcements cover that gap.
   */
  const naSalaDaChamada = useMemo(
    () =>
      callChannel === null
        ? []
        : quemEstaNaSala(participants, vozPorSala.get(chaveDaSala(callChannel, callRoom)), address, Date.now()),
    [participants, vozPorSala, callChannel, callRoom, address],
  )

  /**
   * And who disappeared without saying goodbye, which is the most common exit of all.
   *
   * Closing the app, losing the network, or closing the laptop does not send
   * `voice.leave`: on our side the card stays until ICE gives up and then
   * vanishes, with no single event the `hear` can answer to. The room would
   * empty in silence.
   *
   * Here the list is the source: who was there and is no longer is gone,
   * whether they said goodbye or not. An announced exit already rang in `hear`
   * and already left the watcher's count, so it does not ring twice.
   *
   * **Its own effect, not a line above.** The cadence is different: that one
   * runs when media changes, this one must also run when an announcement changes,    * and hanging the latch on announcements would make it ask "is it up yet?" at
   * each heartbeat that arrives from another room.
   */
  useEffect(() => {
    const partiu = vozOuvida.current.vePresentes(naSalaDaChamada, readPrefs().soundOff)
    if (partiu) playSound(partiu)
  }, [naSalaDaChamada])

  /**
   * Toast noise control, in refs because the session handlers below are
   * registered once on mount and must never read this through a stale closure.
   */
  const router = useRef<{ connectedAt: number; lastToastAt: Map<string, number> }>({
    connectedAt: 0,
    lastToastAt: new Map(),
  })

  /**
   * One session status, routed.
   *
   * Everything is written to the diagnostic log; only what the policy calls an
   * interruption becomes a toast, and what concerns a person goes to the bell.
   * See `lib/statusPolicy.ts` for the rule and why it exists.
   */
  const handleStatus = useCallback((status: SessionStatus) => {
    /*
      Someone asked us for friendship and canceled the request: the entry leaves
      the bell. There is no notification for this, just as there is none for a refusal.
    */
    if (status.code === "friend-withdrawn" && status.actor) {
      const quem = status.actor
      setNotifications((current) => retirarPedidoDe(current, quem))
    }
    /*
      This device was removed from the account on another device. The session
      is already logged out and logging back in gives the same refusal. The
      toast says it (with code 748), and the person goes to the gate, which
      repeats the message. The vault locks: what is in there stays (revoke does
      not erase), but there is no account to use.
      */
    /*
      A report came in for a channel I created: it goes into the bell, with the
      channel only. The session says nothing more, and the bell does not either
      (neither who nor what).
      */
    if (status.code === "denuncia-recebida" && status.channel) {
      const agora = Date.now()
      pushNotification({
        id: `denuncia:${status.channel}:${agora}`,
        kind: "report-copy",
        at: agora,
        channel: status.channel,
        read: false,
      })
    }
    /*
      A decision came on a report I made (article 16, section 5 of DSA): it goes
      into the bell with the remedies. The decision only, without the channel:
      the notice cannot say the number or the facts.
    */
    if (status.code === "denuncia-decidida" && status.decisao) {
      const agora = Date.now()
      // Two decisions in one read arrive in the same millisecond: the id cannot
      // be just the time, or the bell would keep one and throw the other away.
      pushNotification({
        id: `decisao:${agora}:${crypto.randomUUID()}`,
        kind: "report-decision",
        at: agora,
        decisao: status.decisao,
        read: false,
      })
    }
    /*
      A device this one did not add joined the account (1.3.26): maybe with the
      account file. The bell keeps it, with the date it joined and "Remove". One
      entry per device key. See `Session.#notarAparelhosDaConta`.
    */
    if (status.code === "device-new") {
      const [chave, quando] = status.detail.split("|")
      if (chave) {
        const segundos = Number(quando)
        pushNotification({
          id: `aparelho:${chave}`,
          kind: "device-new",
          at: Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : Date.now(),
          aparelho: chave,
          read: false,
        })
      }
    }
    if (status.code === "account-suspended") {
      contaSuspensaRef.current = true
      setAvisoDeSuspensao(status.aviso ?? null)
      setStage("suspensa")
    }
    if (status.code === "device-revoked") {
      aparelhoRevogadoRef.current = true
      setAparelhoRevogado(true)
      setEmparelhamentoPorAcabar(status.emparelhamentoPorAcabar === true)
      /*
        Removed in Settings › Devices on another device, with the proof the core
        checked (`removido`, 12/11/2026): the account becomes
        unreachable here. Lock, then erase this device's vault (the messages and the
        media live in it). With the vault locked `destroy` has no channel to leave,
        so it runs offline. Then the same as "start over" at the gate: another
        account on this device opens on reload; with none, sign up, with the phrase.
        Without the proof (a copy replaced by an import, an older server) only the
        lock, as before.
      */
      if (status.removido) {
        // From here the vault is going away: the shell must not ask the session for anything,
        // and a late `enter` from the gate must not bring the unlock back. See `enter`.
        aparelhoRemovidoRef.current = true
        setStage("loading")
      }
      void bridge.vault
        .lock()
        .catch(() => {})
        .then(async () => {
          /*
            "Este aparelho saiu da conta." (21/11/2026): its own screen, with the
            file and another device. Without the proof the vault stays, locked,
            and the two ways add an empty account next to it.
          */
          if (!status.removido) return "removido" as const
          await bridge.vault.destroy()
          const restantes = bridge.contas ? (await bridge.contas.listar().catch(() => null))?.contas : null
          if (restantes?.some((conta) => conta.temCofre)) {
            pagina.recarregar()
            return "loading" as const
          }
          return "removido" as const
        })
        .catch(() => "removido" as const)
        .then((proximo) => setStage(proximo))
    }
    const decision = routeStatus(status, {
      now: Date.now(),
      connectedAt: router.current.connectedAt,
      lastToastAt: router.current.lastToastAt,
    })
    recordDiagnostic({
      kind: "status",
      ...(status.code ? { code: status.code } : {}),
      ...(status.channel ? { channel: status.channel } : {}),
      detail: status.detail,
      outcome: decision.target === "log" ? decision.reason : decision.target,
    })
    // "Este aparelho saiu da conta." is the screen itself (21/11/2026): no toast with the same sentence over it.
    if (decision.target === "toast" && status.code === "device-revoked" && status.emparelhamentoPorAcabar !== true) return
    if (decision.target === "toast") {
      router.current.lastToastAt.set(decision.key, Date.now())
      // Codes with text in the catalog speak in the reader's language. See
      // `fraseDoStatus`. The channel name is read NOW, by ref: the next render
      // might already have the channel out of the list, and the name with it.
      const frase = fraseDoStatus(status, avisoRef.current.labelFor)
      pushToast(
        frase ?? (decision.level === "error" ? translateError(decision.detail) : decision.detail),
        decision.level,
      )
      return
    }
    if (decision.target === "notice" && decision.actor) {
      pushNotification({
        id: `join:${decision.channel ?? ""}:${decision.actor}`,
        kind: "channel-join",
        at: Date.now(),
        actor: decision.actor,
        ...(decision.channel ? { channel: decision.channel } : {}),
        read: false,
      })
    }
  }, [pushToast, pushNotification])

  /**
   * The `maybeNotify` came from here, and why it came out matters.
   *
   * It was a SECOND rule about what deserves a notice, beside the one that
   * fills the bell: it would notify for any message from any channel, and would
   * not notify for a friend request, an invite, or a mention, precisely the
   * things the app records because they are directed at us. Two lists of what
   * is worth saying, diverging from day one.
   *
   * Now there is only one: the system notice comes from the same entry that
   * makes the bell swing, by `avisarSistema`. The visible consequence is that
   * a random message in a channel of thirty people stopped lighting up
   * everyone's screen, that is what mentions are for, which now notify and
   * did not before.
   */

  /*
    Re-read the channel list when the connection comes back. By ref because
    the function is born below, and the session handlers are read at the moment
    of the event. See `semeados`: a first connection that dropped left the list
    empty until someone moved.
  */
  const refrescarCanais = useRef<() => void>(() => {})
  /** Live messages waiting for the next batch. See `juntarLote`. */
  const porJuntar = useRef<ChatMessage[]>([])
  /*
    The echo of our message (ordem-resposta, 20/11/2026): the line takes its server
    `seq` and its server place, in memory and in the batch still waiting. A message
    the server numbered before ours, still in the batch, then enters before it
    (`lugarPorSeq`). Without this the line kept `seq` -1 and arrival order until a restart.
  */
  useEffect(
    () =>
      bridge.on.eco?.((eco) => {
        porJuntar.current = porJuntar.current.map((message) =>
          message.channel === eco.channel && message.seq < 0 && message.payload.t === "message" && message.payload.id === eco.id
            ? { ...message, seq: eco.seq }
            : message,
        )
        setMessages((current) => confirmarNaMemoria(current, eco))
      }),
    [bridge],
  )
  const loteAgendado = useRef(false)
  /** The batch waiting for its frame, if any: run now when the page hides. */
  const juntarPendente = useRef<(() => void) | null>(null)
  /** When the frame now outstanding was asked for (`performance.now()`), or null when none is. */
  const quadroPedidoEm = useRef<number | null>(null)
  /** A frame asked for and not run within the deadline: this page has no frames right now. */
  const quadrosParados = (): boolean =>
    quadroPedidoEm.current !== null && performance.now() - quadroPedidoEm.current > PRAZO_DO_QUADRO_MS
  /** One frame request at a time; when it runs it clears the mark and lets the waiting batch in. */
  const pedirQuadro = (): void => {
    if (quadroPedidoEm.current !== null) return
    quadroPedidoEm.current = performance.now()
    requestAnimationFrame(() => {
      quadroPedidoEm.current = null
      juntarPendente.current?.()
    })
  }
  /*
    A frame asked for just before the page hides does not run until it comes
    back, and the batch, the unread counters with it, would wait the whole
    absence. Hiding lets it in at once.
  */
  useEffect(() => {
    const aoEsconder = (): void => {
      if (document.visibilityState === "hidden") juntarPendente.current?.()
    }
    document.addEventListener("visibilitychange", aoEsconder)
    return () => document.removeEventListener("visibilitychange", aoEsconder)
  }, [])
  useSessionEvents(bridge, {
    onMessage: (message) => {
      // Kind and channel only. What was said never enters this log.
      recordDiagnostic({ kind: "message", channel: message.channel, code: message.payload.t })
      /*
        A profile goes into the interface directory, not into the chat list
        (3/11/2026). It counted toward each channel's cap: in a flood of entries
        in the common channel, republished profiles pushed the old chat off the
        screen, and the profile itself, when it left the list, took the name
        with it ("No name" with the name in the vault). The most recent wins,
        like in the vault (`upsertDirectory`) and in `useDirectory`.
      */
      if (message.payload.t === "profile") {
        const incoming = profileFromPayload(message.payload)
        setDirectorySeed((antes) => {
          const conhecido = antes.get(message.sender)
          if (conhecido && (conhecido.updatedAt ?? 0) > (incoming.updatedAt ?? 0)) return antes
          const depois = new Map(antes)
          depois.set(message.sender, incoming)
          return depois
        })
        return
      }
      // The same message again (telemetry and then server): one line. See `juntarCopiaAoVivo`.
      /*
        Queued, and everything that arrives in the same task enters in ONE update at
        its end (a microtask): a page of a recovery, a portrait, a batch of reports.
        Not across tasks: a time window there changed what the screen shows right
        after a message, and twenty tests of the screen rely on that. See `juntarLote`.
      */
      porJuntar.current.push(message)
      if (!loteAgendado.current) {
        loteAgendado.current = true
        const juntar = (): void => {
          // Runs once: from its frame, its deadline, a later message, its own task or the page hiding, whichever comes first.
          if (juntarPendente.current !== juntar) return
          juntarPendente.current = null
          loteAgendado.current = false
          const lote = porJuntar.current
          porJuntar.current = []
          /*
            Others' messages enter as a transition: after a return from a
            minimized window, the backlog of an absence is hundreds of them,
            and a click right after the return must not wait for that render.
            React draws the click first and the backlog after, and drops a
            backlog render that a click interrupts. Our own sends stay urgent:
            the outbox entry leaves in the same render, or the line blinks.
          */
          const nossas = lote.some((m) => m.seq < 0 || (notifyRef.current.me !== null && m.sender === notifyRef.current.me))
          const tectoDe = (channel: string): number => {
            const carregadas = carregadasAMao.current.get(channel) ?? 0
            // Loaded by hand: room for what was loaded and for a full bound of arrivals after it.
            return carregadas > 0 ? 2 * MEMORY_HARD_CAP + carregadas : MEMORY_HARD_CAP
          }
          if (lotePorQuadro && !nossas) startTransition(() => setMessages((current) => juntarLote(current, lote, tectoDe)))
          else setMessages((current) => juntarLote(current, lote, tectoDe))
          // Our own sends come back through here (seq -1); the matching outbox
          // entry has served its purpose the moment the real message exists.
          // In the same tick as the list, or the message would blink out for one frame.
          for (const item of lote) outbox.noteOwnMessage(item)
        }
        /*
          Once per frame: each server frame is a task, and
          a burst of 200 events was 200 renders, each with a forced layout to stay
          at the bottom. Now what arrives before the next frame enters in one
          render. A hidden page has no frames, and its timers are throttled to a
          second or more: there, the batch enters at the end of the task that
          brought it (still one render per server frame, never one per message).
        */
        juntarPendente.current = juntar
        /*
          The frame is never the only way in. A window covered by another, in
          another Space or minimized has no frames, and Safari can keep it
          "visible" the whole time (1.3.16.1): the batch, the unread counters and
          the title waited for the window to show again. So: a frame, with a
          deadline; once a frame has been asked for and not come for longer than
          that, the frames are stopped and each batch enters at the end of its own
          task, like a hidden page. No timer on that path: the browser throttles
          those to a second or more in the same states. The first frame that
          runs again brings the per-frame batching back.
        */
        if (lotePorQuadro && typeof requestAnimationFrame === "function" && document.visibilityState === "visible" && !quadrosParados()) {
          pedirQuadro()
          setTimeout(juntar, PRAZO_DO_QUADRO_MS)
        } else if (lotePorQuadro) {
          if (typeof requestAnimationFrame === "function" && document.visibilityState === "visible") pedirQuadro()
          queueMicrotask(juntar)
        } else {
          queueMicrotask(juntar)
        }
      } else if (lotePorQuadro && juntarPendente.current && (document.visibilityState !== "visible" || quadrosParados())) {
        // A batch already waiting for a frame that is not coming: it enters now, this message with it.
        queueMicrotask(juntarPendente.current)
      }
      /**
       * The return slot is not given here.
       *
       * It was here: an acceptance arriving live triggered return seating from
       * the shell. It moved to the core, which is where it belongs, for two
       * reasons. An acceptance that arrives with the app closed, the normal
       * case, never passes through here, and the next connection's
       * reconciliation is also in the core: keeping the two halves in different
       * layers guaranteed they would drift apart. And the criterion for what
       * earns a slot is the same as the fold, which the core reads from the
       * vault and this shell would only have in memory.
       */
      const { me } = notifyRef.current
      /*
        Someone I blocked: the message stays in the list (a room folds it, see
        `Timeline`), and nothing else. No sound, no bell, no system notice, in
        any channel. The core already drops what they say in a direct or a wall;
        this is the shared room, where it lets it through. See `lib/bloqueados.ts`.
      */
      if (me && message.sender !== me && bloqueadosRef.current.has(message.sender)) return
      // The sound for what does not go through the bell: tickets and publications.
      // The rest (direct, mention, requests) rings as the bell entry comes. Without
      // knowing who I am, there is no way to know whose message it is: it stays silent.
      const somExtra = me
        ? somDaMensagem(
            message,
            me,
            (canal, sala, ticket) => bridge.channels.tickets?.(canal, sala)?.find((quem) => quem.id === ticket) ?? null,
            readPrefs().silenciados,
          )
        : null
      if (somExtra) motor.tocar({ tipo: somExtra, canal: message.channel })
      // A new message in a room of a channel: the subtle sound. See `somDoCanal`.
      const somDoGrupo = me && !somExtra ? somDoCanal(message, me, readPrefs().silenciados) : null
      if (somDoGrupo) motor.tocar({ tipo: somDoGrupo, canal: message.channel, sala: salaDaMensagem(message) })
      if (me && message.sender !== me && message.payload.t === "friend.request") {
        pushNotification({
          id: `freq:${message.channel}:${message.payload.sentAt ?? 0}`,
          kind: "friend-request",
          at: message.payload.sentAt ?? Date.now(),
          actor: message.sender,
          channel: message.channel,
          read: false,
        })
      }
      /**
       * I was mentioned. This always alerts, and that is why the mention exists.
       *
       * Unlike the line below, it does not require the chat to be direct: a
       * mention in a channel of thirty people is precisely where it does
       * something, without it, what concerns me goes unnoticed in the noise of
       * what does not. A mention that silence swallows is not a mention.
       *
       * Read from `mentions`, never from the body. Searching for @ signs in the
       * text would put the interface guessing who is who from names that change,
       * and it would get it wrong whenever two people chose the same, which is
       * exactly what the protocol field was created to prevent.
       *
       * "Busy" still counts: it is handled where system notifications are
       * decided (`maybeNotify`), and this log is the bell inside the app, which
       * someone coming back wants to find waiting.
       */
      if (me && message.sender !== me && message.payload.t === "message") {
        // `@all` counts, except in a muted place. A mention by name always goes through.
        const todosCalado = estaSilenciado(
          readPrefs().silenciados,
          message.channel,
          (message.payload as { room?: string }).room ?? "",
        )
        if (mencionaMe(message.payload.mentions, me, todosCalado)) {
          pushNotification({
            id: `mention:${message.channel}:${message.payload.id ?? message.payload.sentAt ?? 0}`,
            kind: "mention",
            at: message.payload.sentAt ?? Date.now(),
            actor: message.sender,
            channel: message.channel,
            read: false,
          }, isDirect(message.channel) ? undefined : salaDaMensagem(message), message.aoVivo === true)
        }
      }
      /*
        A muted private chat does not go into the bell, does not ring, and does
        not alert: the bell swinging is also an alert. If the message mentions
        me, the mention above already went in, and that is what the mute lets through.
      */
      if (
        me &&
        message.sender !== me &&
        message.payload.t === "message" &&
        isDirect(message.channel) &&
        !estaSilenciado(readPrefs().silenciados, message.channel)
      ) {
        const at = message.payload.sentAt ?? Date.now()
        const entrada: AppNotification = {
          id: `dm:${message.channel}:${message.payload.id ?? at}`,
          kind: "dm-message",
          at,
          actor: message.sender,
          channel: message.channel,
          read: false,
        }
        // Outside the state updater on purpose: React can run the updater more than
        // once, and a system notification is a side effect, not a calculation, inside
        // it, it would appear doubled.
        // Only what happens now, and once: see `pushNotification`.
        if (message.aoVivo === true && !idsNoSino.current.has(entrada.id)) {
          idsNoSino.current.add(entrada.id)
          const avisoComSom = avisarSistema(entrada)
          // The mention wins: if it names me, the mention sound already played, above.
          if (!mencionaMe(message.payload.mentions, me)) tocarPelaEntrada(entrada, avisoComSom)
        }
        // One unread entry per conversation, not one per message.
        setNotifications((current) =>
          current.some(
            (entry) => entry.kind === "dm-message" && entry.channel === message.channel && !entry.read,
          )
            ? current
            : appendNotification(current, entrada),
        )
      }
      /*
        A role given to me (12/11/2026): bell, system notice and sound, one entry for
        all the roles given at once. The core only marks a live, accepted assignment
        that ADDS roles: nothing on removal, nothing for history. See `cargosNovos`.
      */
      if (me && message.cargosNovos && message.cargosNovos.length > 0) {
        const at = (message.payload as { assignedAt?: number }).assignedAt ?? Date.now()
        pushNotification({
          id: `cargo:${message.channel}:${at}`,
          kind: "role-given",
          at,
          actor: message.sender,
          channel: message.channel,
          cargos: message.cargosNovos.map((cargo) => ({
            nome: cargo.nome ?? (cargo.role === "admin" ? strings.cargos.adminName : cargo.role),
            cor: cargo.cor,
          })),
          read: false,
        })
      }
      if (message.payload.t === "friend.accept" && me && message.sender !== me) {
        pushNotification({
          id: `facc:${message.channel}:${message.payload.acceptedAt ?? 0}`,
          kind: "friend-accept",
          at: message.payload.acceptedAt ?? Date.now(),
          actor: message.sender,
          channel: message.channel,
          read: false,
        })
      }
    },
    onStatus: (status) => handleStatus(status),
    // Epoch changes are protocol mechanics: keys rolled because membership
    // changed. It used to raise a toast per epoch — which meant a catch-up
    // replaying twenty commits raised twenty of them, in a corner of the
    // screen, saying nothing anyone could act on. The tick is the part that
    // matters: an epoch is precisely a membership change, so the member list
    // refreshes on it.
    onEpoch: (channel) => {
      recordDiagnostic({ kind: "epoch", channel })
      setEpochTick((tick) => tick + 1)
      // An epoch is a change in members: who joined a community of ours. See
      // `vigiaDasComunidades` and why it is not `member-joined`.
      lerMembrosDaComunidade(channel, false)
    },
    onConnection: (state, detail) => {
      recordDiagnostic({ kind: "connection", code: state, ...(detail ? { detail } : {}) })
      // Both edges start a burst of mechanics — restore, catch-up, welcomes —
      // and the silence window is measured from here.
      if (state === "connecting" || state === "online") router.current.connectedAt = Date.now()
      if (state === "online") portaoDoToque.current.ligou(Date.now())
      else portaoDoToque.current.desligou()
      // The server connection dropped with an SFU call standing: voice dropped
      // with it. See `criarVigiaDaQueda`.
      const queda = vigiaDaQueda.current.ligacao(state === "online", soundRef.current.callChannel !== null)
      if (queda) motor.tocar({ tipo: queda })
      setConnection(state)
      setConnectionDetail(detail)
      if (state === "online") {
        jaEsteveLigada.current = true
        setCaiuEm(null)
      } else if (jaEsteveLigada.current) {
        // The first drop counts; the retries that follow do not change the time.
        setCaiuEm((antes) => antes ?? Date.now())
      }
      // A dead socket makes every dot stale; the server re-tells the living
      // ones after the reconnect resubscribes.
      if (state !== "online") {
        setOnline(new Set())
        vigiaDosAmigos.current.desligou()
        vigiaDaVoz.current.desligou()
      }
      if (state === "online") {
        void bridge.session
          .capabilities()
          .then((caps) => setLivePresence(caps.includes("presence")))
          .catch(() => {})
        // Read at the same place and for the same reason: both things come from
        // `hello.ok`, and this is where we know it has arrived.
        void bridge.session
          .commonRoom?.()
          .then((sala) => {
            setCommonRoom(sala)
            calarSalaComumUmaVez(sala)
          })
          .catch(() => {})
        refrescarCanais.current()
      }
    },
    onChannels: (list) => {
      recordDiagnostic({ kind: "channels", detail: `${list.length}` })
      portaoDoToque.current.salasChegaram(Date.now())
      // The snapshot of who is in each community, before the first epoch.
      for (const channel of list) if (!comunidadesLidas.current.has(channel)) lerMembrosDaComunidade(channel, true)
      // The tags before the list: whoever draws the list asks the type of each channel.
      lembrarFichasDosCanais(bridge.channels.fichas?.())
      setChannels(list)
      /*
        The first channel, as `refreshChannels` picks it. The gate no longer
        waits for the connection (12/11/2026): the app can open before the
        vault groups are restored, with an empty list, and this event is the
        first to bring them.
      */
      if (stageRef.current === "ready") setCanal((current) => current ?? list.find((channel) => !isFeed(channel) && !isDirect(channel)) ?? null)
      // A channel we are waiting on (join-by-link) auto-opens the moment a
      // member admits us; any other new channel must not steal the focus.
      const awaited = pendingJoin.current
      if (awaited && list.includes(awaited)) {
        // The name before dropping the wait, which takes it with it. An opaque
        // address (1.0) is not a name: with no seal or published name, the phrase goes without a name.
        const nome = canalAEsperaParaMostrar(awaited, nomeDaEntrada.current, nomePublicado.current(awaited))
        esperarEntrada(null)
        setCanal(awaited)
        setView("chat")
        pushToast(nome ? strings.chat.joined(nome) : strings.chat.joinedOpaco)
        return
      }
      /*
        The safety net for a forged name.
        
        The channel name comes written in the link and no one checks it: the
        join request only carries the code's fingerprint. With a fake name, the
        channel we are waiting for never shows up, and a DIFFERENT one appears,
        in silence: the person would end up in a channel without knowing which,
        waiting for one that does not exist. It says so, once.
        
        It is an indication, not proof, and the phrase speaks as such: from here
        we cannot know which request a new channel answers to (only the core
        knows that, by the key package the request carried).
        A channel where someone sat us down at the same moment lights this up
        for no reason. That is why we do not steal focus or give up waiting for
        the named channel.
        */
      const antes = canaisAoPedir.current
      if (awaited && antes && !avisouDoNomeErrado.current) {
        const intruso = list.find(
          (channel) =>
            !antes.includes(channel) && !isFeed(channel) && !isDirect(channel) && !selfOpened.current.has(channel),
        )
        if (intruso) {
          avisouDoNomeErrado.current = true
          setEntradaComOutroNome(true)
          pushToast(
            eMoradaOpaca(awaited) || eMoradaOpaca(intruso)
              ? strings.invite.arrivedMismatchOpaco
              : strings.invite.arrivedMismatch(canalParaMostrar(intruso), canalParaMostrar(awaited)),
            "error",
          )
        }
      }
      // The default choice is a CHANNEL, so it skips feeds and direct conversations.
      // With a direct message here, the app would open in a conversation that the
      // sidebar does not list, with the sidebar pointing at nothing.
      setCanal((current) => current ?? list.find((channel) => !isFeed(channel) && !isDirect(channel)) ?? null)
      // News is a channel that appeared after the initial seed and that this
      // device did not open itself.
      const previous = prevChannels.current
      if (previous) {
        for (const channel of list) {
          if (previous.includes(channel) || isFeed(channel) || selfOpened.current.has(channel)) continue
          /*
            A direct that appears is never news (12/11/2026: "when a
            user opens the conversation with another, without friendship, the other
            user is notified; I do not want that").

            The channel arrives because the other side opened the conversation and
            their device seated us, which is cryptography and says nothing to anyone.
            Announcing it ("Ana opened a conversation with you", `dm-new`) rang, swung
            the bell and raised a system notice for a click on the other side, and it
            rang BEFORE the friend request that usually follows, so the request came
            with two sounds. What reaches the person is what is SAID there, through
            its own paths: a friend request (`friend-request`) or a message
            (`dm-message`). This also retires the old wait for our address
            (`directaPorResolver`), which existed only to name the `dm-new`.
          */
          if (isDirect(channel)) continue
          pushNotification({ id: `chan:${channel}`, kind: "room-added", at: Date.now(), channel, read: false })
        }
      }
      prevChannels.current = list
    },
    onPresence: (who, isOnline) => {
      setOnline((current) => {
        const next = new Set(current)
        if (isOnline) next.add(who)
        else next.delete(who)
        return next
      })
      // Outside the state updater: a toast is a side effect, and React may run the
      // updater twice. See `lib/amigosOnline.ts`.
      const agora = Date.now()
      if (vigiaDosAmigos.current.chegou(who, isOnline, agora, portaoDoToque.current.aAssentar(agora))) {
        avisarAmigoRef.current(who, "online")
      }
      if (!isOnline) {
        vigiaDaVoz.current.esquecer(who)
        // Someone who called and hung up without anyone answering leaves a missed call.
        for (const perdida of vigiaDasChamadas.current.desligou(who)) registarChamadaPerdidaRef.current(perdida)
      }
      // Someone who disconnects leaves any call, whether they had time to say so or
      // not. The `voice.leave` only arrives when someone presses disconnect: closing
      // the tab, sleeping the laptop, or losing the network does not notify anyone,
      // and the person stayed forever in the list of who is in a call.
      //
      // **Both maps, and with the SAME function.** This cleaned `ringing`, who is
      // in a call in the channel, and left `vozPorSala` untouched, which is the
      // voice room line in the sidebar: someone who closed their laptop left the
      // channel and stayed in the room. Written once and applied to both, there is
      // no place where the difference can fit again. See `semAPessoa`.
      if (!isOnline) {
        const tirar = (actual: ReadonlyMap<string, Map<string, number>>): Map<string, Map<string, number>> =>
          semAPessoa(actual, who)
        setRinging(tirar)
        setVozPorSala(tirar)
      }
    },
    onCallDiagnostic: (code, detail) => {
      // What a failed call needs to record: how many ICE servers came, whether any
      // was TURN, and in what state the connection died. Without this, the only
      // information available was "appears to be calling and disappears".
      recordDiagnostic({ kind: "action", code, ...(detail ? { detail } : {}) })

      // The media path, saved so the screen can say different things about
      // different states. See `caminhoDeMedia`, above.
      if (code === "call-caminho") setCaminhoDeMedia(caminhoDoDetalhe(detail))
      if (code === "call-caminho") vigiaDaQueda.current.caminho(caminhoDoDetalhe(detail))
      // Media through SFU held up (the entry, or the call remade after a drop): the
      // next drop is another.
      if (code === "call-sfu-ligado") vigiaDaQueda.current.mediaVoltou()
      // The call came back, or gave up (and the 403 says why): the "reconnecting" notice is no longer true.
      if (code === "call-sfu-ligado" || code === "call-sfu-refazer-falhou") {
        setAvisoDeChamada((actual) => (actual?.code === "call-sfu-a-religar" ? null : actual))
      }

      /*
        And the three that could not stay only in the log.

        This wrote EVERYTHING in the log and nothing else, and for the mechanics
        that is right. For three of these codes it was wrong: they describe a
        call that will not work, and no one on the screen knew. The worst is
        `call-sfu-oferta-de-malha`, two people in the same room on different
        media paths, never hearing each other, and `call.ts` itself already
        anticipated the outcome in writing: "the other person will see 'calling'
        until they give up and someone has to ask why".

        Which ones come in and which stay out is decided in `avisoDaChamada`,
        not here: it is a rule, and a rule that you can run without building
        the app is a rule you can prove.
      */
      // By `notifyRef` and not by `nameFor` from this scope: these handlers are
      // registered once and keep the closure from the FIRST render (see
      // `useSessionEvents`), when the directory is still empty. A toast that named
      // someone would come out with the address in raw form.
      const aviso = avisoDaChamada(code, detail, notifyRef.current.nameFor)
      if (aviso) setAvisoDeChamada(aviso)
      // The key arrived and the sound of who was missing opened: the toast at 447 is no longer true.
      if (code === "sfu-receptor-protegido-depois") {
        setAvisoDeChamada((actual) => (actual?.code === "sfu-receptor-sem-chave" ? null : actual))
      }
      // The sound of who was missing opened (4/11/2026): the toast at 453 is no longer true.
      if (code === "sfu-consumo-recuperado") {
        setAvisoDeChamada((actual) => (actual?.code === "sfu-consumo-em-falta" ? null : actual))
      }
      // The cipher of our source is ready (or gave up, and 448 says why): the toast
      // at 449 is no longer true.
      if (
        code === "sfu-emissor-cifra-recuperada" ||
        code === "sfu-emissor-cifra-desistiu" ||
        code === "sfu-emissor-cifra-largada"
      ) {
        setAvisoDeChamada((actual) => (actual?.code === "sfu-emissor-cifra-a-repetir" ? null : actual))
      }
    },
    onCallParticipants: setParticipants,
    onCallLocalStream: setLocalStream,
    onCallScreen: setScreenStream,
    onCallEnded: () => {
      setCallChannel(null)
      setCallRoom("")
      setParticipants([])
      setCallPopup(false)
      // The path and the toast are from this call and die with it. Without this, the
      // next call would open with the previous toast on top, talking about people
      // who are gone, and the previous path deciding the words.
      setCaminhoDeMedia(null)
      setAvisoDeChamada(null)
      // Screen capture dies with the call, in the core (see `#largarEcra`). This is
      // just the screen following: without this line, the call dock on the next call
      // would open saying "Sharing screen" about a share that no longer exists, and
      // the stage would have the last frame from the previous one.
      setScreenStream(null)
      vigiaDaQueda.current.chamadaAcabou()
    },
    onCallError: (detail, cause) => {
      // The core dropped the call because it did not remake it: voice fell without me leaving.
      if (detail === ERRO_DA_CHAMADA_QUE_CAIU) {
        const queda = vigiaDaQueda.current.chamadaCaiu()
        if (queda) motor.tocar({ tipo: queda })
      }
      // macOS refused a device: the alert carries the button to its panel (1.3.26).
      const recusado = DISPOSITIVO_DA_RECUSA[detail]
      const privacidade = bridge.privacidadeDoSistema
      if (recusado && privacidade) {
        pushToast(translateError(detail, cause), "error", {
          rotulo: strings.ecra.permissaoAbrir,
          fazer: () => void privacidade.abrir(recusado).catch(() => {}),
        })
        return
      }
      pushToast(translateError(detail, cause), "error")
    },
    /**
     * We were moved to a voice room at the request of whoever has that responsibility.
     *
     * The client already obeyed when this arrives: the screen just follows. And
     * it needs saying, because a call that changes under the feet of someone
     * speaking, with no signal at all, is indistinguishable from a malfunction.
     */
    onCallMoved: (event) => {
      // Being moved is not entering: the "enter silenced" does not apply here.
      movidoPara.current = `${event.channel}/${event.room}`
      // The sound of being moved, like in Discord. Entry into the new room does not
      // play its sound (`entradaMovida`): an event, a sound.
      entradaMovida.current = chaveDaSala(event.channel, event.room)
      motor.tocar({ tipo: "movido" })
      setCallChannel(event.channel)
      setCallRoom(event.room)
      setActiveRooms((actual) => ({ ...actual, [event.channel]: event.room }))
      const sala = salaParaAviso(event.room, bridge.channels.rooms?.(event.channel)?.find((quarto) => quarto.room === event.room))
      // The room's name, or the word: never the room's identifier (16/11/2026).
      pushToast(strings.voiceMove.moved(notifyRef.current.nameFor(event.by), sala ?? strings.voiceMove.outraSala))
    },
    onCallDesligado: (event) => {
      // I did not leave: it is a lost connection. The `ended` already came before.
      const queda = vigiaDaQueda.current.desligadoPorOutro()
      if (queda) motor.tocar({ tipo: queda })
      pushToast(strings.voiceMove.disconnectedYou(notifyRef.current.nameFor(event.by)))
    },
    // Track who is in a call, per channel, so a call in progress is visible
    // rather than something you have to be told about out of band.
    onCallActivity: (event) => {
      // Ring only when a call starts in a channel of ours: the first person in,
      // not us, and not a call this device is already sitting in. Computed off
      // the mirror before the state update, so a re-invoked updater cannot
      // make the same event ring twice.
      const ring = callSoundOf({
        joined: event.joined,
        actorIsMe: event.from === notifyRef.current.me,
        callAlreadyOngoing: (soundRef.current.ringing.get(event.channel)?.size ?? 0) > 0,
        imInThisCall: soundRef.current.callChannel === event.channel,
        aAssentar: portaoDoToque.current.aAssentar(Date.now()),
      })
      // Only in a direct conversation, and repeats until answered (or 30 s). In a
      // voice room in a community it does not play: no one calls anyone, and the
      // room line already shows who entered. See `tocaOToque`.
      if (ring && tocaOToque(event.channel) && motor.tocarChamada(event.channel, { repetir: true }) === "tocou") {
        /*
          Who is calling, said in words (screen readers read the toast stack),
          with "Decline" (21/11/2026). Declining stops the ring on this device
          only: the call goes on, and the conversation still has the button to
          join it. The notice lasts as long as the ring can.
        */
        const canal = event.channel
        const texto = strings.sidebar.callingYou(notifyRef.current.nameFor(event.from))
        if (avisoDoToque.current) dispensarToast(avisoDoToque.current.texto)
        avisoDoToque.current = { canal, texto }
        pushToast(texto, "info", {
          rotulo: strings.call.declineRing,
          fazer: () => {
            avisoDoToque.current = null
            motor.pararChamada(canal)
          },
          duracaoMs: TOQUE_MAXIMO_MS,
        })
      }
      /*
        The missed call: a direct conversation rang, and whoever called left
        without anyone answering. Answering is our address entering, from this
        device or another on the account. See `lib/chamadasPerdidas.ts`.
      */
      if (ring && tocaOToque(event.channel)) vigiaDasChamadas.current.tocou(event.channel, event.from, Date.now())
      if (event.from === notifyRef.current.me && event.joined) vigiaDasChamadas.current.atendida(event.channel)
      if (!event.joined) {
        const perdida = vigiaDasChamadas.current.saiu(event.channel, event.from)
        if (perdida) registarChamadaPerdidaRef.current(perdida)
      }
      /*
        The voice friend toasts: entered a room, started sharing the screen.
        Only in communities (a direct call already rings), never about ourselves,
        and never about the room we are already in: you can see and hear it
        there.
        */
      {
        const agoraVoz = Date.now()
        const naVoz = vigiaDaVoz.current.ouvir({
          sala: chaveDaSala(event.channel, event.room),
          quem: event.from,
          entrou: event.joined,
          ecra: event.joined && (event.transmite === "ecra" || event.transmite === "ecra+musica"),
          agora: agoraVoz,
          aAssentar: portaoDoToque.current.aAssentar(agoraVoz),
        })
        const jaLaEstou =
          soundRef.current.callChannel === event.channel && soundRef.current.callRoom === event.room
        const daComunidade = !isDirect(event.channel) && !isFeed(event.channel)
        if (event.from !== notifyRef.current.me && daComunidade && !jaLaEstou) {
          const onde = { canal: event.channel, sala: event.room }
          // Both things at once (entered already sharing): one card only, the screen one.
          if (naVoz.comecouOEcra) avisarAmigoRef.current(event.from, "ecra", onde)
          else if (naVoz.entrou) avisarAmigoRef.current(event.from, "voz", onde)
        }
      }
      /**
       * And the two notes about who enters and leaves the room we are in.
       *
       * They do not collide with the ring above: that one exists only for calls
       * we are NOT in, these exist only for the room we are in. Also calculated
       * before changing state, and for the same reason, a reinvoked `setState`
       * cannot make the same event ring twice.
       */
      const naSala = vozOuvida.current.hear(
        {
          room: chaveDaSala(event.channel, event.room),
          joined: event.joined,
          who: event.from,
          isMe: event.from === notifyRef.current.me,
          connected: soundRef.current.participants.some((quem) => quem.address === event.from),
          // Read from disk and not from the React snapshot: `escolherAudio` saves before
          // changing state, so this is always on time.
          deafened: readPrefs().soundOff,
        },
        Date.now(),
      )
      // In the AFK room no one hears anyone, and whoever arrives or leaves plays nothing.
      if (naSala && !naSalaAfkRef.current) playSound(naSala)
      setRinging((current) => {
        const agora = Date.now()
        const next = new Map(current)
        // With a timestamp, for the same reason as `vozPorSala`: without it, someone
        // who disappears without saying goodbye stays "in a call" forever.
        const inChannel = new Map(next.get(event.channel) ?? [])
        if (event.joined) inChannel.set(event.from, agora)
        else inChannel.delete(event.from)
        const vivas = presencasVivas(inChannel, agora)
        if (vivas.size === 0) next.delete(event.channel)
        else next.set(event.channel, vivas)
        return next
      })
      // And in WHICH voice room, which is what makes the sidebar circle blink where
      // the conversation is happening, not just where we already are.
      setVozPorSala((current) => {
        const agora = Date.now()
        const next = new Map(current)
        const chave = chaveDaSala(event.channel, event.room)
        // Save WHEN, not just who: without a timestamp, someone who closes their laptop
        // without saying goodbye stayed in the list forever.
        const naSala = new Map(next.get(chave) ?? [])
        if (event.joined) naSala.set(event.from, agora)
        else naSala.delete(event.from)
        const vivas = presencasVivas(naSala, agora)
        if (vivas.size === 0) next.delete(chave)
        else next.set(chave, vivas)
        return next
      })
      // Each announcement says the entire state: without `transmite` it is "no longer transmitting".
      setTransmitePorSala((current) => {
        const chave = chaveDaSala(event.channel, event.room)
        const antes = current.get(chave)
        const transmite = event.joined ? event.transmite : undefined
        if (antes?.get(event.from) === transmite) return current
        const next = new Map(current)
        const naSala = new Map(antes ?? [])
        if (transmite) naSala.set(event.from, transmite)
        else naSala.delete(event.from)
        if (naSala.size === 0) next.delete(chave)
        else next.set(chave, naSala)
        return next
      })
    },
  })

  /** The first screen of `Setup`: the three ways in, or the account file from "Este aparelho saiu da conta". */
  const [telaDoSetup, setTelaDoSetup] = useState<TelaDoSetup>("entrada")

  /**
   * The two ways out of "Este aparelho saiu da conta". With no vault left, the
   * screen opens here; with the locked vault still on disk, an empty account is
   * added next to it first (`outraEntrada.ts`), and nothing is deleted.
   */
  const sairDoAparelhoRemovido = useCallback((intencao: "ficheiro" | "outro-aparelho") => {
    void entrarNumaContaNova(bridge, intencao)
      .then((onde) => {
        if (onde !== "aqui") return
        if (intencao === "outro-aparelho") setStage("emparelhar")
        else {
          setTelaDoSetup("ficheiro")
          setStage("setup")
        }
      })
      .catch((erro: Error) => pushToast(traduzirErro(erro), "error"))
  }, [bridge])

  /** The line the gate shows when a pairing link comes to nothing. */
  const [avisoDeEmparelhamento, setAvisoDeEmparelhamento] = useState<string | null>(null)

  // The boot check, retryable: if the vault cannot even be probed (IndexedDB
  // refusing to open, usually), that is an error screen — not eternal splash.
  const checkVault = useCallback(() => {
    setStage("loading")
    setBootError(null)
    setAvisoDeEmparelhamento(null)
    aparelhoRevogadoRef.current = false
    aparelhoRemovidoRef.current = false
    setAparelhoRevogado(false)
    setEmparelhamentoPorAcabar(false)
    contaSuspensaRef.current = false
    setAvisoDeSuspensao(null)
    void bridge.vault
      .status()
      .then(({ exists, versao }) => {
        /*
          The page opened by a pairing link and this device does not yet have an
          account: it is the phone joining, and the gate opens on that page with
          the link already read. With a vault, the link is useless: joining is
          for those without an account, and the one here stays as it is. The link
          is forgotten, in both cases, because it is a secret to the bearer and
          must not stay saved in the tab after the gate looked at it.

          But saying so it does: a link opened on the wrong device, or a link
          that did not even read, gave a normal gate and no explanation: the
          person stared at "Unlock" without understanding what happened to what
          they opened. One line each, like the invite one.
        */
        if (emparelhamentoDeArranque?.link && !exists) {
          setStage("emparelhar")
          return
        }
        /*
          A vault from beta (0.9.x, without the `orwv2` header): 1.0 never reads
          it. The cut screen enters BEFORE `Unlock`, not inside it: `Unlock`
          tries right at mount a silent unlock (`vault.unlock` with the system
          key), and with this branch here that attempt never runs. The pairing
          link is forgotten for the usual reason (it is a secret to the bearer);
          after Setup the person can open it again. Missing `versao` (a bridge
          that does not say it) gives the normal gate: the core refuses all the
          same a beta vault on `unlock`, with its error and without deriving the
          key (slice 2).
        */
        if (exists && versao === "beta") {
          emparelhamentoDeArranque?.forget()
          setStage("saiu-de-beta")
          return
        }
        if (emparelhamentoDeArranque?.link) setAvisoDeEmparelhamento(strings.pairing.gateHasAccount)
        else if (emparelhamentoDeArranque?.invalid) setAvisoDeEmparelhamento(strings.pairing.gateInvalid)
        emparelhamentoDeArranque?.forget()
        setStage(exists ? "unlock" : "setup")
      })
      .catch((error: Error) => {
        setBootError(traduzirErro(error))
        setStage("error")
      })
  }, [])

  useEffect(checkVault, [checkVault])

  /**
   * The button "Orwell left beta": erases the old vault WITHOUT opening it and
   * opens Setup.
   *
   * `vault.destroy` does not read the file (it is `lock()` and
   * `backend.clear()` in the core; on desktop, `prepareAccountDeletion` before,
   * which with the vault closed has no groups to leave). So it works for a
   * vault this version does not know how to decrypt. If it fails, the gate
   * error screen, with "Try again", which asks the disk again what is there.
   */
  const criarContaNovaDoBeta = useCallback(() => {
    void bridge.vault
      .destroy()
      .then(() => setStage("setup"))
      .catch((error: Error) => {
        setBootError(traduzirErro(error))
        setStage("error")
      })
  }, [])

  /*
    The account state (read, archive, preferences) now comes from the session
    when the account opens, with a one-time migration of what was in the
    browser. See `lib/estadoDaConta.ts`. On leaving `ready` (lock, unmount)
    it goes back to local mode.
  */
  const toastRef = useRef(pushToast)
  toastRef.current = pushToast
  useEffect(() => {
    if (stage !== "ready") return
    let vivo = true
    let desligar: (() => void) | null = null
    void ligarEstadoDaConta(bridge, (erro) => toastRef.current(traduzirErro(erro), "error")).then((fn) => {
      if (vivo) desligar = fn
      else fn()
    })
    return () => {
      vivo = false
      desligar?.()
    }
  }, [stage])

  /*
    The nameless profile on entry is from a device just paired to someone whose
    profile has not yet arrived from the main device (phase 1e). It is said once
    per session, and the core publishes nothing until it arrives (`publishProfile`
    requires a name).
    */
  const perfilPorChegarDito = useRef(false)
  useEffect(() => {
    if (stage !== "ready") return
    void bridge.profile
      .get()
      .then((lido) => {
        setProfile(lido)
        if (!lido.displayName && !perfilPorChegarDito.current) {
          perfilPorChegarDito.current = true
          pushToast(strings.pairing.profileMissing, "info")
        }
      })
      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
  }, [stage])

  // The profile that another device on the account changed, and the core adopted (phase 1e).
  useEffect(() => {
    const ouvir = bridge.on.perfil
    if (stage !== "ready" || !ouvir) return
    return ouvir(({ profile: chegou }) => setProfile(chegou))
  }, [stage])

  /*
    The profiles of other people that a sibling device reported (profiles between
    devices). They do not arrive as a message: they are in the vault directory,
    and we reread the entire directory, as on entry. Without this, the new name
    only appeared on reload.
  */
  useEffect(() => {
    const ouvir = bridge.on.perfis
    if (stage !== "ready" || !ouvir) return
    return ouvir(() => {
      void bridge.profile
        .directory()
        .then((stored) =>
          setDirectorySeed(new Map(Object.entries(stored).map(([addr, entry]) => [addr, profileFromPayload(entry.payload)]))),
        )
        .catch(() => {
          // Losing the reread costs the new name until next time, not messages.
        })
    })
  }, [stage])

  /*
    History arriving from a sibling device (1.0 "Arca"). It does not arrive as
    a message: the core merges it into the vault and reports that channels changed. Each
    is read again, and enters what memory does not have; a message that was already there and gained
    the bytes of an image (media comes at the end) gets replaced by the vault version. With
    new profiles, the directory is read again, just like for profiles.
  */
  useEffect(() => {
    const ouvir = bridge.on.historico
    if (stage !== "ready" || !ouvir) return
    const mediaDe = (payload: ChatMessage["payload"]): string => {
      const p = payload as Record<string, unknown>
      return JSON.stringify([p["attachments"], p["media"], p["links"]])
    }
    return ouvir((evento) => {
      for (const channel of evento.canais) {
        void bridge.channels
          .history(channel)
          .then((entries) => {
            const doCofre = new Map(entries.map((entry) => {
              const message = toChatMessage(channel, entry)
              return [keyOf(message), message] as const
            }))
            setMessages((current) => {
              const known = new Set<string>()
              let mudou = false
              const trocadas = current.map((message) => {
                const key = keyOf(message)
                known.add(key)
                const novo = message.channel === channel ? doCofre.get(key) : undefined
                if (!novo || mediaDe(novo.payload) === mediaDe(message.payload)) return message
                mudou = true
                return { ...message, payload: novo.payload }
              })
              const novas = [...doCofre.entries()].filter(([key]) => !known.has(key)).map(([, message]) => message)
              if (novas.length === 0 && !mudou) return current
              return [...novas, ...trocadas]
            })
          })
          .catch(() => {
            // Losing the reread costs the history until the next startup, and not the vault.
          })
      }
      if (evento.canais.length > 0) refrescarCanais.current()
      if (evento.perfis) {
        void bridge.profile
          .directory()
          .then((stored) =>
            setDirectorySeed(new Map(Object.entries(stored).map(([addr, entry]) => [addr, profileFromPayload(entry.payload)]))),
          )
          .catch(() => {})
      }
    })
  }, [stage])

  const refreshChannels = useCallback(async () => {
    const list = await bridge.channels.list()
    lembrarFichasDosCanais(bridge.channels.fichas?.())
    setChannels(list)
    setCanal((current) => current ?? list.find((channel) => !isFeed(channel) && !isDirect(channel)) ?? null)
    return list
  }, [])
  refrescarCanais.current = () => {
    if (stageRef.current === "ready") void refreshChannels().catch(() => {})
  }

  /**
   * Close a conversation: remove it from the list, nothing else.
   *
   * **Does not delete, does not drop the channel, does not undo any membership.** The conversation
   * comes back by itself when a message arrives, what makes this a gesture without
   * regret, unlike leaving a channel. See `lib/directs.ts`.
   *
   * Closing the one that is open leaves the body without a conversation, instead of keeping it in
   * front of whoever just closed it.
   */
  /** Reopen: the flag goes away, and the conversation counts again like any other. */
  const reabrirDirecta = useCallback((channel: string) => {
    desarquivar(channel)
  }, [])

  /*
    No confirmation, and with the path back in the notice. Close destroys nothing,
    so there is no confirmation prompt; but whoever closed the wrong conversation needs to get it
    back without waiting for someone to write to them.
  */
  const fecharDirecta = useCallback(
    (channel: string) => {
      // The timestamp of `closeDirect`, which already carries protection against clock skew.
      arquivar(channel, closeDirect({}, channel, messages)[channel]!)
      setDirecta((actual) => (actual === channel ? null : actual))
      pushToast(strings.people.directClosed, "info", {
        rotulo: strings.people.directReopen,
        fazer: () => reabrirDirecta(channel),
      })
    },
    [messages, pushToast, reabrirDirecta],
  )

  /**
   * Open (creating on first use) a direct conversation with a person.
   *
   * Opens in **Friends**, which is where direct conversations now live. It used to
   * go to the channel destination, and the result was the bug you would see: the
   * conversation appeared in a place whose sidebar no longer listed it, and the
   * Friends conversation list fell behind, without the conversation that had just
   * been opened.
   *
   * Restores the line in the list first: sending a message to someone whose
   * conversation was closed must bring it back, or else you would open a
   * conversation that the column beside continued to hide.
   */
  const abrirDirectaCom = useCallback(
    async (who: string): Promise<string> => {
      const channel = await bridge.social.openDirect(who)
      selfOpened.current.add(channel)
      await refreshChannels()
      reabrirDirecta(channel)
      setDirecta(channel)
      setView("pessoas")
      return channel
    },
    [refreshChannels, reabrirDirecta],
  )
  const openDm = useCallback(
    (who: string) => {
      void abrirDirectaCom(who).catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [abrirDirectaCom, pushToast],
  )

  /**
   * Enter a call in a conversation, with or without video.
   *
   * One path only for the conversation menu and for the "Call" in the
   * person menu. It was written twice in the channel menu, once per button.
   */
  const entrarNaChamada = useCallback(
    (channel: string, video = false) => {
      setCallChannel(channel)
      const pedido = video ? bridge.call.join(channel, { video: true }) : bridge.call.join(channel)
      void pedido.catch((error: Error) => {
        setCallChannel(null)
        setCallRoom("")
        pushToast(traduzirErro(error), "error")
      })
    },
    [bridge, pushToast],
  )

  /** Call a friend: opens the direct conversation and enters its call. */
  const chamarPessoa = useCallback(
    (who: string) => {
      void abrirDirectaCom(who)
        .then((channel) => entrarNaChamada(channel))
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [abrirDirectaCom, entrarNaChamada, pushToast],
  )

  /**
   * Bring the vault's memory into React state: remembered names, then the
   * newest slice of every channel's stored history. Live messages that arrived
   * while this ran are deduplicated by id, never doubled.
   */
  /*
    Channels whose history has already been seeded in this session.

    Seeding ran ONCE, on startup, with the list at that moment. On WebKit, with
    the vault unlocked silently, that list came empty (the first connection
    dropped before the core restored the groups) and channels that appeared later
    opened with nothing, with data in the vault. Now each channel is seeded the
    first time it appears, whenever that is, and never twice.
  */
  const semeados = useRef(new Set<string>())
  const seedStored = useCallback(async (list: string[]) => {
    const novos = list.filter((channel) => !semeados.current.has(channel))
    if (novos.length === 0) return
    try {
      const stored = await bridge.profile.directory()
      setDirectorySeed(
        new Map(Object.entries(stored).map(([addr, entry]) => [addr, profileFromPayload(entry.payload)])),
      )
    } catch {
      // Losing the seed costs display names, not messages: addresses still show.
    }

    const seeded: ChatMessage[] = []
    const hadStored = new Set<string>()
    const older = new Map<string, boolean>()
    for (const channel of novos) {
      try {
        const entries = await bridge.channels.history(channel)
        // Only counts as seeded after the read runs well: a vault that
        // failed now tries again on the next list.
        semeados.current.add(channel)
        if (entries.length === 0) continue
        hadStored.add(channel)
        const { pagina, esgotou } = paginaDoCofre(
          entries.map((entry) => toChatMessage(channel, entry)),
          (message) => message.payload.t === "message",
          MEMORY_PER_CHANNEL,
        )
        // Past the vault, the archived conversation (17/11/2026) and the members' past (history-last-100) also count as older.
        const maisAntigas =
          !esgotou ||
          (await bridge.channels.temConversaArquivada?.(channel).catch(() => false)) === true ||
          (await bridge.channels.hasOlderFromMembers?.(channel).catch(() => false)) === true
        older.set(channel, maisAntigas)
        seeded.push(...semVotosAMais(pagina, channel))
        /*
          The seeded lines can be many more entries (reactions, edits, the state between
          them): what passes `MEMORY_PER_CHANNEL` raises the channel's bound, as a tap
          of "load older" does, so the next arrivals do not cut the lines just seeded.
        */
        const amais = contaNoTecto(pagina) - MEMORY_PER_CHANNEL
        if (amais > 0) carregadasAMao.current.set(channel, Math.max(carregadasAMao.current.get(channel) ?? 0, amais))
      } catch {
        // A channel whose history cannot be read simply starts empty.
      }
    }
    // Merge with what was already seeded, do not replace: channels from before
    // keep the divider and "load older".
    setSeededChannels((actual) => (hadStored.size === 0 ? actual : new Set([...actual, ...hadStored])))
    setOlderAvailable((actual) => (older.size === 0 ? actual : new Map([...actual, ...older])))
    if (seeded.length > 0) {
      setMessages((current) => {
        const known = new Set(current.map(keyOf))
        return [...seeded.filter((message) => !known.has(keyOf(message))), ...current]
      })
    }
  }, [])

  /**
   * The first connection failed: the banner says why. Called by `enter` and,
   * since the gate stopped waiting for the connection (12/11/2026), by the
   * `Unlock` after the app is already open. A revocation or a suspension is not
   * a connection failure: `handleStatus` already moved the stage.
   */
  const anotarLigacaoFalhada = useCallback((ligacaoFalhou: Error) => {
    if (aparelhoRevogadoRef.current || contaSuspensaRef.current) return
    recordDiagnostic({ kind: "connection", code: "offline", detail: ligacaoFalhou.message })
    setConnection((actual) => (actual === "online" ? actual : "offline"))
    setConnectionDetail(traduzirErro(ligacaoFalhou))
    setCaiuEm((antes) => antes ?? Date.now())
  }, [])

  const enter = useCallback(
    (addr: string, ligacaoFalhou?: Error) => {
      /*
        The connection that just failed was a revocation: do not enter. The gate
        builds again, stopped and with the message. See `aparelhoRevogadoRef`.
      */
      if (aparelhoRevogadoRef.current) {
        setAparelhoRevogado(true)
        // Erasing (removed with proof): `handleStatus` moves the stage when the vault is gone.
        if (aparelhoRemovidoRef.current) return
        setVezDoPortao((vez) => vez + 1)
        setStage("removido")
        return
      }
      // The connection failed because the account is suspended: stays in the notice, with the vault open.
      if (contaSuspensaRef.current) {
        setAddress(addr)
        setStage("suspensa")
        return
      }
      setAddress(addr)
      setStage("ready")
      setEntrada((vez) => vez + 1)
      marcarArranque("app")
      /*
        The first connection failed: the app opens with what the vault has, and the
        connection banner says why. Core reconnect handles the rest, and
        when the channel list comes back it is read again (see `refrescarCanais`).
      */
      if (ligacaoFalhou) anotarLigacaoFalhada(ligacaoFalhou)
      void refreshChannels()
        .then(seedStored)
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [refreshChannels, seedStored, pushToast, anotarLigacaoFalhada],
  )

  /**
   * Try to connect now, without waiting for core backoff (up to 32 s).
   *
   * `session.connect` does this: in the core, the newest call wins, and
   * the socket mid-connection is dropped without scheduling another retry. Connected, do not call: it would close a working socket. Mid-connection either, for the
   * same reason: it would drop the attempt that might be almost open.
   *
   * `aviso` only on click. When the network returns or the tab returns, a failure shows in the
   * banner, which is already there; an extra error each time you come back to the
   * tab was noise.
   */
  /**
   * Synchronous lock: `connectionRef` only changes on the next render, and `online`
   * plus `visibilitychange` at the same instant (or a double click) would call
   * `connect()` twice. The second would drop the first socket mid-connection.
   */
  const aLigarAgora = useRef(false)
  const ligarAgora = useCallback(
    (aviso: boolean) => {
      const agora = connectionRef.current
      if (agora === "online" || agora === "connecting" || aLigarAgora.current) return
      aLigarAgora.current = true
      void bridge.session
        .connect()
        .catch((error: Error) => {
          if (aviso) pushToast(traduzirErro(error), "error")
        })
        .finally(() => {
          aLigarAgora.current = false
        })
    },
    [bridge, pushToast],
  )

  /*
    The network came back, or the person came back to the tab: try right now.

    These are the two moments when the connection is most likely to open, and
    when the person is looking. Waiting for the next backoff step would
    leave them seeing "No connection" for half a minute with the network up.
  */
  /*
    When connected, "try now" is not enough: on the phone the socket is often
    left half open (1.3.6). The system suspends the page, the network changes
    underneath, and the socket stays `OPEN` without ever firing `close`.

    When connected, the return goes to the session (`retomar`), which decides at
    once, without waiting for any `ping`: with no frame during a long absence on
    a device that suspends the page, it connects again right away, and the new
    connection recovers every channel from its cursor; with frames, it does
    nothing; otherwise, it checks in the background. With no connection, it
    connects, as before.

    `suspende`: a touch screen, or a page the browser froze (`freeze`). The
    computer does not suspend a hidden tab, and reconnecting there on every
    return was what 1.3.6 did to reconnections.
  */
  const escondidaEm = useRef<number | null>(null)
  const congelada = useRef(false)
  const verificarOuLigar = useCallback(() => {
    const desde = escondidaEm.current
    escondidaEm.current = null
    const suspende = congelada.current || window.matchMedia?.("(pointer: coarse)").matches === true
    congelada.current = false
    if (connectionRef.current === "online") {
      const sessao = bridge.session
      const escondidaMs = desde === null ? 0 : Date.now() - desde
      if (sessao?.retomar) void Promise.resolve(sessao.retomar({ escondidaMs, suspende })).catch(() => {})
      else void sessao?.verificarLigacao?.().catch(() => false)
      return
    }
    ligarAgora(false)
  }, [bridge, ligarAgora])

  useEffect(() => {
    if (stage !== "ready") return
    const aoVoltarARede = (): void => verificarOuLigar()
    const aoVerSe = (): void => {
      if (document.visibilityState === "visible") verificarOuLigar()
      else escondidaEm.current ??= Date.now()
    }
    // A page that comes back from the back/forward cache (Safari on the iPhone): the
    // socket left there is almost always a dead socket.
    const aoVoltarDaCache = (event: PageTransitionEvent): void => {
      if (event.persisted) verificarOuLigar()
    }
    const aoCongelar = (): void => {
      congelada.current = true
      escondidaEm.current ??= Date.now()
    }
    // Focus too: some phones unlock without `visibilitychange`.
    const aoFocar = (): void => {
      if (document.visibilityState === "visible") verificarOuLigar()
    }
    window.addEventListener("online", aoVoltarARede)
    document.addEventListener("visibilitychange", aoVerSe)
    window.addEventListener("pageshow", aoVoltarDaCache)
    document.addEventListener("freeze", aoCongelar)
    window.addEventListener("focus", aoFocar)
    return () => {
      window.removeEventListener("online", aoVoltarARede)
      document.removeEventListener("visibilitychange", aoVerSe)
      window.removeEventListener("pageshow", aoVoltarDaCache)
      document.removeEventListener("freeze", aoCongelar)
      window.removeEventListener("focus", aoFocar)
    }
  }, [stage, verificarOuLigar])

  /*
    The pulse: while the page is in view and connected, every
    `INTERVALO_DO_PULSO_MS`. Since 1.3.7 it does not tear down anything that
    delivers: it only asks after `SILENCIO_DO_PULSO_MS` without a frame, and only
    drops the socket if nothing arrives during the whole check deadline. Hidden,
    there is no pulse at all.
  */
  useEffect(() => {
    if (stage !== "ready" || connection !== "online") return
    let pulso: ReturnType<typeof setInterval> | undefined
    const armar = (): void => {
      if (pulso !== undefined || document.visibilityState !== "visible") return
      pulso = setInterval(() => {
        if (document.visibilityState !== "visible") return
        void bridge.session?.verificarLigacao?.({ silencioMinimoMs: SILENCIO_DO_PULSO_MS }).catch(() => false)
      }, INTERVALO_DO_PULSO_MS)
    }
    const desarmar = (): void => {
      if (pulso !== undefined) clearInterval(pulso)
      pulso = undefined
    }
    const aoMudarVisibilidade = (): void => {
      if (document.visibilityState === "visible") armar()
      else desarmar()
    }
    armar()
    document.addEventListener("visibilitychange", aoMudarVisibilidade)
    return () => {
      desarmar()
      document.removeEventListener("visibilitychange", aoMudarVisibilidade)
    }
  }, [stage, connection, bridge])

  const ligacaoDaFaixa = useMemo<LigacaoDaFaixa>(
    () => ({ ligarAgora: () => ligarAgora(true), caiuEm }),
    [ligarAgora, caiuEm],
  )

  /*
    And channels arriving after login: a reconnect that restores groups,
    an invite accepted on another device. Only the ones not yet seeded.
  */
  useEffect(() => {
    if (stage !== "ready" || channels.length === 0) return
    void seedStored(channels)
  }, [stage, channels, seedStored])

  /**
   * Where the archived conversation of each channel was left (17/11/2026): absent,
   * not started; a number, the next page; `null`, its end. See `conversaArquivada`.
   */
  const cursorDoArquivo = useRef(new Map<string, number | null>())
  /** Channels whose "load older" reached the start of what this device holds: the timeline says so. */
  const [inicioDoAparelho, setInicioDoAparelho] = useState<ReadonlySet<string>>(() => new Set())

  /*
    The archive grows while the app is open (17/11/2026): a long catch-up pushes
    past the vault cap what arrives, and the channel was seeded before that, with
    nothing older. Asked again every fifty server events of the open channel (the
    newest `seq`: the count in memory stops at its own cap), never after "load
    older" reached its start.
  */
  const lotesDoActivo = useMemo(
    () => (active ? Math.floor(messages.reduce((maior, message) => (message.channel === active && message.seq > maior ? message.seq : maior), 0) / 50) : 0),
    [active, messages],
  )
  useEffect(() => {
    if (!active || cursorDoArquivo.current.get(active) === null || olderAvailable.get(active) === true) return
    const canal = active
    void bridge.channels
      .temConversaArquivada?.(canal)
      .then((tem) => {
        if (tem && cursorDoArquivo.current.get(canal) !== null) setOlderAvailable((current) => new Map(current).set(canal, true))
      })
      .catch(() => {})
    // The members' past (history-last-100): a channel joined in this session has none in the vault.
    if (!inicioDoAparelho.has(canal)) {
      void bridge.channels
        .hasOlderFromMembers?.(canal)
        .then((tem) => {
          if (tem) setOlderAvailable((current) => new Map(current).set(canal, true))
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `olderAvailable` is read, not a trigger
  }, [active, lotesDoActivo, bridge])

  /**
   * Page older stored messages into state, newest missing slice first: the
   * vault, then the conversation archived past it, page by page. Never a silent
   * stop: the end says it is the end, and a page that does not open says so.
   *
   * A page is up to `HISTORY_PAGE` LINES of the open conversation (`daConversa`), not
   * entries: see `paginaDoCofre`. The archive is read page by page until one brings a
   * line of it, or it ends (`PAGINAS_DO_ARQUIVO_POR_TOQUE` at most per click). What
   * comes in raises the channel's memory bound (`carregadasAMao`), so it stays.
   */
  const loadOlder = useCallback(
    (channel: string, daConversa: (message: ChatMessage) => boolean, room: string) => {
      const known = (): Set<string> => new Set(messagesRef.current.filter((message) => message.channel === channel).map(keyOf))
      const acrescentar = (page: ChatMessage[]): void => {
        if (page.length === 0) return
        carregadasAMao.current.set(channel, (carregadasAMao.current.get(channel) ?? 0) + contaNoTecto(page))
        setMessages((current) => {
          const vistas = new Set(current.filter((message) => message.channel === channel).map(keyOf))
          return [...page.filter((message) => !vistas.has(keyOf(message))), ...current]
        })
      }
      const fimDoAparelho = (): void => {
        setOlderAvailable((current) => new Map(current).set(channel, false))
        setInicioDoAparelho((actual) => new Set(actual).add(channel))
      }
      /*
        Past what this device holds, the next lines come from a member online
        (history-last-100): the server's copy of what came before this device's place
        never opens here (MLS spent those keys). They arrive as live messages, so the
        channel's memory bound makes room for them first (`carregadasAMao`).
      */
      const fimDoCofre = async (): Promise<void> => {
        const pedir = bridge.channels.loadOlderFromMembers
        if (!pedir) return fimDoAparelho()
        carregadasAMao.current.set(channel, (carregadasAMao.current.get(channel) ?? 0) + HISTORY_PAGE)
        const { outcome } = await pedir(channel, room)
        if (outcome === "end") return fimDoAparelho()
        // The button stays: the next tap asks again.
        setOlderAvailable((current) => new Map(current).set(channel, true))
        if (outcome === "no-member") pushToast(traduzirErro(new Error("no member online has the older messages")), "error")
        else if (outcome === "offline") pushToast(traduzirErro(new Error("no connection to the server")), "error")
      }
      const doArquivo = async (): Promise<void> => {
        const ler = bridge.channels.conversaArquivada
        for (let pagina = 0; pagina < PAGINAS_DO_ARQUIVO_POR_TOQUE; pagina++) {
          const cursor = cursorDoArquivo.current.get(channel)
          if (!ler || cursor === null) return fimDoCofre()
          let novas: ChatMessage[]
          try {
            const { entradas, seguinte, falhou } = await ler(channel, cursor)
            cursorDoArquivo.current.set(channel, seguinte)
            // A page that does not open: say it; the cursor already goes past it.
            if (falhou) pushToast(traduzirErro(new Error("conversation archive page is missing")), "error")
            const vistas = known()
            novas = entradas.map((entry) => toChatMessage(channel, entry)).filter((message) => !vistas.has(keyOf(message)))
          } catch (error) {
            // A page that does not open: say it, and the next tap goes past it.
            if (typeof cursor === "number") cursorDoArquivo.current.set(channel, cursor > 0 ? cursor - 1 : null)
            pushToast(traduzirErro(error as Error), "error")
            return
          }
          acrescentar(novas)
          const seguinte = cursorDoArquivo.current.get(channel)
          // The archive ended: what it brought is this tap, and the next one asks the members.
          if (seguinte === null) {
            if (!novas.some(daConversa)) return fimDoCofre()
            const membros = await bridge.channels.hasOlderFromMembers?.(channel).catch(() => false)
            if (membros !== true) return fimDoAparelho()
            setOlderAvailable((current) => new Map(current).set(channel, true))
            return
          }
          if (novas.some(daConversa)) {
            setOlderAvailable((current) => new Map(current).set(channel, true))
            return
          }
        }
        // Pages without a line of this conversation: the next tap goes on from here.
        setOlderAvailable((current) => new Map(current).set(channel, true))
      }
      void bridge.channels
        .history(channel)
        .then((entries) => {
          const vistas = known()
          const missing = entries
            .map((entry) => toChatMessage(channel, entry))
            .filter((message) => !vistas.has(keyOf(message)))
          const { pagina, linhas, esgotou } = paginaDoCofre(missing, daConversa)
          acrescentar(pagina)
          // No line of this conversation is left in the vault: the archive brings the next ones.
          if (linhas === 0) return doArquivo()
          if (!esgotou) {
            setOlderAvailable((current) => new Map(current).set(channel, true))
            return
          }
          // The vault is exhausted with this page: the archive, then the members, decide what comes next.
          return Promise.all([
            bridge.channels.temConversaArquivada?.(channel).catch(() => false),
            bridge.channels.hasOlderFromMembers?.(channel).catch(() => false),
          ]).then(([tem, membros]) => {
            const doArquivo = tem === true && cursorDoArquivo.current.get(channel) !== null
            setOlderAvailable((current) => new Map(current).set(channel, doArquivo || membros === true))
            if (!doArquivo && membros !== true) setInicioDoAparelho((actual) => new Set(actual).add(channel))
          })
        })
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [pushToast],
  )

  /**
   * The room this account chose in the open channel, as it chose it.
   *
   * Not yet where it will read: a room that stopped being visible cannot
   * stay open, and who decides that is `activeRoom`, below, after
   * `useRooms` says what is visible.
   */
  const salaEscolhida = active ? (activeRooms[active] ?? "") : ""

  /**
   * Who is looking at the sidebar, at the restricted categories.
   *
   * Only serves category visibility, which is organization: someone without the role
   * does not see those lines, but has the room keys like all channel members. See `categoriaVisivel`.
   *
   * `administra` always sees, and it is not courtesy, without it, restricting a category
   * to a role you do not have would hide it from whoever hid it, and the only way to
   * undo it was the disappeared category.
   *
   * Use `messages` as the reread trigger, not `papeisVersao` (which is born lower
   * in this file): roles come from the vault, the vault writes in batches, and
   * a new assignment is a message. The possible delay is an instant and
   * the symptom is a category that appears a bit later, for organization, that is fair.
   */
  const quemVe = useMemo(
    () =>
      active && address
        ? { papeis: bridge.channels.rolesFor?.(active, address) ?? [], administra: bridge.channels.mayEdit?.(active) ?? false }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `messages` is the trigger for re-reading the vault
    [active, address, bridge, messages],
  )

  /**
   * Does ANY channel have rooms to show in the drawer?
   *
   * Only matters on mobile, and it is the question asked the instant you tap
   * a channel: the tree draws below the open channel, and this tap is what opens it, so `roomGroups` is still from the previous channel. The answer comes
   * from the vault, which is synchronous and already knows all it needs. See
   * `canalTemArvore`, and the tap itself, below, in `onSelectChannel`.
   *
   * `quemVe` is for this channel, not the open one: roles are per channel, and a
   * restricted category in another channel says nothing about this one.
   */
  const canalComArvore = (channel: string): boolean =>
    canalTemArvore(
      bridge.channels.rooms?.(channel) ?? [],
      // Without the tombstones, which the bridge adds to the live ones (see `categories` in the bridge).
      (bridge.channels.categories?.(channel) ?? []).filter((categoria) => categoria.removed !== true),
      address
        ? {
            papeis: bridge.channels.rolesFor?.(channel, address) ?? [],
            administra: bridge.channels.mayEdit?.(channel) ?? false,
          }
        : undefined,
    )

  /**
   * Tap this channel on mobile, does it close the drawer?
   *
   * Only when the vault already knows the channel rooms and they do not make a tree: the
   * channel already said everything it had, which is the conversation.
   *
   * A channel the vault knows NO rooms for (not open, not closed, not
   * category) is not a channel without rooms: it is a channel whose rooms are still
   * on the way. Every channel is born with rooms (`Session.SALAS_INICIAIS`), and whoever
   * just joined only gets them when someone passes them along.
   * Symptom: rooms appeared on the phone but were not visible, and the
   * column disappeared. Someone entered and tapped the common room, the drawer closed, and the
   * rooms arrived an instant later, already off screen.
   *
   * Direct conversations and bulletin boards have no rooms: always close.
   */
  const gavetaSaiAoTocar = (channel: string): boolean => {
    if (isDirect(channel) || isFeed(channel)) return true
    const salasPorSaber =
      (bridge.channels.rooms?.(channel) ?? []).length === 0 &&
      (bridge.channels.closedRooms?.(channel) ?? []).length === 0 &&
      (bridge.channels.categories?.(channel) ?? []).filter((categoria) => categoria.removed !== true).length === 0
    return !salasPorSaber && !canalComArvore(channel)
  }

  /**
   * The rooms in the open channel: the visible ones, the closed ones, and the grouped ones.
   *
   * Declared up here, not next to the rest of the sidebar, because
   * `visible` right below needs to know what rooms exist to decide
   * where a message is read.
   */
  const salasEmBruto = useRooms(bridge, active, messages, quemVe)
  // The same lists while nothing changed in them (1.3.15): each message rebuilt them, and the memoized sidebar rendered.
  const salasDoCanal = useMesmoValor(salasEmBruto.rooms)
  const roomGroups = useMesmoValor(salasEmBruto.groups)
  const roomsFechadas = useMesmoValor(salasEmBruto.closed)
  const categoriasDeclaradas = useMesmoValor(salasEmBruto.categories)
  const refreshRooms = salasEmBruto.refresh
  // The cap on rooms this account creates (1.3.26): read again when the open channel or its number of rooms changes.
  const { quota: roomQuota, canCreate: canCreateRoom } = useRoomQuota(
    bridge.session.roomQuota,
    connection,
    `${active ?? ""}|${salasDoCanal.length}`,
  )

  /**
   * The deleted rooms of the open channel: their polls are gone for everyone
   * (17/11/2026, `semVotacoesDeSalasApagadas`). Read again when the room lists
   * change, which is what a deletion changes.
   */
  const salasApagadas = useMemo(
    () => new Set(active ? (bridge.channels.removedRooms?.(active) ?? []) : []),
    [active, bridge, salasDoCanal, roomsFechadas],
  )

  /**
   * The open room, or the default one, if the chosen one stopped being visible.
   *
   * **Without this, hiding a category did not close anything for someone already in it.**
   * The room left the list and the conversation stayed open on screen, with the
   * write box working: hidden for those not there, unchanged for those there. The requirement is visible rooms AND usable ones, and the second half
   * is decided here.
   *
   * The default room is the destination because it is the only one that never hides. As
   * always, this is organization: whoever has the keys still has them, and a
   * stale client stays where it was.
   */
  const activeRoom = useMemo(() => {
    if (salaEscolhida === "") return ""
    const visiveis = roomGroups.flatMap((grupo) => grupo.rooms)
    return visiveis.some((sala) => sala.room === salaEscolhida) ? salaEscolhida : ""
  }, [salaEscolhida, roomGroups])

  // "View stage only" applies to the stage that was in front: switching conversations
  // or rooms, or ending the call, closes it.
  useEffect(() => {
    setSoPalco(false)
  }, [callChannel, active, activeRoom, view])

  /**
   * What is pinned in the open room.
   *
   * Up here and not inside the conversation screen, for the same reason as
   * `useRooms`: it needs ALL messages, and what reaches the conversation screen
   * is the list already filtered by `visible`, only what was said. A pin travels
   * in a `channel.meta`, which that list discards. Measured, and the symptom was the
   * worst possible: pinning worked, and the screen did not move.
   */
  const { pins: fixadasDaSala } = usePins(bridge, active, activeRoom, messages)

  /**
   * The search in the open conversation.
   *
   * Up here and not inside the conversation screen, for the same reason as
   * `usePins`: it needs ALL messages in the channel, and what reaches the
   * conversation screen comes filtered to the open room. And jumping to a result means changing
   * rooms and fetching more history from the vault, two moves only this
   * shell can make.
   */
  const [procuraAberta, setProcuraAberta] = useState(false)
  /** The message you just jumped to. It lights up and goes out by itself. */
  const [destacada, setDestacada] = useState<string | null>(null)
  const procura = useProcura(
    bridge,
    active,
    procuraAberta,
    messages,
    (erro) => pushToast(translateError(erro), "error"),
    salasApagadas,
  )

  /**
   * The open room, as it was published: this is where the layout comes from.
   */
  const salaAberta = useMemo(
    () => salasDoCanal.find((sala) => sala.room === activeRoom),
    [salasDoCanal, activeRoom],
  )

  /**
   * The ticket open inside a ticket room.
   *
   * Saved by channel and room, like the chosen room: leaving for another channel and
   * coming back puts you back at the ticket you were reading, not the board. Switching
   * rooms does not keep it open, and that is what you want, a ticket belongs to one
   * room, and reading it in another means nothing.
   */
  const [ticketsAbertos, setTicketsAbertos] = useState<Record<string, string | null>>({})
  const chaveDoTicket = `${active ?? ""}|${activeRoom}`
  const ticketAberto = ticketsAbertos[chaveDoTicket] ?? null

  const { tickets, linhas: linhasDoTicket } = useTickets(
    bridge,
    active,
    activeRoom,
    salaAberta?.layout,
    messages,
    ticketAberto,
  )

  /**
   * The messages in the open channel, in the open room.
   *
   * A message without a room belongs to the default room, that is what all
   * messages written before rooms existed look like, and that is what keeps the
   * conversation that already existed stay where it always was.
   */
  /**
   * The room where a message IS READ, from the tag it carries.
   *
   * A message without a tag belongs to the default room, and a message
   * tagged with a room that no longer exists ends up in the same place. It is written
   * in full inside `visible`, which is where the rule came from; it lives out here
   * because search needs exactly the same answer to say where
   * a result came from, and two copies of this rule would drift the day a
   * room is deleted, which is precisely when no one is watching.
   */
  const salasExistentes = useMemo(
    () => new Set([...salasDoCanal, ...roomsFechadas].map((sala) => sala.room)),
    [salasDoCanal, roomsFechadas],
  )
  const salaDeLeitura = useCallback(
    (etiqueta: string): string => (etiqueta && salasExistentes.has(etiqueta) ? etiqueta : ""),
    [salasExistentes],
  )

  const visible = useMemo(() => {
    /**
     * The rooms that exist now, open and closed, both exist.
     *
     * Serves the rule below: a message tagged with a room that is no longer
     * anywhere is read in the default room. This is what answers the
     * question "what happens to messages in a deleted room", and answers it
     * without touching anything: the messages stay where they always were, encrypted in
     * the vault, with the tag they always had. What changed was the world around them, there is no longer a room with that name, and reading
     * adapts. No stored byte is rewritten, and all devices
     * reach the same conclusion on their own, because they start from the same fact.
     *
     * The alternative was to leave them orphaned and invisible: history that exists,
     * takes space in the vault forever and cannot be found by anything. Garbage that
     * no one can ever manage again is worse than a conversation out of context.
     */
    const daSala = semVotacoesDeSalasApagadas(messages, salasApagadas).filter((message) => {
      if (message.channel !== active) return false
      /**
       * Only what was SAID.
       *
       * A friend request used to be here, as a conversation line, so you could
       * answer at the spot where it arrived. You still answer in the
       * conversation and the intent did not change, the place did: it became a card
       * standing above it, not a line inside it. As a line, just two sentences swapped would push it
       * off screen, and the buttons went with it. See `pedidoDeAmizade`.
       */
      if (message.payload.t !== "message") return false
      // A message without a room belongs to the default room, that is what all
      // messages written before rooms existed look like. A message from
      // a deleted room ends up in the same place, for the same logic. The rule
      // lives in `salaDeLeitura`, because search needs the same answer.
      return salaDeLeitura((message.payload as { room?: string }).room ?? "") === activeRoom
    })

    /*
      Edits by the author, applied before this reaches the screen.

      Outside the filter, not inside: a `redact` does not belong to any room, it has no
      `room` tag, and would have been thrown out by the rule above before it
      could delete anything. `comEmendas` receives EVERYTHING that came
      in this channel and returns only messages that survive.
    */
    const emendas = messages.filter(
      (message) => message.channel === active && (message.payload.t === "edit" || message.payload.t === "redact"),
    )
    /*
      The tombstone of a moderator (phase 3) also counts, over another person's
      message: the line stays, with no content. The moderator asks the bridge for the
      sender of the tombstone, with the roles this device knows now.
    */
    const canal = active
    const ditas = comEmendas([...daSala, ...emendas], {
      modera: (quem) => (canal ? (bridge.channels.mayModerate?.(canal, quem) ?? false) : false),
    })
    return [...ditas].sort((a, b) => stampOf(a.payload) - stampOf(b.payload))
    // Roles change by messages (`role.assign`, `role.define`), which change
    // `messages`: that is the trigger for rereading who moderates.
  }, [messages, active, activeRoom, salaDeLeitura, salasApagadas, bridge])

  /**
   * Search results, with the room translated to where the message reads.
   *
   * `search` returns the label as the message carries it, because it does not
   * know which rooms exist. This wrapper knows, and that is why translation
   * happens here and not inside: without it, a result from a deleted room would
   * say "in Shipyard" to someone already in the default room looking at it, and
   * the jump would send them to a room that does not exist.
   */
  const procuraDaConversa = useMemo(
    () => ({
      ...procura,
      resultados: procura.resultados.map((achado) => ({ ...achado, room: salaDeLeitura(achado.room) })),
    }),
    [procura, salaDeLeitura],
  )

  /** The human-readable name of a room in this channel, including closed ones. */
  const nomeDaSalaDoCanal = useCallback(
    (room: string): string => nomeDaSala([...salasDoCanal, ...roomsFechadas], room) ?? NOME_POR_OMISSAO,
    [salasDoCanal, roomsFechadas],
  )

  /**
   * Load into memory everything the vault holds from this channel.
   *
   * The wrapper seeds the two hundred most recent and pages the rest on demand,
   * and a search result can be anywhere in the history. No new cap to invent
   * here: the vault already has one, four hundred per channel, and memory is
   * sized to handle it.
   */
  const trazerTudoDoCofre = useCallback(
    (channel: string): Promise<StoredChatMessage[]> =>
      bridge.channels.history(channel).then((entries) => {
        const known = new Set(messagesRef.current.filter((message) => message.channel === channel).map(keyOf))
        const missing = entries.map((entry) => toChatMessage(channel, entry)).filter((message) => !known.has(keyOf(message)))
        if (missing.length > 0) setMessages((current) => [...missing, ...current])
        setOlderAvailable((current) => new Map(current).set(channel, false))
        return entries
      }),
    [],
  )

  /**
   * Go to the message found.
   *
   * Three things, and the order between them is fixed. The sheet closes first:
   * it sits on top of the conversation, and jumping to a hidden line is not
   * jumping anywhere. The room changes next, because a result may have been
   * spoken in another room of the same channel, the vault history is for the
   * entire channel, and the conversation on screen is for one room. Loading
   * comes last, with no one waiting for it: `Timeline` retries the jump when the
   * list grows, so this does not need to block anything.
   */
  const saltarParaMensagem = useCallback(
    (achado: Achado): void => {
      if (!active) return
      setProcuraAberta(false)
      setActiveRooms((actual) => ({ ...actual, [active]: achado.room }))
      setDestacada(achado.id)
      void trazerTudoDoCofre(active).catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [active, trazerTudoDoCofre, pushToast],
  )

  /** The 5-day rule: the signed ages of the open channel's voters. See `useIdadesDosVotantes`. */
  const { idades, regraDaIdade } = useIdadesDosVotantes({
    ler: bridge.votacoes?.idadeDaConta,
    active,
    address,
    messages,
    connection,
  })
  const podeContarVoto = useMemo(
    () =>
      !bridge.votacoes?.idadeDaConta || regraDaIdade === false
        ? undefined
        : (quem: string, at: number): boolean => {
            const criadaEm = idades.get(quem)
            // A vote stamped in the future waits for its time: otherwise a new account
            // could date its vote 5 days ahead and count today.
            return criadaEm !== undefined && podeVotarPelaIdade(criadaEm, at) && at <= Date.now() + 60_000
          },
    [bridge, regraDaIdade, idades],
  )
  /** This account, younger than 5 days: the options are off, with the reason. */
  const semVoto = useMemo(() => {
    if (!podeContarVoto || !address || regraDaIdade !== true) return null
    const minha = idades.get(address)
    return minha === undefined || podeVotarPelaIdade(minha, Date.now()) ? null : strings.votacao.semVotoContaNova
  }, [podeContarVoto, address, regraDaIdade, idades])

  /**
   * Where "Polls" in the channel menu leads (the fixed sidebar row is gone, 17/11/2026).
   *
   * A polls room is a room like the others (`layout: "polls"`, see `SalaDeVotacoes`). The entry goes
   * straight to the community's polls room when there is one; with several it shows a list to choose
   * from, and with none it shows how to create one (or says there are none). This state is the
   * channel and the room that was open when the row was tapped: the list shows only while both
   * still match, so choosing another room or channel leaves it without anyone closing it.
   */
  const [escolhaDeVotacoes, setEscolhaDeVotacoes] = useState<{ channel: string; room: string } | null>(null)
  const escolhaNoEcra =
    view === "chat" && active !== null && escolhaDeVotacoes?.channel === active && escolhaDeVotacoes.room === salaEscolhida
  useEffect(() => {
    if (escolhaDeVotacoes && !escolhaNoEcra) setEscolhaDeVotacoes(null)
  }, [escolhaDeVotacoes, escolhaNoEcra])
  /** The polls rooms of the open channel this account sees (the sidebar's own filter). */
  const salasDeVotacoes = useMemo(
    () =>
      roomGroups
        .flatMap((grupo) => grupo.rooms)
        .filter((sala) => sala.kind === "text" && sala.layout === "polls")
        .map((sala) => ({ room: sala.room, name: sala.name })),
    [roomGroups],
  )
  useEffect(() => {
    if (!escolhaNoEcra || !active || salasDeVotacoes.length !== 1) return
    const unica = salasDeVotacoes[0]
    if (!unica) return
    setActiveRooms((actual) => ({ ...actual, [active]: unica.room }))
    setEscolhaDeVotacoes(null)
  }, [escolhaNoEcra, active, salasDeVotacoes])
  /**
   * The open polls room reads the vault and the archive, not only memory (diag-votacao, 18/11/2026).
   *
   * Memory holds the last `MEMORY_PER_CHANNEL` entries of the channel, every room and the
   * votes, reactions and edits together. A poll with more than that after it left memory on
   * the next start, and its polls room showed nothing: no card, no line, and no "load older".
   *
   * Read when the room opens and again every fifty server events (`lotesDoActivo`), never per
   * render. The vault is one read (`history`). The archive is read once per channel in this
   * session, page by page, and only its polls (and their edits) are kept. What arrives live is
   * in memory, and the two are merged by `keyOf`.
   */
  const salaDeVotacoesAberta = active !== null && salaAberta?.layout === "polls"
  const [votacoesGuardadas, setVotacoesGuardadas] = useState<{ channel: string; messages: ChatMessage[] } | null>(null)
  // The promise, not the result (I1 of the review): one archive read per channel, even while
  // the next batch of fifty events asks again.
  const votacoesArquivadas = useRef(new Map<string, Promise<ChatMessage[]>>())
  /** The polls the last vault read of each channel held, by author and id. See below. */
  const votacoesNoCofre = useRef(new Map<string, Set<string>>())
  useEffect(() => {
    if (!salaDeVotacoesAberta || active === null) return
    const canal = active
    let vivo = true
    const chaveDaVotacao = (message: ChatMessage): string | null =>
      message.payload.t === "message" && message.payload.id ? `${message.sender}|${message.payload.id}` : null
    const lerArquivo = (): Promise<ChatMessage[]> => {
      const leitura = votacoesDoArquivo(canal, bridge.channels.conversaArquivada)
      votacoesArquivadas.current.set(canal, leitura)
      // A read that fails is asked again on the next batch.
      leitura.catch(() => votacoesArquivadas.current.delete(canal))
      return leitura
    }
    void (async () => {
      let arquivadas = await (votacoesArquivadas.current.get(canal) ?? lerArquivo())
      const doCofre = soDasVotacoes((await bridge.channels.history(canal)).map((entry) => toChatMessage(canal, entry)))
      /*
        A poll that left the vault since the last read went to the archive (I2 of the
        diag-votacao review): a poll that closes is no longer held in the vault, and
        the next trim archives it. The archive was read once per session, so it was in
        neither read and left "Closed" until reload. Only then is the archive read again.
      */
      const agora = new Set(doCofre.flatMap((message) => chaveDaVotacao(message) ?? []))
      const antes = votacoesNoCofre.current.get(canal)
      votacoesNoCofre.current.set(canal, agora)
      if (antes && [...antes].some((chave) => !agora.has(chave))) {
        const noArquivo = new Set(arquivadas.flatMap((message) => chaveDaVotacao(message) ?? []))
        if ([...antes].some((chave) => !agora.has(chave) && !noArquivo.has(chave))) arquivadas = await lerArquivo()
      }
      if (vivo) setVotacoesGuardadas({ channel: canal, messages: [...arquivadas, ...doCofre] })
    })().catch(() => {
      // The vault read failed: the room shows what memory has, as before.
    })
    return () => {
      vivo = false
    }
  }, [salaDeVotacoesAberta, active, lotesDoActivo, bridge])
  /**
   * Memory and the stored polls, once each: memory wins, it is the newest copy. The key has
   * the type and the sender as well as the id, like the vault (`chaveDoEvento`): with `keyOf`
   * alone, another member's event with the poll's id took the poll's place (B1 of the review).
   */
  const mensagensDasVotacoes = useMemo(() => {
    if (!salaDeVotacoesAberta || !active || votacoesGuardadas?.channel !== active) return messages
    const chave = (message: ChatMessage): string => `${keyOf(message)}|${message.payload.t}|${message.sender}`
    const porChave = new Map<string, ChatMessage>()
    for (const message of votacoesGuardadas.messages) porChave.set(chave(message), message)
    for (const message of messages) if (message.channel === active) porChave.set(chave(message), message)
    return [...porChave.values()]
  }, [salaDeVotacoesAberta, active, votacoesGuardadas, messages])
  /** The polls of the open polls room, folded like the conversation (see `listarVotacoes`). */
  const votacoesDaSala = useMemo(
    () =>
      active && salaAberta?.layout === "polls"
        ? listarVotacoes({
            messages: semVotacoesDeSalasApagadas(mensagensDasVotacoes, salasApagadas),
            channel: active,
            eu: address,
            existentes: salasExistentes,
            salas: [{ room: activeRoom, name: salaAberta.name, fechada: false }],
            modera: (quem) => bridge.channels.mayModerate?.(active, quem) ?? false,
            ...(podeContarVoto ? { podeContar: podeContarVoto } : {}),
          })
        : [],
    [active, salaAberta, mensagensDasVotacoes, salasApagadas, address, salasExistentes, activeRoom, bridge, podeContarVoto],
  )
  /** What the open polls room keeps of polls that are not polls any more (see `rastosDeVotacoes`). */
  const rastosDaSala = useMemo(
    () =>
      active && salaAberta?.layout === "polls"
        ? rastosDeVotacoes({
            messages: semVotacoesDeSalasApagadas(mensagensDasVotacoes, salasApagadas),
            channel: active,
            existentes: salasExistentes,
            salas: [{ room: activeRoom, name: salaAberta.name, fechada: false }],
            modera: (quem) => bridge.channels.mayModerate?.(active, quem) ?? false,
          })
        : [],
    [active, salaAberta, mensagensDasVotacoes, salasApagadas, salasExistentes, activeRoom, bridge],
  )
  /** Open the polls of a channel: from the always-visible row in the sidebar and from the channel menu. */
  const abrirVotacoes = (channel: string): void => {
    abrirConversa(channel)
    setEscolhaDeVotacoes({ channel, room: activeRooms[channel] ?? "" })
    setSidebarOpen(false)
  }

  /**
   * The highlight fades on its own.
   *
   * It is a response to a gesture, not a state: once it has served to find the
   * line with your eyes, a permanently lit message means something else. A bit
   * longer than the animation lasts, so it finishes before the class goes away.
   */
  useEffect(() => {
    if (destacada === null) return
    const relogio = setTimeout(() => setDestacada(null), prefersReducedMotion() ? DESTAQUE_LENTO_MS : DESTAQUE_MS)
    return () => clearTimeout(relogio)
  }, [destacada])

  /**
   * Reply (4/11/2026): mid-reply, per channel and room.
   *
   * Up here, like drafts: switch rooms or channels and come back to find it
   * where it was left. Memory only, for the same reason as drafts: nothing being
   * written goes into the vault. See `lib/respostas.ts`.
   */
  const [respostas, setRespostas] = useState<Readonly<Record<string, RespostaPendente>>>({})
  const conversaAberta = `${active ?? ""}|${activeRoom}`
  const respostaAberta = active ? (respostas[conversaAberta] ?? null) : null
  const responderA = useCallback(
    (message: ChatMessage): void => {
      const id = message.payload.id
      if (!active || !id) return
      // "@Mention" on by default, like in Discord.
      setRespostas((antes) => ({ ...antes, [conversaAberta]: { id, autor: message.sender, mencionar: true } }))
    },
    [active, conversaAberta],
  )
  const cancelarResposta = useCallback((): void => {
    setRespostas((antes) => {
      if (!(conversaAberta in antes)) return antes
      const { [conversaAberta]: _fora, ...resto } = antes
      return resto
    })
  }, [conversaAberta])
  const alternarMencaoDaResposta = useCallback((): void => {
    setRespostas((antes) => {
      const actual = antes[conversaAberta]
      return actual ? { ...antes, [conversaAberta]: { ...actual, mencionar: !actual.mencionar } } : antes
    })
  }, [conversaAberta])

  /**
   * What is known of the originals in the open channel, for quote lines.
   *
   * About the entire channel, not just the room: a tombstone of an original has
   * no room, and that is how you know it was deleted. The same fold as the
   * conversation (`comEmendas`), with the same question of who moderates.
   */
  const indiceDasCitacoesDoCanal = useMemo(() => {
    const doCanal = messages.filter(
      (message) =>
        message.channel === active &&
        (message.payload.t === "message" || message.payload.t === "edit" || message.payload.t === "redact"),
    )
    const canal = active
    const ditas = comEmendas(doCanal, {
      modera: (quem) => (canal ? (bridge.channels.mayModerate?.(canal, quem) ?? false) : false),
    })
    return indiceDasCitacoes(doCanal, ditas)
  }, [messages, active, bridge])
  const haMaisAntigas = active !== null && olderAvailable.get(active) === true
  const citacaoDoCanal = useCallback(
    (id: string): Citacao => citacaoNoIndice(id, indiceDasCitacoesDoCanal, haMaisAntigas),
    [indiceDasCitacoesDoCanal, haMaisAntigas],
  )

  /**
   * Go to a pinned message of the open room, from the bar at the top or the sheet (fixadas-topo).
   *
   * In memory: light it up, and `Timeline` widens its window to it. Not in memory: read
   * everything the vault holds (a pinned message stays there, see `fixadasPresas` in the
   * core), then light it up. `false` when the vault does not have it either: someone who
   * joined later, or a message the cap moved to the archive before pins were held. The
   * screen then opens the sheet on the copy.
   *
   * The same release as `irParaOriginal`, so pressing the same pin again lights it again.
   */
  const abrirFixada = useCallback(
    async (id: string): Promise<boolean> => {
      if (!active) return false
      const canal = active
      const ehEsta = (payload: { t?: unknown; id?: unknown }): boolean => payload.t === "message" && payload.id === id
      const acender = (): void => {
        if (destacada === id) {
          setDestacada(null)
          setTimeout(() => setDestacada(id), 0)
        } else {
          setDestacada(id)
        }
      }
      if (messagesRef.current.some((message) => message.channel === canal && ehEsta(message.payload))) {
        acender()
        return true
      }
      const entradas = await trazerTudoDoCofre(canal)
      if (!entradas.some((entrada) => ehEsta(entrada.payload as { t?: unknown; id?: unknown }))) return false
      acender()
      return true
    },
    [active, trazerTudoDoCofre, destacada],
  )

  /**
   * Go to the original of a reply, by the quote.
   *
   * The same jump as search: the original's room, and the highlight. If the
   * original is not in memory, everything the vault holds comes in; `Timeline`
   * retries the jump when the list grows. If the vault does not have it either,
   * the quote says "The original message is not on this device.".
   *
   * Tap the same quote again lights it up: the highlight releases first,
   * otherwise the state would not change and nothing would run again.
   */
  const irParaOriginal = useCallback(
    (id: string): void => {
      if (!active) return
      const original = indiceDasCitacoesDoCanal.ditas.get(id)
      if (original) {
        setActiveRooms((actual) => ({ ...actual, [active]: salaDeLeitura((original.payload as { room?: string }).room ?? "") }))
      } else {
        void trazerTudoDoCofre(active).catch((error: Error) => pushToast(traduzirErro(error), "error"))
      }
      if (destacada === id) {
        setDestacada(null)
        setTimeout(() => setDestacada(id), 0)
      } else {
        setDestacada(id)
      }
    },
    [active, indiceDasCitacoesDoCanal, salaDeLeitura, trazerTudoDoCofre, pushToast, destacada],
  )

  /**
   * The tally of votes in the open channel, by the id of the message that
   * carries them.
   *
   * Up here and not in `Timeline`, because a vote is a CHANNEL event and
   * `Timeline` only receives ROOM messages: a `post.reaction` has no room label
   *, like a `redact` does not, and would have been thrown out by the filter
   * before it could count for anything. The same reason amendments are gathered
   * outside the filter.
   *
   * One fold for the entire channel, not one per vote: `votosDe` walks the list
   * once.
   */
  const apuramentosDoCanal = useMemo(() => {
    if (!active) return new Map<string, Apuramento>()
    const doCanal = messages.filter((message) => message.channel === active)
    const fechos = fechosDe(doCanal, (quem) => bridge.channels.mayModerate?.(active, quem) ?? false)
    const escolhas = votosDe(doCanal, fechos, podeContarVoto)
    const porVotacao = new Map<string, Apuramento>()
    for (const message of doCanal) {
      const votacao = votacaoDe(message.payload)
      const id = message.payload.id
      if (!votacao || !id) continue
      porVotacao.set(id, apurar(escolhas.get(id), votacao.options.length, address, fechos.get(id) ?? null))
    }
    return porVotacao
  }, [messages, active, address, bridge, podeContarVoto])

  /**
   * The state of all friendships, folded by the CORE and read from the bridge.
   *
   * One source of truth, and the Friends screen and the bell drink from it. There is no
   * list being maintained nor cleanup being scheduled: a request stays open
   * as long as it has no answer, and the answer can come from either of the
   * two places, or from the other side, or from a cross request that resolved
   * itself, in all cases it leaves both surfaces at the same time,
   * because there never were two states.
   *
   * Until phase 1d the interface folded `messages` on its own, and that was
   * a second fold next to the core's: in a cross request it showed "pending" next to "accepted".
   * See `useLacosDeAmizade`.
   */
  const friendships = useLacosDeAmizade(bridge, stage === "ready")
  /**
   * The friendship gestures, one function for each gate: the person's
   * menu, the profile page, the conversation card, Pending, and the bell. Each
   * one resolves the channel inside. See `useAmizade`.
   */
  const amizade = useAmizade({
    bridge,
    friendships,
    aviso: pushToast,
    nomeDe: (who) => notifyRef.current.nameFor(who),
    estaLigado: (who) => online.has(who),
    pronto: stage === "ready",
  })
  /**
   * The blocked people on this device, as a set. The Friends list hides them, and
   * in a shared room they fold, ring nothing and count nothing (`lib/bloqueados.ts`).
   * Up here, before the counts and the reaction chips that read it.
   */
  const conjuntoDeBloqueados = useMemo(
    () => new Set(amizade.bloqueados.map((entrada) => entrada.address)),
    [amizade.bloqueados],
  )
  bloqueadosRef.current = conjuntoDeBloqueados
  /**
   * Fold in the timeline: a message from someone I blocked, in a room. Not in a
   * direct: there the core already keeps them out, and the history from before the
   * block stays as it was.
   */
  const ocultarBloqueada = useCallback(
    (message: ChatMessage) => !isDirect(message.channel) && deQuemBloqueei(message, address, conjuntoDeBloqueados),
    [address, conjuntoDeBloqueados],
  )

  /**
   * The reaction chips of the open channel, by the id of the message.
   *
   * Up here for the reason votes are: a `reaction` has no room label. Our own
   * sends still without echo (`seq` -1) go last, in the order they left: they are
   * the newest acts of this device, and a reread of the vault can put entries with
   * a real `seq` after them in the list.
   *
   * Each message keeps the SAME array while its chips do not change, so the
   * memoized lines with reactions do not redraw on every arriving message.
   */
  const reaccoesAnteriores = useRef(new Map<string, FichaDeReaccao[]>())
  /*
    The reactions the vault holds for the open channel, read when it opens (B6, 1.3.25).
    Memory holds the newest 200 entries of a channel, and the chips of a line came only
    from there. Memory still brings what arrives after the read (live, our own sends).
  */
  const [reaccoesDoCofre, setReaccoesDoCofre] = useState<{ channel: string; messages: ChatMessage[] } | null>(null)
  useEffect(() => {
    const ler = bridge.channels.reaccoesGuardadas
    if (!active || !ler) return
    let vivo = true
    ler(active)
      .then((entradas) => {
        if (vivo) setReaccoesDoCofre({ channel: active, messages: entradas.map((entrada) => toChatMessage(active, entrada)) })
      })
      .catch(() => {
        // The vault read failed: the chips come from memory, as before.
      })
    return () => {
      vivo = false
    }
  }, [active, bridge])
  const reaccoesDoCanal = useMemo(() => {
    if (!active) return new Map<string, FichaDeReaccao[]>()
    const guardadas = reaccoesDoCofre?.channel === active ? reaccoesDoCofre.messages : []
    // The reactions of someone I blocked do not count in the chips (`lib/bloqueados.ts`).
    const todas = reaccoesComAsDoCofre(guardadas, reaccoesParaDobrar(messages, active))
    const novas = dobrarReaccoes(semBloqueados(todas, address, conjuntoDeBloqueados), address)
    const antes = reaccoesAnteriores.current
    for (const [alvo, fichas] of novas) {
      const velhas = antes.get(alvo)
      if (velhas && JSON.stringify(velhas) === JSON.stringify(fichas)) novas.set(alvo, velhas)
    }
    reaccoesAnteriores.current = novas
    return novas
  }, [messages, active, address, reaccoesDoCofre, conjuntoDeBloqueados])

  /** Press or release an emoji on a message: the opposite of what this account has now. */
  const reagirNaConversa = useCallback(
    (message: ChatMessage, emoji: string): void => {
      const alvo = message.payload.id
      const reagir = bridge.channels.react
      if (!alvo || !reagir) return
      const minha = reaccoesDoCanal.get(alvo)?.find((ficha) => ficha.emoji === emoji)?.minha === true
      void reagir(message.channel, alvo, emoji, minha).catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [bridge, reaccoesDoCanal, pushToast],
  )

  /** The channel where a vote is being created, or nothing. */
  const [votacaoNoCanal, setVotacaoNoCanal] = useState<string | null>(null)

  /**
   * Create a vote in the conversation: a message, with the vote inside.
   *
   * The body is the vote written out in full, and it is the piece that saves it
   * on a client that does not know how to render it, without it, that person
   * sees an empty message. See `corpoDaVotacao` and `Poll` in the protocol.
   *
   * Goes through the outbox like any message: if sending fails, the red bubble
   * stays with the text and the retry button, instead of the vote vanishing
   * without a trace.
   */
  const criarVotacao = useCallback(
    async (canal: string, votacao: Votacao): Promise<void> => {
      /*
        Asked again here, not only when the option is drawn (1.3.21): a role can
        leave this account while the sheet is open. The core refuses anyway; asking
        first keeps the outbox from holding a red bubble it can never send.
      */
      if (!(bridge.channels.mayCreatePoll?.(canal) ?? true)) {
        pushToast(translateError("you may not create polls in this channel"), "error")
        setVotacaoNoCanal(null)
        return
      }
      sendMessage(canal, corpoDaVotacao(votacao), activeRoom || undefined, { poll: votacao })
      setVotacaoNoCanal(null)
    },
    [sendMessage, activeRoom, bridge, pushToast],
  )

  /**
   * Whether this account may create polls in the open channel (`votacoes`, 1.3.21).
   * Without it, no entry to create one is drawn: not in the message box, not on the
   * polls page. Absent from the host means "yes", as before.
   *
   * Only in the open app, like `editaOCanal`: this runs on every render, and with the
   * vault locked or going away (a removed device) the session has no identity to ask.
   */
  const podeCriarVotacoes = stage === "ready" && active !== null && (bridge.channels.mayCreatePoll?.(active) ?? true)

  /**
   * Vote on a vote in the conversation.
   *
   * Tapping an already chosen option removes the vote, like tapping a thumbs up
   * that is already pressed. The channel is the message's channel and never the
   * open channel: they are the same today, and writing what is true instead of
   * what happens to work is what keeps this from breaking the day they stop
   * being.
   */
  const votarNaConversa = useCallback(
    (message: ChatMessage, opcao: number): void => {
      const alvo = message.payload.id
      const votacoes = bridge.votacoes
      if (!alvo || !votacoes) return
      const minha = apuramentosDoCanal.get(alvo)?.minha ?? null
      void votacoes.votar(message.channel, alvo, opcao, minha === opcao).catch(() => {
        pushToast(strings.votacao.votoFalhou, "error")
      })
    },
    [bridge, apuramentosDoCanal],
  )

  /** Who the screen shows besides the author, for the collision of address words. */
  const vizinhosDoEcra = useMemo(
    () => [...members, ...participants.map((participante) => participante.address)],
    [members, participants],
  )
  const { directory, nameFor: directoryNameFor } = useDirectory(
    messages,
    directorySeed,
    { address, profile },
    vizinhosDoEcra,
  )

  /** Your own rows show your name as others see it — "Tu" only while no
   * profile exists yet, because a blank row would be worse. */
  const nameFor = useCallback(
    (sender: string): string =>
      sender === address && profile.displayName ? profile.displayName : directoryNameFor(sender),
    [address, profile.displayName, directoryNameFor],
  )
  notifyRef.current = { me: address, nameFor }

  /**
   * Delete a poll (1.3.21): the message tombstone, with the confirmation messages use.
   * The author, or whoever moderates. The core removes its votes from the vault.
   */
  const eliminarVotacao = useCallback(
    (canal: string, message: ChatMessage): void => {
      const alvo = message.payload.id
      if (!alvo || !bridge.channels.deleteMessage) return
      const deOutraPessoa = message.sender !== address
      void confirmar({
        titulo: deOutraPessoa ? strings.votacao.eliminarDeQuem(nameFor(message.sender)) : strings.votacao.eliminarTitulo,
        corpo: strings.votacao.eliminarConfirmar,
        verbo: strings.votacao.eliminar,
        destructive: true,
      })
        .then(async (sim) => {
          if (sim) await bridge.channels.deleteMessage?.(canal, alvo)
        })
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [bridge, address, confirmar, pushToast, nameFor],
  )

  soundRef.current = { active, room: activeRoom, callChannel, callRoom, ringing, participants, mediaPronta: localStream !== null }

  // Entering a ringing call is answering it: it can no longer stay lost.
  useEffect(() => {
    if (callChannel !== null) vigiaDasChamadas.current.atendida(callChannel)
  }, [callChannel])

  // The sound engine asks which channel is open at the instant of the event:
  // it is the rule "never for what is already in front".
  useEffect(() => motor.ligarAmbiente({ canalAberto: () => soundRef.current.active, salaAberta: () => soundRef.current.room }), [])

  /*
    The incoming ring stops when you answer (enter that call) and when the call
    ends before that (the caller gave up). After 30 seconds it stops on its own,
    in the engine.
  */
  useEffect(() => {
    const aviso = avisoDoToque.current
    if (aviso && incomingRingStops(aviso.canal, callChannel, ringing.get(aviso.canal)?.keys() ?? [], address)) {
      avisoDoToque.current = null
      dispensarToast(aviso.texto)
    }
    const aTocar = motor.chamadaATocar()
    if (aTocar === null) return
    // Answering on another device of the account is answering too (21/11/2026).
    if (incomingRingStops(aTocar, callChannel, ringing.get(aTocar)?.keys() ?? [], address)) motor.pararChamada(aTocar)
  }, [callChannel, ringing, address, dispensarToast])
  useEffect(() => () => motor.pararChamada(), [])

  /*
    The outgoing ring stops when someone answers (appears in the call) and when
    I am no longer in it (I gave up, or it dropped). After 30 seconds it stops
    on its own, in the engine.
    */
  useEffect(() => {
    const aChamar = motor.aChamar()
    if (aChamar === null) return
    const haOutra = haOutraPessoa({
      eu: address ?? "",
      naChamada: ringing.get(aChamar)?.keys() ?? [],
      pares: callChannel === aChamar ? participants : [],
    })
    if (paraDeChamar(aChamar, callChannel, haOutra)) motor.pararDeChamar(aChamar)
  }, [callChannel, ringing, participants, address])
  useEffect(() => () => motor.pararDeChamar(), [])

  /**
   * Open a room in the open channel.
   *
   * Tapping a voice room enters the call, as everyone expects from a voice room;
   * tapping a text room just opens it. This is here, not in the sidebar, because
   * right-click menu on the room does exactly the same and the two doors cannot
   * differ.
   *
   * The call is for the ROOM: entering another voice room in the same channel
   * switches calls, which is what you expect from two rooms.
   */
  const abrirSala = (room: string): void => {
    if (!active) return
    const sala = roomGroups.flatMap((grupo) => grupo.rooms).find((candidata) => candidata.room === room)
    setActiveRooms((actual) => ({ ...actual, [active]: room }))
    setEscolhaDeVotacoes(null)
    /*
      Choosing a room ends the journey, and the drawer slides out.
      
      On mobile it sits ON TOP of the conversation, opaque and 280px wide: without
      this the room would open behind it, and the next gesture was finding out on
      your own that you forgot to close a panel that had already done its job. On
      wide screen the drawer does not exist (it is a column) and this changes
      nothing.
      */
    setSidebarOpen(false)
    if (sala?.kind !== "voice") return
    setCallChannel(active)
    setCallRoom(room)
    void bridge.call.join(active, { room }).catch((error: Error) => {
      setCallChannel(null)
      setCallRoom("")
      pushToast(traduzirErro(error), "error")
    })
  }

  /**
   * Change the order of channels, or move them to another category.
   *
   * Convention, like changing the name: you publish the order and honest clients
   * follow it. You publish one change per channel that actually moves, `reorder`
   * already returns only those, so a drag does not turn into ten encrypted
   * messages saying what was already said.
   */
  const arrumarSala = (arrastado: string, destino: { antesDe: string } | { categoria: string }): void => {
    if (!active) return
    const salas = roomGroups.flatMap((grupo) => grupo.rooms)
    const mudancas =
      "antesDe" in destino
        ? largarAntesDe(salas, arrastado, destino.antesDe)
        : largarNaCategoria(salas, arrastado, destino.categoria)
    if (mudancas.length === 0) return
    void Promise.all(
      mudancas.map((mudanca) => {
        const sala = salas.find((candidata) => candidata.room === mudanca.room)
        if (!sala) return Promise.resolve({ ok: true })
        return bridge.channels.setRoom(active, {
          ...sala,
          category: mudanca.category,
          position: mudanca.position,
        })
      }),
    )
      .then(() => refreshRooms())
      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
  }

  /**
   * Change the order of categories, and, with them, the blocks that move with them.
   *
   * **No room is published here, and that is the whole point.** Rooms sort within
   * their category and carry written whose they belong to; moving the category
   * position moves the entire block at once. A loop over rooms would be one
   * encrypted message per room, per drag, to say what was already said.
   *
   * `allSettled` and not `all`, for the same reason as `reescreverCategoria`:
   * each statement is an independent message, there is no transaction to invent,
   * and if some fail the list stays half sorted, the ones that did not go stay
   * at the old number or undeclared, and in that case drop to the end. Repeating
   * the gesture fixes it, but only if you know who was left behind.
   */
  const arrumarCategoria = (arrastada: string, alvo: string): void => {
    const declarar = bridge.channels.setCategory
    if (!active || !declarar) return
    const mudancas = largarCategoriaEm(
      roomGroups.map((grupo) => grupo.category),
      categoriasDeclaradas,
      arrastada,
      alvo,
    )
    if (mudancas.length === 0) return
    void Promise.allSettled(
      mudancas.map((mudanca) =>
        declarar(active, {
          category: mudanca.category,
          position: mudanca.position,
          /**
           * The roles the category already had, resent on purpose.
           *
           * A statement wins in full and `roles` absent means "everyone", not
           * "leave it as it was". Without this line, dragging a category in the
           * sidebar would undo its visibility with no one asking, and the gesture
           * that undid it was the most innocent there is.
           *
           * An undeclared category has no roles, and comes empty: this is the
           * case of the first drag in an old tree, which declares the entire list
           * at once. See `reordenarCategorias`.
           */
          roles: categoriasDeclaradas.find((entrada) => entrada.category === mudanca.category)?.roles ?? [],
          // Just reorder: the core does not republish a category with a tombstone (phase 1f).
          reordenar: true,
        }),
      ),
    ).then((resultados) => {
      refreshRooms()
      const paraTras = asQueFicaramParaTras(mudancas, resultados)
      if (paraTras.length > 0) pushToast(strings.rooms.categoryOrderPartial(paraTras.join(", ")), "error")
    })
  }

  /**
   * "Mover" for a room, on the phone: one step up or down inside its category,
   * or to the end of another category. The same drops as the computer's drag
   * (`arrumarSala`). Up: before the room above. Down: before the room two
   * places below, or to the end of the category when it is the last step.
   */
  const moverDaSala = (room: string) => {
    const grupo = roomGroups.find((candidato) => candidato.rooms.some((sala) => sala.room === room))
    if (!grupo) return null
    const salas = grupo.rooms
    const onde = salas.findIndex((sala) => sala.room === room)
    const acima = salas[onde - 1]
    const doisAbaixo = salas[onde + 2]
    return itemDeMover({
      ...(acima ? { acima: () => arrumarSala(room, { antesDe: acima.room }) } : {}),
      ...(onde < salas.length - 1
        ? {
            abaixo: () =>
              arrumarSala(room, doisAbaixo ? { antesDe: doisAbaixo.room } : { categoria: grupo.category }),
          }
        : {}),
      categorias: roomGroups
        .filter((outro) => outro.category !== "" && outro.category !== grupo.category)
        .map((outro) => ({ nome: outro.category, ir: () => arrumarSala(room, { categoria: outro.category }) })),
    })
  }
  /** "Mover" for a category, on the phone: one place up or down (`arrumarCategoria`). */
  const moverDaCategoria = (categoria: string) => {
    if (!bridge.channels.setCategory) return null
    const ordem = roomGroups.map((grupo) => grupo.category).filter((nome) => nome !== "")
    const onde = ordem.indexOf(categoria)
    const acima = ordem[onde - 1]
    const abaixo = ordem[onde + 1]
    return itemDeMover({
      ...(acima !== undefined ? { acima: () => arrumarCategoria(categoria, acima) } : {}),
      ...(abaixo !== undefined ? { abaixo: () => arrumarCategoria(categoria, abaixo) } : {}),
    })
  }

  /**
   * Rewrite the `category` field of a handful of channels.
   *
   * The engine of changing a category's name and deleting it, which are the same
   * operation with different targets, delete is change to the empty name.
   *
   * **This is publication PER CHANNEL, and that is where the danger lives.** If
   * some fail, channels split between two names and the category breaks into two
   * in the list. There is no transaction to invent here: each `channel.meta` is
   * an independent encrypted message, and a channel that did not get its stays
   * where it was. So what you choose is not between breaking and not breaking,    * it is between breaking silently and breaking with warning.
   *
   * `allSettled` and not `all`, on purpose: try in ALL before giving up. Stopping
   * at the first failure also left the category split, only more split, and
   * without even trying what might pass. If some fail, name them, because these
   * are the ones you retry; and retrying is harmless, since each publication only
   * says where the channel is, not what changed.
   */
  const reescreverCategoria = (publicacoes: ChannelRoom[], aoConseguir: () => void): void => {
    if (!active || publicacoes.length === 0) return
    void Promise.allSettled(publicacoes.map((sala) => bridge.channels.setRoom(active, sala))).then((resultados) => {
      refreshRooms()
      const paraTras = osQueFicaramParaTras(publicacoes, resultados)
      if (paraTras.length === 0) aoConseguir()
      else pushToast(strings.rooms.categoryPartial(paraTras.join(", "), paraTras.length), "error")
    })
  }

  /**
   * Change a category's name: write it in all channels that declare it.
   *
   * For a name that already exists, the two become one, two equal labels are the
   * same label. Do not refuse, because that is the model working; warn first, so
   * the merge is chosen and not discovered.
   *
   * **The category declaration travels with the name, and is half the gesture.** A
   * category is two things: the name written in each room, and the declaration
   * that gives it order and says who sees it. Rewriting only the first would move
   * rooms to an undeclared category, and undeclared means `roles: []`, which
   * means EVERYONE. A restriction would undo itself when the name changed,
   * silently, and the gesture that undid it had nothing to do with visibility.
   */
  const renomearCategoria = (categoria: string, novoNome: string): void => {
    // The channel is needed to publish the declaration, and without it there is no
    // gesture to do: `reescreverCategoria` already gave up further on.
    const canal = active
    if (!canal) return
    const nome = novoNome.trim()
    if (!nome || nome === categoria) return
    const { publicacoes, funde } = mudarCategoria(roomGroups.flatMap((grupo) => grupo.rooms), categoria, nome)
    if (publicacoes.length === 0) return
    // The merge asks first, because it joins rooms from two categories and there is
    // no gesture that separates them again automatically.
    if (funde) {
      void confirmar({
        titulo: strings.rooms.mergeCategoryTitle,
        corpo: strings.rooms.mergeCategoryConfirm(nome, publicacoes.length),
        verbo: strings.rooms.mergeCategoryAction,
      }).then((sim) => {
        if (sim) aplicarNomeDeCategoria(canal, categoria, nome, publicacoes)
      })
      return
    }
    aplicarNomeDeCategoria(canal, categoria, nome, publicacoes)
  }

  /** The other half of `renomearCategoria`: the gesture, already decided. */
  const aplicarNomeDeCategoria = (
    canal: string,
    categoria: string,
    nome: string,
    publicacoes: ChannelRoom[],
  ): void => {
    const declarar = bridge.channels.setCategory
    const antiga = categoriasDeclaradas.find((entrada) => entrada.category === categoria)
    /**
     * The already declared destination wins, and nothing publishes over it.
     *
     * In a merge the new name is a category that already exists, with the order
     * and roles someone chose for it. Taking the old ones to it would be letting
     * the category that disappears decide for the one that stays, and the merge
     * warning talks about joining rooms, not changing who sees the ones that were
     * already there.
     */
    const destinoDeclarado = categoriasDeclaradas.some((entrada) => entrada.category === nome)

    const mover = (): void =>
      reescreverCategoria(publicacoes, () => {
        pushToast(strings.rooms.categoryRenamed(categoria, nome))
        // The tombstone of the old one, only after all rooms have left it: without it
        // stays in the list a declared group, empty and with the name of a category no
        // one uses anymore. If it fails, that is what is left, the name already changed,
        // and what remains is undone by deleting the group by hand.
        if (antiga && declarar) {
          void declarar(canal, { category: categoria, removed: true })
            .then(() => refreshRooms())
            .catch((error: Error) => pushToast(traduzirErro(error), "error"))
        }
      })

    // First the declaration, then the rooms: between one and the other there is an
    // instant where the room has already changed its name, and if the declaration
    // does not exist yet that instant shows it to everyone. If the declaration fails,
    // do not touch the rooms, retrying the gesture is better than losing the
    // restriction.
    if (antiga && declarar && !destinoDeclarado) {
      void declarar(canal, { category: nome, position: antiga.position, roles: antiga.roles })
        .then(mover)
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    } else mover()
  }

  /**
   * Delete a category: remove its name from the rooms that declared it.
   *
   * **Does not delete any room.** The category is the label, rooms are the
   * content, and removing the label frees them at the top instead of taking them
   * away.
   *
   * So it does not ask first: the gesture undoes itself. The warning counts how
   * many rooms were NOT deleted, which is the expensive mistake of this gesture,
   * and brings the "Undo".
   */
  const apagarCategoria = (categoria: string): void => {
    const canal = active
    if (!canal) return
    const { publicacoes } = mudarCategoria(roomGroups.flatMap((grupo) => grupo.rooms), categoria, "")
    const declarar = bridge.channels.setCategory
    const antiga = categoriasDeclaradas.find((entrada) => entrada.category === categoria)

    const tirarDeclaracao = (): void => {
      pushToast(strings.rooms.categoryDeleted(categoria, publicacoes.length), "info", {
        rotulo: strings.rooms.categoryUndo,
        fazer: () => reporCategoria(canal, categoria, publicacoes, antiga),
      })
      // Removing the name from rooms frees them, but the declaration stays up and the
      // category sits in the list, empty. Delete is delete both halves.
      if (antiga && declarar) {
        void declarar(canal, { category: categoria, removed: true })
          .then(() => refreshRooms())
          .catch((error: Error) => pushToast(traduzirErro(error), "error"))
      }
    }

    /*
      A category with no rooms is just the declaration, and delete is the
      tombstone and nothing else. Here there was a `return` when there were no
      rooms to rewrite: the empty category (the one just created, the one most
      often deleted) never reached the tombstone, and the gesture did nothing,
      even for admins. Bug seen in 0.8.0.
    */
    if (publicacoes.length === 0) {
      if (antiga && declarar) tirarDeclaracao()
      return
    }
    reescreverCategoria(publicacoes, tirarDeclaracao)
  }

  /**
   * Undo the deletion of a category: the declaration first, then the rooms.
   *
   * The same order as changing the name, for the same reason: with rooms back and
   * the declaration still not published, there is an instant where a restricted
   * category shows to everyone. The republished declaration beats the tombstone,
   * because it has a newer timestamp.
   *
   * The channel comes from the gesture, not the screen: the warning lasts ten
   * seconds, and another channel might be open by then.
   */
  const reporCategoria = (
    canal: string,
    categoria: string,
    soltas: ChannelRoom[],
    antiga: { category: string; position: number; roles: string[] } | undefined,
  ): void => {
    const reporSalas = (): void => {
      const devolvidas = soltas.map((sala) => ({ ...sala, category: categoria }))
      void Promise.allSettled(devolvidas.map((sala) => bridge.channels.setRoom(canal, sala))).then((resultados) => {
        refreshRooms()
        const paraTras = osQueFicaramParaTras(devolvidas, resultados)
        if (paraTras.length === 0) {
          pushToast(soltas.length === 0 ? strings.rooms.categoryRestoredEmpty(categoria) : strings.rooms.categoryRestored(categoria))
        }
        else pushToast(strings.rooms.categoryPartial(paraTras.join(", "), paraTras.length), "error")
      })
    }
    const declarar = bridge.channels.setCategory
    if (antiga && declarar) {
      void declarar(canal, { category: categoria, position: antiga.position, roles: antiga.roles })
        .then(reporSalas)
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    } else reporSalas()
  }

  /**
   * Show a closed channel again.
   *
   * Closing hid it and nothing more: what was said there never left the vault,
   * and messages that kept arriving kept being stored. Reopening is publishing
   * the opposite on top, with a newer timestamp.
   */
  const reabrirSala = (room: string): void => {
    if (!active) return
    const sala = roomsFechadas.find((candidata) => candidata.room === room)
    if (!sala) return
    void bridge.channels
      .setRoom(active, { ...sala, closed: false })
      .then(() => {
        refreshRooms()
        pushToast(strings.rooms.reopened(sala.name))
      })
      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
  }

  /**
   * Delete a closed room, for real.
   *
   * Only from the closed state, and that is on purpose: closing is reversible and
   * exists to be the step before this. Whoever deletes had to do it twice, with a
   * warning in between, which is the best protection against mistake, and is why
   * this gesture has no shortcut from the main list.
   *
   * What happens to the messages is written in the warning, and it is not
   * boilerplate: they are not deleted, because there is no way to do it. They
   * read in the default room instead, see `visible`, which is where that happens
   * without rewriting anything. Its polls are the exception (17/11/2026): they
   * are deleted for everyone, see `semVotacoesDeSalasApagadas`.
   */
  const eliminarSala = (room: string): void => {
    if (!active) return
    const sala = roomsFechadas.find((candidata) => candidata.room === room)
    if (!sala) return
    /**
     * The default room does not delete, and the screen does not ask.
     *
     * The refusal for real is in the core. This is just not offering a gesture
     * that will be refused, the same rule that makes what cannot be done not
     * appear greyed out, but not appear.
     */
    if (sala.room === "") return
    const canal = active
    const corpo =
      sala.kind === "voice"
        ? `${strings.rooms.removeConfirm} ${strings.rooms.removeVoiceNote}`
        : `${strings.rooms.removeConfirm} ${strings.rooms.removePollsNote}`
    void confirmar({
      titulo: strings.rooms.removeRoomTitle(sala.name),
      corpo,
      verbo: strings.rooms.removeAction,
      destructive: true,
    })
      .then(async (sim) => {
        if (!sim) return
        await bridge.channels.setRoom(canal, { ...sala, closed: true, removed: true })
        refreshRooms()
        /**
         * Pull the ground from under whoever was in there, now that there is no
         * there.
         *
         * The call is for the CHANNEL and the room is just the label of where it
         * happens, so no one is dropped by magic: this device leaves the call
         * because the room it was in stopped existing. The others leave when the
         * `channel.meta` reaches them and passes through here, each one on their
         * own, the way everything works in this product.
         */
        if (callChannel === active && callRoom === sala.room) leaveCall()
        // The open room goes back to default, or the view stays empty.
        if (activeRooms[active] === sala.room) abrirSala("")
        pushToast(strings.rooms.removed(sala.name))
      })
      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
  }

  /**
   * Move someone to another voice room.
   *
   * Since 2/11/2026 it sends the command rather than asking: the other person's
   * client obeys only if they have `move` (the session checks), and obeys without
   * asking anything. Remains a convention: an altered client stays where it is.
   * See `voice.move` in the protocol.
   */
  const moverPessoa = (who: string, room: string, de?: string): void => {
    if (!active) return
    const pedido = bridge.channels.moveVoice?.(active, who, room, de)
    if (!pedido) return
    const sala = roomGroups.flatMap((grupo) => grupo.rooms).find((candidata) => candidata.room === room)
    void pedido
      .then(() => pushToast(strings.voiceMove.sent(nameFor(who), sala?.name ?? room)))
      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
  }

  /** "Leave the call": remove someone from the open channel's voice call. */
  const desligarPessoa = (who: string, canal: string | null = active, de?: string): void => {
    if (!canal) return
    const pedido = bridge.channels.disconnectVoice?.(canal, who, de)
    if (!pedido) return
    void pedido
      .then(() => pushToast(strings.voiceMove.disconnected(nameFor(who))))
      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
  }

  /** The open channel's voice rooms, with their category, in sidebar order. */
  const salasDeVozDoCanal = roomGroups.flatMap((grupo) =>
    grupo.rooms.filter((sala) => sala.kind === "voice").map((sala) => ({ ...sala, category: grupo.category })),
  )

  /**
   * "Move to" by room (1.2): only destinations where the mover has `move`, and
   * only if they also have it in the room they are leaving. The current room
   * stays in the list (the menu removes it). A host without `mayMoveIn` reads
   * `mayMove`, as before.
   */
  const moverPorSala = <S extends { room: string }>(
    canal: string,
    de: string,
    salas: readonly S[],
  ): { podeMover: boolean; salasDeVoz: S[]; podeDesligar: boolean } => {
    const porSala = bridge.channels.mayMoveIn
    if (!porSala) {
      const pode = bridge.channels.mayMove?.(canal) ?? false
      return { podeMover: pode, salasDeVoz: [...salas], podeDesligar: pode }
    }
    const destinos = salas.filter((sala) => sala.room === de || porSala(canal, de, sala.room))
    const podeDesligar = porSala(canal, de)
    return { podeMover: destinos.some((sala) => sala.room !== de) || podeDesligar, salasDeVoz: destinos, podeDesligar }
  }

  /**
   * What counts: the messages without those of someone I blocked. They stay on
   * screen (folded in a room), but they never light a number. See `lib/bloqueados.ts`.
   */
  const mensagensQueContam = useMemo(
    () => semBloqueados(messages, address, conjuntoDeBloqueados),
    [messages, address, conjuntoDeBloqueados],
  )
  // Unread counts: in-memory message timestamps against a per-channel mark in
  // localStorage. Simple, and honest about what it is — this device's memory.
  const {
    counts: unreads,
    total: unreadTotal,
    dirigidas,
    marcaDe,
    read: darPorLido,
  } = useUnreads(mensagensQueContam, activoNoEcra, address, prefsDaPresenca.silenciados)

  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Orwell` : "Orwell"
  }, [unreadTotal])

  /**
   * Unread content in each room, per channel.
   *
   * The channel marker is not enough for this: it advances while the channel is
   * open, regardless of which room is in front. See `lib/porLerPorSala.ts`. The
   * open room does not count, and the badge reads by the same rule as the
   * conversation (`salaDeLeitura`) in the open channel; in others, the room is
   * the one on the badge.
   */
  const lidasDosCanais = useEstadoDaConta().lidas
  /**
   * What is muted (`lib/silenciados.ts`). In a muted place, the number that
   * shows is mentions only; everything else stays dark.
   */
  const { prefs: prefsDoSilencio, alternarSilencio } = usePrefs()
  const silenciados = prefsDoSilencio.silenciados
  const silenciadoExacto = useCallback((chave: string) => silenciados.includes(chave), [silenciados])
  /*
    "Lock alone" (Account › Session): with no keyboard, mouse or touch for the
    chosen duration, the vault closes by the same path as "End session" and the
    app returns to the gate. Never during a call. See `useBloqueioAutomatico`.
  */
  /*
    With the session stored, or in an `os` vault, the session does not expire
    (decision 3, F1). Closing the vault there was meant so the gate opens
    it again after: nothing was ending. Read on entry and when the "Session"
    card changes.
    */
  const [sessaoSemExpirar, setSessaoSemExpirar] = useState(false)
  const lerSessaoSemExpirar = useCallback(() => {
    void Promise.resolve()
      .then(() => bridge.vault.status())
      .then((lido) => setSessaoSemExpirar(Boolean(lido?.sessaoMemorizada || lido?.protection === "os")))
      .catch(() => {})
  }, [bridge])
  useEffect(() => {
    if (stage !== "ready") return
    lerSessaoSemExpirar()
    // With two or more accounts, the device list shows this account's name, so
    // the gate can display it ("Switch account"). With just one, nothing is stored.
    void Promise.resolve()
      .then(() => bridge.contas?.listar())
      .catch(() => {})
  }, [stage, lerSessaoSemExpirar])
  useBloqueioAutomatico({
    minutos: sessaoSemExpirar ? 0 : prefsDoSilencio.bloqueioAutomatico,
    activo: stage === "ready",
    emChamada: callChannel !== null,
    ...(historyForLock ? { history: historyForLock.read, historyActive: historyForLock.active } : {}),
    aoBloquear: (reason) => {
      void bridge.vault
        .lock()
        .then(() => onRelock(reason))
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
  })
  // The mark in the diagnostic log at each return to the foreground (1.3.15): see the hook.
  useMarcaDaVolta(bridge, stage === "ready", connection)
  const lidasPorSala = useLidasPorSala()
  // The same map while the counts do not change: a message that changes no count leaves the sidebar alone.
  const porLerPorSala = useMesmoValor(useMemo(
    () =>
      contarPorSala(
        mensagensQueContam,
        lidasDosCanais,
        lidasPorSala,
        { canal: activoNoEcra, sala: activeRoom },
        address,
        (canal, etiqueta) => (canal === activoNoEcra ? salaDeLeitura(etiqueta) : etiqueta),
        silenciados,
      ),
    [mensagensQueContam, lidasDosCanais, lidasPorSala, activoNoEcra, activeRoom, address, salaDeLeitura, silenciados],
  ))
  /**
   * Having a room open means reading it, just as having the channel open reads
   * it. Each message that arrives while it is in front advances its marker.
   * Runs after `useUnreads`, which stores where the channel was on entry.
   */
  /*
    Entering a room: keep its mark as it is NOW, during this render, before the
    effects below and in `useUnreads` advance it. The mention highlight compares
    with it (`entrarNaConversa`, read by the timeline in this same render pass).
    Idempotent: a render run twice writes the same value. The key is cleared on
    a direct conversation too, so coming back to the same room is a new entry.
  */
  const conversaLida = useRef<string | null>(null)
  const conversaAgora = activoNoEcra ? chaveDaConversa(activoNoEcra, activeRoom) : null
  if (conversaAgora !== conversaLida.current) {
    conversaLida.current = conversaAgora
    if (activoNoEcra && conversaAgora !== null && !isDirect(activoNoEcra) && !isFeed(activoNoEcra)) {
      entrarNaConversa(conversaAgora, marcaDaSala(lerLidasPorSala(), lerEstadoDaConta().lidas, activoNoEcra, activeRoom))
    }
  }
  useEffect(() => {
    // `activoNoEcra`: on the phone, a channel's list is not its conversation (see there).
    if (!activoNoEcra || isDirect(activoNoEcra) || isFeed(activoNoEcra)) return
    let at = Date.now()
    for (const message of messages) {
      if (message.channel !== activoNoEcra) continue
      if (salaDeLeitura((message.payload as { room?: string }).room ?? "") !== activeRoom) continue
      at = Math.max(at, stampOf(message.payload))
    }
    lerSala(activoNoEcra, activeRoom, at)
    // And in the account, for other devices (phase 1i). Only goes up, like the channel's.
    const chave = chaveDaLidaDaSala(activoNoEcra, activeRoom)
    if (chave !== null) marcarLido(chave, at)
  }, [activoNoEcra, activeRoom, messages, salaDeLeitura])
  /**
   * What the sidebar shows next to each channel: the sum of its rooms.
   *
   * A closed channel in the list sums everything; the open channel sums rooms
   * not in front, and the sidebar only shows it when its tree is collapsed.
   */
  const porLerNosCanais = useMemo(() => {
    const somas = new Map<string, number>()
    for (const [canal, salas] of porLerPorSala) {
      let soma = 0
      for (const [sala, conta] of salas) soma += numeroVisivel(conta, estaSilenciado(silenciados, canal, sala))
      if (soma > 0) somas.set(canal, soma)
    }
    return somas
  }, [porLerPorSala, silenciados])
  /** The unread count for each room in the open channel, for the sidebar tree. */
  const porLerNaSala = useCallback(
    (room: string): number => {
      const conta = active ? porLerPorSala.get(active)?.get(room) : undefined
      return conta && active ? numeroVisivel(conta, estaSilenciado(silenciados, active, room)) : 0
    },
    [porLerPorSala, active, silenciados],
  )
  /**
   * Direct conversations with mute applied: a muted one counts mentions only.
   * This map is what the Friends column and its badge read.
   */
  const mencoesPorCanal = useMemo(
    () => countUnreads(mensagensQueContam, lidasDosCanais, activoNoEcra, address, (message) => mencionaMe(message.payload.mentions, address)),
    [mensagensQueContam, lidasDosCanais, activoNoEcra, address],
  )
  const comSilencio = useCallback(
    (contas: Map<string, number>): Map<string, number> => {
      if (silenciados.length === 0) return contas
      const visiveis = new Map<string, number>()
      for (const [canal, quantas] of contas) {
        const n = isDirect(canal) && silenciados.includes(canal) ? (mencoesPorCanal.get(canal) ?? 0) : quantas
        if (n > 0) visiveis.set(canal, n)
      }
      return visiveis
    },
    [silenciados, mencoesPorCanal],
  )
  const porLerNasPrivadas = useMemo(() => comSilencio(unreads), [comSilencio, unreads])
  /**
   * What needs attention in each destination on the rail.
   *
   * None of this is a fresh count: these are the sums already on screen,
   * split by where they get handled. See `lib/porAtender.ts`, which explains
   * what each destination counts and why, and why the profile counts nothing.
   * Mute is applied before summing (`comSilencio`).
   */
  const porDestino = useMemo(() => repartirPorDestino(comSilencio(dirigidas)), [comSilencio, dirigidas])
  /**
   * The Communities notices (20/11/2026, option A): two shapes, two meanings.
   *
   * `porLerEmCanais` is everything unread the sidebar shows next to the
   * channels, and on the rail it is only the pill, with no number.
   * `mencoesEmCanais` is the number: someone called this account. A number
   * that summed all the traffic (27/10 to 20/11) did not say whether anyone
   * was waiting. Feeds and direct conversations stay out through the same cut
   * as `repartirPorDestino`. See `lib/porAtender.ts`.
   */
  const porLerEmCanais = useMemo(() => repartirPorDestino(porLerNosCanais).canais, [porLerNosCanais])
  const mencoesEmCanais = useMemo(() => mencoesNosCanais(porLerPorSala), [porLerPorSala])
  /** My wall, which is the channel where comments on my posts land. */
  const meuFeed = useMemo(() => (address ? feedChannelOf(address) : null), [address])
  const comentariosNoMural = useMemo(
    () =>
      meuFeed === null
        ? 0
        : comentariosPorAtender(engagementOf(messages, address), myPosts, address, marcaDe(meuFeed)),
    [meuFeed, messages, address, myPosts, marcaDe],
  )

  /**
   * Being in Social means handling it, the way being in a channel means reading it.
   *
   * Same function the right-click menu uses to "mark as read", and same marker:
   * the wall becomes read up to now, and the badge drops to zero by the path
   * that already existed. No second timestamp to invent here.
   *
   * The feed is never the ACTIVE channel, the shell only puts channels and
   * direct conversations there, so the effect of the open channel being marked
   * read does not reach it. This is the equivalent for this destination.
   */
  useEffect(() => {
    if (view !== "social" || meuFeed === null) return
    darPorLido(meuFeed)
  }, [view, meuFeed, messages, darPorLido])

  /**
   * Leave a channel for real, and only forget it here if there is no other way.
   *
   * `leave` publishes the exit to the group and waits for receipt; the rest
   * remove you from the tree when they connect, and stop seeing you in the list.
   * Used to be `forget`, which only deleted the channel from this device: the
   * person thought they had left and others would see them forever.
   *
   * Without connection, exit does not go out, and we do not pretend it did. We
   * ask again, with the old warning, which tells the truth about `forget`:
   * forget only from this device, and others still see this account.
   *
   * It exists for everyone, and that is what matters: someone invited to a
   * channel they do not want has to have a way out that is not deleting it.
   */
  const sairDoCanal = useCallback(
    (channel: string) => {
      // `frase` says what actually happened: exit published, or just forgotten here.
      // Saying "you left" when others still see the person was a lie.
      const largarDaqui = (frase: string) => (): void => {
        setMessages((current) => current.filter((message) => message.channel !== channel))
        // The two pointers: a channel that stopped existing cannot stay pointed to
        // from either destination.
        setCanal((current) => (current === channel ? null : current))
        setDirecta((current) => (current === channel ? null : current))
        pushToast(frase)
      }
      // Forget only from this device, with the warning that explains what that means.
      // `motivo` is why the real exit did not go out, if there was an attempt.
      const esquecerAqui = (motivo?: string): void => {
        // No attempt at exit means no failure: the warning is different.
        void confirmar(
          motivo
            ? {
                titulo: strings.chat.leaveOfflineTitle,
                corpo: `${motivo}\n\n${strings.chat.leaveOffline}`,
                verbo: strings.chat.leaveOnlyHereAction,
                destructive: true,
              }
            : {
                titulo: strings.chat.leaveOnlyHereTitle,
                corpo: strings.chat.leaveOnlyHere,
                verbo: strings.chat.leaveOnlyHereAction,
                destructive: true,
              },
        )
          .then(async (sim) => {
            if (!sim) return
            await bridge.channels.forget(channel)
            largarDaqui(strings.chat.forgottenHere)()
          })
          .catch((error: Error) => pushToast(traduzirErro(error), "error"))
      }
      const sair = bridge.channels.leave
      // An old host without `leave`: only forget is possible, and we say so.
      if (!sair) return esquecerAqui()
      void confirmar({
        titulo: strings.chat.leaveTitle,
        corpo: strings.chat.leaveBody,
        verbo: strings.menu.leave,
        destructive: true,
      }).then((sim) => {
        if (!sim) return
        void sair(channel)
          .then(largarDaqui(strings.chat.left))
          .catch((error: Error) => esquecerAqui(traduzirErro(error)))
      })
    },
    [pushToast, confirmar],
  )

  /**
   * Join the common channel later.
   *
   * For those who unchecked the box on signup, or who left the channel. The
   * core stores the choice and joins, or requests a slot and keeps trying. The
   * channel shows in the list when entry succeeds, and the button vanishes.
   */
  const [aEntrarNoCanalOficial, setAEntrarNoCanalOficial] = useState(false)
  const entrarNoCanalOficial = useCallback(() => {
    const escolher = bridge.session.escolherSalaComum
    if (!escolher) return
    setAEntrarNoCanalOficial(true)
    void escolher(true)
      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
      .finally(() => setAEntrarNoCanalOficial(false))
  }, [pushToast])

  /**
   * Delete the channel for everyone.
   *
   * The warning says both things, and the second is the one you cannot ignore:
   * the channel ends, AND messages are not deleted. They are encrypted on each
   * person's device and there is no way in, not from here, not from the server.
   *
   * The channel name goes in the question on purpose. It is the same care as
   * the warning to delete a room: forcing you to read what you will destroy is
   * the difference between confirming and hitting OK.
   */
  const eliminarCanal = useCallback(
    (channel: string) => {
      /*
        The published name, or the identifier without the server. This is what
        `labelFor` does, and we do not call it here for a messy but real reason:
        it is declared further down, and naming it in this `useCallback`'s
        dependency list would read it before it exists. The two cases where
        `labelFor` would be better, direct conversation and common channel,         are exactly the two that `mayDeleteChannel` refuses, so they never
        get here.
      */
      const nome = bridge.channels.meta?.(channel)?.name || shortName(channel)
      void confirmar({
        titulo: strings.chat.removeChannelTitle(nome),
        corpo: strings.chat.removeChannelConfirm,
        verbo: strings.menu.remove,
        destructive: true,
      })
        .then(async (sim) => {
          const remover = bridge.channels.remove
          if (!sim || !remover) return
          await remover(channel)
          setMessages((current) => current.filter((message) => message.channel !== channel))
          setCanal((current) => (current === channel ? null : current))
          setDirecta((current) => (current === channel ? null : current))
          pushToast(strings.chat.removedChannel(nome))
        })
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [pushToast, confirmar],
  )

  /**
   * The feed: newest first, and that is the entire rule.
   *
   * No ranking, no "suggested", no engagement weighting — which is also why the
   * app has no reason to record what you looked at or for how long.
   */
  const feed = useMemo(() => feedOf(messages), [messages])

  /**
   * Posts from whoever has their profile open.
   *
   * From the same `feed` that Social shows, not from a fresh search: `feedOf`
   * already requires the post to have arrived through the sender's own feed,
   * which is the rule that stops someone from writing on someone else's wall.
   * A profile that gathered everything with `t === "post"` would break that
   * guarantee.
   */
  const pessoaPosts = useMemo(
    () => (pessoa ? feed.filter((post) => post.sender === pessoa.address) : []),
    [feed, pessoa],
  )

  /** The channel shared to reach the open profile, if there was one. In a
   * separate `const` because only that way the narrowing survives closing. */
  const canalDoPerfil = pessoa?.channel ?? null

  /**
   * Channels this device cannot read. Read when a profile opens.
   *
   * This is the DETECTOR of deafness, and comes from the core (`deafChannels`),
   * which decides it by decryption failures, not interface symptoms. Read on
   * sheet open and not in a loop: this question has one consumer, the button below.
   */
  const [surdos, setSurdos] = useState<string[]>([])
  useEffect(() => {
    if (!pessoa) return
    let vivo = true
    void bridge.social
      .deafChannels()
      .then((lista) => {
        if (vivo) setSurdos(lista)
      })
      .catch(() => {
        // No answer, button does not show, the right side to fail on:
        // a destructive path is behind it.
        if (vivo) setSurdos([])
      })
    return () => {
      vivo = false
    }
  }, [pessoa, bridge])

  /**
   * This person's feed, if this device has it AND cannot read anything from it.
   *
   * This is the channel "Request posts" speaks to, and must be a channel this
   * device HOLDS: the request is a frame that only reaches subscribers, and
   * whoever lacks the feed is not subscribed to it. Without this the button
   * would promise something that never happens.
   *
   * **And the second half, the one that protects it: the feed must be in
   * `deafChannels()`.** It was `posts.length === 0`, in `PersonProfile`, and
   * that guard failed both ways. It vanished when it was valid, one post being
   * read ONCE, ever, keeps the account above zero forever, and that is the
   * typical case of a feed that went deaf with old history in the vault. And it
   * appeared when it was risky: a friend who never posted, or a fresh
   * friendship, has an empty feed by design, and that is where the other side
   * is most likely to lack key packages, because they burned them on the invite.
   * "Having nothing to read" is not "being unable to read".
   */
  const feedDaPessoa = useMemo(() => {
    if (!pessoa) return null
    const canal = feedChannelOf(pessoa.address)
    return channels.includes(canal) && surdos.includes(canal) ? canal : null
  }, [pessoa, channels, surdos])

  /**
   * The sidebar channels: no feeds, no direct conversations.
   *
   * Direct conversations moved out of here and into Friends, where friendships
   * are already managed. This is not just tidying: a channel is a group with
   * rooms, categories, roles, and people joining and leaving; a direct
   * conversation is a person. Having them in the same list made it grow with
   * different things and forced anyone looking for a person to read it among
   * structure that did not apply.
   *
   * The cut is here, not in the sidebar, on purpose: whoever draws the list
   * draws what they are given, and the decision about what is a channel belongs
   * to whoever has the model in front.
   */
  const rooms = useMemo(
    () => channels.filter((channel) => !isFeed(channel) && !isDirect(channel)),
    [channels],
  )
  // The cap on channels this account creates (1.3.26): the "+" goes, and a sentence says why.
  const { quota: channelQuota, podeCriar: canCreateChannel } = useCriarCanais(bridge.session.criarCanais, connection, rooms.length)
  // At the cap, the "+" stays, grey, and this is its tip (`BlockedButton`).
  const channelCapTip = !canCreateChannel && channelQuota ? strings.sidebar.channelLimit(channelQuota) : undefined

  /**
   * A link to a message (`lib/ligacaoDaMensagem.ts`): open its channel and room,
   * light the line up and load the history that holds it. Only for channels this
   * account is in; for any other the link does nothing and says nothing.
   */
  const abrirLigacaoDeMensagem = useCallback(
    (alvo: { channel: string; room: string; id: string }): boolean => {
      if (!rooms.includes(alvo.channel)) return false
      abrirConversa(alvo.channel)
      setActiveRooms((actual) => ({ ...actual, [alvo.channel]: alvo.room }))
      setDestacada(alvo.id)
      void trazerTudoDoCofre(alvo.channel).catch((error: Error) => pushToast(traduzirErro(error), "error"))
      return true
    },
    [rooms, abrirConversa, trazerTudoDoCofre, pushToast],
  )
  useLigacaoDeMensagem(address !== null && rooms.length > 0, abrirLigacaoDeMensagem)
  /*
    Links to this app clicked inside it (1.3.25): message links open here, as
    above, and invite and friend links go up to `App`, into the startup path.
  */
  const tratarLigacaoInterna = useCallback(
    (ligacao: LigacaoInterna) => {
      if (ligacao.tipo === "mensagem") abrirLigacaoDeMensagem(ligacao.alvo)
      else if (ligacao.tipo === "emparelhamento") pushToast(strings.pairing.fromChat, "error")
      else if (ligacao.tipo !== "mensagem-invalida") onLigacaoInterna?.(ligacao)
    },
    [abrirLigacaoDeMensagem, onLigacaoInterna, pushToast],
  )
  useLigacoesInternas(stage === "ready" && address !== null ? serverOf(address) : null, tratarLigacaoInterna)

  /**
   * The sidebar channels where the person on the page is also a member.
   *
   * From the member list this device already has for each channel (the group
   * tree), and only from channels: a direct conversation and a feed are not
   * places where you are together. Read when the page opens another person, and
   * when the channel list changes. A channel that does not respond stays out,
   * instead of breaking the whole list.
   */
  const [canaisEmComum, setCanaisEmComum] = useState<{ quem: string; lista: string[] } | null>(null)
  useEffect(() => {
    if (!pessoaAddress) return
    const quem = pessoaAddress
    let vivo = true
    void Promise.all(
      rooms.map((canalDaLista) =>
        Promise.resolve()
          .then(() => bridge.channels.members(canalDaLista))
          .then(
            (membros) => (membros.includes(quem) ? canalDaLista : null),
            () => null,
          ),
      ),
    ).then((achados) => {
      if (vivo) setCanaisEmComum({ quem, lista: achados.filter((achado): achado is string => achado !== null) })
    })
    return () => {
      vivo = false
    }
  }, [pessoaAddress, rooms, bridge])

  /**
   * The three shortcuts, tied to what already exists.
   *
   * `Alt+↑/↓` move through the SAME list the sidebar draws (`rooms`), not their
   * own order: a shortcut that jumps through an order nobody sees on screen is
   * a shortcut nobody can predict. They wrap at the ends, which makes sense in a
   * short list.
   *
   * With no open channel they do nothing: there is no "next" from anywhere.
   */
  /*
    The desktop app's global shortcuts: microphone and sound work with the window
    hidden, but only during a call. The reason is in
    `apps/client/src/main/atalhos.ts`. What the system refuses is said once per
    change, not on every call.
  */
  const avisoDosGlobais = useRef("")
  const obterGlobais = useAtalhosGlobais({
    ponte: bridge.atalhosGlobais,
    emChamada: callChannel !== null,
    mapa: prefsDaPresenca.atalhosDeVoz,
    accoes: {
      microfone: alternarMicrofone,
      som: alternarSom,
      // Only with the overlay on: off, the key stays free for other apps.
      ...(bridge.overlay && prefsDaPresenca.overlayDeJogoLigada ? { overlay: () => bridge.overlay?.alternar() } : {}),
    },
    aoRegistar: (estado) => {
      const chave = `${estado.ocupados.join()}|${estado.faltaAcessibilidade.join()}`
      if (chave === avisoDosGlobais.current) return
      avisoDosGlobais.current = chave
      if (estado.faltaAcessibilidade.length > 0) {
        pushToast(strings.settings.atalhoSemAcessibilidade, "error", {
          rotulo: strings.settings.atalhoAbrirAcessibilidade,
          fazer: () => void bridge.atalhosGlobais?.abrirAcessibilidade().catch(() => {}),
        })
      }
      if (estado.ocupados.length > 0) pushToast(strings.settings.atalhoOcupado, "error")
    },
  })

  useAtalhos({
    alternarMicrofone,
    alternarSom,
    alternarOverlay: bridge.overlay && prefsDaPresenca.overlayDeJogoLigada ? () => bridge.overlay?.alternar() : undefined,
    alternarCamara,
    alternarEcra,
    sairDaChamada,
    falar,
    canalAnterior: () => {
      if (rooms.length === 0) return
      const onde = canal ? rooms.indexOf(canal) : -1
      const proximo = onde <= 0 ? rooms[rooms.length - 1] : rooms[onde - 1]
      if (proximo) {
        setCanal(proximo)
        setView("chat")
      }
    },
    canalSeguinte: () => {
      if (rooms.length === 0) return
      const onde = canal ? rooms.indexOf(canal) : -1
      const proximo = onde === -1 || onde === rooms.length - 1 ? rooms[0] : rooms[onde + 1]
      if (proximo) {
        setCanal(proximo)
        setView("chat")
      }
    },
  }, () => readPrefs().atalhosDeVoz, obterGlobais)

  useEffect(() => {
    if (callChannel === null) setCameraOff(false)
  }, [callChannel])

  /** Direct conversations, for the Friends column. The other half of the cut. */
  const directChannels = useMemo(() => channels.filter((channel) => isDirect(channel)), [channels])

  /**
   * Conversations to list in the Friends column, already sorted and with preview.
   *
   * All the "show or hide" logic lives in `listDirects`, which is pure and has
   * its own tests: three cases that stumble easily, and the open conversation
   * is the exception that keeps the line from vanishing under the cursor of
   * whoever is reading it.
   */
  /**
   * Accounts that have become other accounts (phase 8.2, "Merge accounts"). The old account
   * is removed from the lists of people who received the notification: friends, conversations, and members.
   * The history stays in the vault; we just do not display the account as if it existed.
   */
  const sucessoes = useSucessoes(bridge, stage === "ready")
  const escondidas = useMemo(() => escondidasPorSucessao(sucessoes), [sucessoes])
  const membrosVisiveis = useMemo(() => members.filter((quem) => !escondidas.has(quem)), [members, escondidas])

  /**
   * The conversation screen is mounted on a destination that is visible.
   *
   * Two questions used to collapse into one, "am I on the conversation destination?"
   * and "is there a conversation in front?", and they stopped being able to be, because the conversation
   * now appears on two destinations. It serves the call dock, which only shows
   * when the entire panel is not in view.
   */
  const conversaNoEcra = view === "chat" || (view === "pessoas" && directa !== null)


  /*
    The "request sent" alert goes away when it stops being the news (1.3.6):
    when the direct chat opens, and when one of our requests gets an answer. It
    used to sit on top of the compose bar of the direct chat opened right after,
    talking about a request already accepted. (`dispensarToast` is declared
    with the call ring's notice, further up: the ring's effect needs it first.)
  */
  const directaAberta = active !== null && isDirect(active) ? active : null
  const pedidosNossos = friendships.sent.length
  const pedidosNossosAntes = useRef(pedidosNossos)
  useEffect(() => {
    const respondido = pedidosNossos < pedidosNossosAntes.current
    pedidosNossosAntes.current = pedidosNossos
    if (directaAberta !== null || respondido) dispensarToast(strings.userMenu.friendSent)
  }, [directaAberta, pedidosNossos, dispensarToast])
  /**
   * And the state of all invites, by the same fold and for the same reason.
   *
   * One source of truth, read by the conversation where the invite arrived and by
   * any other place that comes to show it. Answering removes it from all at
   * the same time because there never were two states, and what would differ here is not
   * a label, it is who enters which channel.
   */
  const convites = useMemo(() => convitesDe(messages, address), [messages, address])

  /**
   * The channels we have been to, with the last time we saw them: ones from this
   * session and archived ones (by archive time).
   *
   * They serve only to cut the "awaiting" line of an accepted invite whose channel
   * already arrived and already left (see `aceitesAEspera`). The time lets a
   * new invite for the same channel through, made later.
   */
  const [canaisConhecidos, setCanaisConhecidos] = useState<ReadonlyMap<string, number>>(() => new Map())
  useEffect(() => {
    const agora = Date.now()
    setCanaisConhecidos((antes) => {
      const next = new Map(antes)
      for (const canal of channels) next.set(canal, agora)
      return next
    })
  }, [channels])
  useEffect(() => {
    const ler = bridge.channels.archived
    if (stage !== "ready" || !ler) return
    let vivo = true
    void ler()
      .then((lista) => {
        if (!vivo || lista.length === 0) return
        setCanaisConhecidos((antes) => {
          const next = new Map(antes)
          for (const entrada of lista) {
            next.set(entrada.channel, Math.max(next.get(entrada.channel) ?? 0, entrada.archivedAt))
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [bridge, stage, channels])

  /**
   * Accepted invites we no longer wait for, on disk and with the time: the channel
   * arrived, or the person cancelled. See `ESPERAS_FEITAS_KEY`. The core does not undo
   * a yes (see `#answerChannelInvite`); this only decides if the line draws.
   */
  const [esperasFeitas, setEsperasFeitas] = useState<ReadonlyMap<string, number>>(readEsperasFeitas)
  useEffect(() => {
    const chegaram = [...convites.ties.values()]
      .filter((tie) => !tie.mine && tie.state === "aceite" && channels.includes(tie.target))
      .filter((tie) => (esperasFeitas.get(tie.target) ?? -Infinity) < tie.at)
      .map((tie) => tie.target)
    if (chegaram.length > 0) setEsperasFeitas(marcarEsperasFeitas(chegaram))
  }, [convites, channels, esperasFeitas])
  const conhecidosOuFeitos = useMemo(() => {
    const juntos = new Map(canaisConhecidos)
    for (const [canal, hora] of esperasFeitas) juntos.set(canal, Math.max(juntos.get(canal) ?? 0, hora))
    return juntos
  }, [canaisConhecidos, esperasFeitas])

  // Here, and not next to `labelFor`: the "awaiting entry" lines already need the
  // published names.
  /*
    The channels where the account is a member and this device still waits for its
    seat (hotfix of 22/11/2026): a new device, or a channel whose state was lost
    here. Read again whenever the list changes: a seat that arrives moves the
    channel from here into `channels`.
  */
  const [aEntrar, setAEntrar] = useState<readonly string[]>([])
  useEffect(() => {
    const ler = bridge.channels.pending
    if (stage !== "ready" || !ler) return
    let vivo = true
    void ler()
      .then((lista) => {
        if (!vivo) return
        // The type of each channel comes before the lines that ask for it, as with the list.
        lembrarFichasDosCanais(bridge.channels.fichas?.())
        setAEntrar((antes) => (antes.length === lista.length && antes.every((c, i) => c === lista[i]) ? antes : lista))
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [bridge, stage, channels])
  const canaisComNome = useMemo(() => [...channels, ...aEntrar.filter((canal) => !channels.includes(canal))], [channels, aEntrar])

  const { spaceMeta: spaceMetaEmBruto, refresh: refreshSpaceMeta } = useSpaceMeta(bridge, canaisComNome, messages)
  // The same map while no channel's banner changed (1.3.15): `labelFor` and `iconFor` depend on it.
  const spaceMeta = useMesmoValor(spaceMetaEmBruto)
  nomePublicado.current = (canal) => spaceMeta.get(canal)?.name

  /**
   * The "Awaiting entry" lines in the sidebar: the link that was followed and the
   * accepted invites whose channel has not arrived yet. When Welcome arrives, the
   * channel enters the list and the line leaves on its own, because it stops passing the
   * filter. One channel only once, even if there is both a link and invite for it.
   */
  const aEsperaDeEntrada = useMesmoValor(useMemo(() => {
    const linhas: { canal: string; nome: string; deLink: boolean; nota?: string; aEntrar?: true }[] = []
    if (entradaAEspera && !channels.includes(entradaAEspera)) {
      linhas.push({
        canal: entradaAEspera,
        // An opaque address (1.0) never goes to the screen: no name, "Invite Channel".
        nome:
          canalAEsperaParaMostrar(entradaAEspera, nomeDaEntradaAEspera, spaceMeta.get(entradaAEspera)?.name) ??
          strings.sidebar.canalDoConvite,
        deLink: true,
        ...(entradaComOutroNome ? { nota: strings.sidebar.chegouOutroNome } : {}),
      })
    }
    for (const tie of aceitesAEspera(convites, channels, conhecidosOuFeitos)) {
      if (linhas.some((linha) => linha.canal === tie.target)) continue
      const nome = tie.name
        ? nomeSeguro(tie.name)
        : (canalAEsperaParaMostrar(tie.target, null, spaceMeta.get(tie.target)?.name) ?? strings.sidebar.canalDoConvite)
      linhas.push({ canal: tie.target, nome, deLink: false })
    }
    // A channel of the account that waits for this device's seat: it never leaves the list.
    for (const canal of aEntrar) {
      if (channels.includes(canal) || linhas.some((linha) => linha.canal === canal)) continue
      // The same cut as `rooms`: feeds and directs ask for seats too, and are not channels in this list.
      if (isFeed(canal) || isDirect(canal)) continue
      const nome = canalAEsperaParaMostrar(canal, null, spaceMeta.get(canal)?.name) ?? strings.sidebar.canalAEntrar
      linhas.push({ canal, nome, deLink: false, nota: strings.sidebar.aEntrarNoCanal, aEntrar: true })
    }
    return linhas
  }, [entradaAEspera, nomeDaEntradaAEspera, entradaComOutroNome, channels, convites, conhecidosOuFeitos, spaceMeta, aEntrar]))

  /*
    "Ainda não guardaste o ficheiro da conta." (21/11/2026): the banner stays at
    the top of every screen until a file is saved in this browser or the
    account has a second device. It replaced the one-time notice, which closed
    for good on the first "Close". Not on an old paired device without the
    account key: its file would not be the account (see `exportNeedsAccountKey`).
  */
  const [ficheiroPorGuardar, setFicheiroPorGuardar] = useState(false)
  const [folhaDoFicheiro, setFolhaDoFicheiro] = useState(false)
  const [voltaDoFicheiro, setVoltaDoFicheiro] = useState(0)
  /*
    The display name, outside the vault, for "Olá, <name>" at the next sign-in
    (21/11/2026): written once the account is open and whenever the name changes.
    See `lib/accountNames.ts`.
  */
  useEffect(() => {
    const name = profile.displayName.trim()
    if (stage !== "ready" || name === "") return
    let alive = true
    void activeAccountId(bridge).then((accountId) => {
      if (alive) rememberAccountName(accountId, name)
    })
    return () => {
      alive = false
    }
  }, [stage, profile.displayName, bridge])
  const aparelhosQueEntraram = notifications.filter((entry) => entry.kind === "device-new").length
  useEffect(() => {
    const outraVez = (): void => setVoltaDoFicheiro((volta) => volta + 1)
    window.addEventListener(FICHEIRO_GUARDADO, outraVez)
    window.addEventListener(APARELHOS_MUDARAM, outraVez)
    return () => {
      window.removeEventListener(FICHEIRO_GUARDADO, outraVez)
      window.removeEventListener(APARELHOS_MUDARAM, outraVez)
    }
  }, [])
  useEffect(() => {
    // A host that cannot export has no file to offer.
    if (stage !== "ready" || !address || typeof bridge.vault.export !== "function") {
      setFicheiroPorGuardar(false)
      return
    }
    let vivo = true
    void (async () => {
      if (!(await ficheiroPorTratar(address))) return false
      const estado = await bridge.pairing?.status().catch(() => null)
      if (estado?.temChaveDeConta === false) return false
      // In by the account file: the file was in hand, whatever this browser's mark says (hotfix 1.3.26-2).
      if (estado?.entrouPorFicheiro === true) return false
      const aparelhos = await bridge.pairing?.devices().catch(() => null)
      return !(aparelhos && aparelhos.length >= 2)
    })().then((mostrar) => {
      if (vivo) setFicheiroPorGuardar(mostrar)
    })
    return () => {
      vivo = false
    }
    // A device that joined elsewhere (`device-new`) is a second device too: count again at once.
  }, [stage, address, bridge, voltaDoFicheiro, aparelhosQueEntraram])
  /*
    Never in the phone layout (hotfix 1.3.26-2): the PWA, the
    phone browser, iOS and Android. The export stays in Settings there, with no
    banner. The phone is the layout's own test (`useTelemovel`), not another one.
  */
  const faixaDoFicheiro = useMemo(
    () => (ficheiroPorGuardar && !telemovel ? { guardar: () => setFolhaDoFicheiro(true) } : null),
    [ficheiroPorGuardar, telemovel],
  )

  /**
   * Cancelling is stopping waiting HERE, and we say it this way.
   *
   * The link request already left and the invite yes too: neither one
   * is undone on the other side. If someone in the channel seats the person later, the
   * channel appears on the list like any other, and the sentence warns of that.
   */
  const cancelarEspera = useCallback(
    (canal: string, deLink: boolean) => {
      if (deLink) {
        esperarEntrada(null)
        canaisAoPedir.current = null
      } else {
        setEsperasFeitas(marcarEsperasFeitas([canal]))
      }
      pushToast(strings.sidebar.esperaCancelada)
    },
    [esperarEntrada, pushToast],
  )
  /**
   * In community mode everyone is already a friend: there is nothing to ask for. And the request
   * from someone I blocked does not count anywhere: not in the badge, not in the bell, not
   * in Received. We filter it here, at the source, so no gate forgets it.
   */
  /*
    "Who can send me friend requests" (Privacy): a request from someone who
    does not fit the rule does not appear anywhere, like one from someone I blocked. Known contacts
    ("friends of friends") are only read with that rule chosen.
  */
  const regraDosPedidos = prefsDoSilencio.pedidosDeAmizade
  const amigosDaConta = useMemo(
    () => [...friendships.ties.values()].filter((tie) => tie.link === "amigos").map((tie) => tie.peer),
    [friendships],
  )
  const conhecidos = useConhecidos(bridge, channels, amigosDaConta, stage === "ready" && regraDosPedidos === "amigos-de-amigos")
  const pedidoCabeNaRegra = useCallback(
    (quem: string) => pedidoCabe(regraDosPedidos, quem, conhecidos),
    [regraDosPedidos, conhecidos],
  )
  pedidoCabeRef.current = pedidoCabeNaRegra
  const openRequests = useMemo(
    () =>
      friendships.open.filter(
        (request) => !community.has(request.peer) && !amizade.estaBloqueado(request.peer) && pedidoCabeNaRegra(request.peer),
      ),
    [friendships, community, amizade, pedidoCabeNaRegra],
  )
  /**
   * What the bell offers for each account that became another (phase 8.2):
   * "Add?" to someone who was a friend, "Invite?" to someone we can invite. Once:
   * answering closes the offer in the core. See `lib/sucessoes.ts`.
   */
  const ofertas = useMemo(
    () =>
      ofertasDeSucessao(sucessoes, {
        eu: address,
        ties: friendships.ties,
        canais: channels,
        podeConvidar: (canal) => bridge.channels.mayInvite?.(canal) ?? false,
      }),
    [sucessoes, address, friendships, channels, bridge],
  )
  const [ofertaOcupada, setOfertaOcupada] = useState<string | null>(null)
  const responderOferta = useCallback(
    (oferta: OfertaDeSucessao, sim: boolean): void => {
      const social = bridge.social
      const feito = oferta.tipo === "amigo" ? "amigo" : oferta.canal
      const acto = sim
        ? oferta.tipo === "amigo"
          ? social.adicionarSucessora?.(oferta.de)
          : social.convidarSucessora?.(oferta.de, oferta.canal)
        : social.marcarSucessao?.(oferta.de, feito)
      if (!acto) return
      setOfertaOcupada(chaveDaOferta(oferta))
      void acto
        .catch((erro: Error) => pushToast(traduzirErro(erro), "error"))
        .finally(() => setOfertaOcupada(null))
    },
    [bridge, pushToast],
  )
  /** The fold that the bell reads, with open requests already filtered. */
  const friendshipsDoSino = useMemo(() => ({ ...friendships, open: openRequests }), [friendships, openRequests])
  /** The bell without requests from blocked people: the entry stays in the vault, but we do not show it. */
  const notificacoesVisiveis = useMemo(
    () =>
      notifications.filter(
        (entrada) =>
          !(
            entrada.kind === "friend-request" &&
            entrada.actor &&
            (amizade.estaBloqueado(entrada.actor) || !pedidoCabeNaRegra(entrada.actor))
          ),
      ),
    [notifications, amizade, pedidoCabeNaRegra],
  )
  /**
   * The Contacts badge: who is waiting for an answer in this destination.
   *
   * The two halves are the two things this destination shows, and they are the
   * same accounts it already draws inside, the requests the
   * "Pending" tab counts, and the unread messages the conversation column puts next to
   * each person. Adding what is already there is what prevents the top number
   * from disagreeing with the bottom numbers.
   */
  const porAtenderEmContactos = porDestino.contactos + openRequests.length
  /**
   * A nudge not seen yet (20/11/2026): its sound lives in `useCotoveladaPorVer`;
   * the Friends button draws it with the rail's own shapes (a red outline and
   * the vibration glyph, `AvisosDoCarril`), and says who sent it in words.
   */
  const cotoveladaPorVer = useCotoveladaPorVer(bridge, { eu: address, emAmigos: view === "pessoas", directaAberta: directa })
  /** A nudge that arrives shakes whatever screen is open, on every device (21/11/2026). See `useNudgeShake`. */
  const nudgeShaking = useNudgeShake(bridge)
  const toquePorVer = cotoveladaPorVer !== null
  /** Where the call on screen is attended: a direct one in Friends, the rest in Communities. */
  const chamadaEm = callChannel === null ? null : isDirect(callChannel) ? "pessoas" : "chat"
  const avisosDosCanais = {
    id: "cracha-canais",
    quantas: mencoesEmCanais,
    porLer: porLerEmCanais > 0,
    activo: view === "chat",
    chamada: chamadaEm === "chat",
  }
  const avisosDoSocial = { id: "cracha-social", quantas: comentariosNoMural, activo: view === "social" }
  const avisosDosAmigos = {
    id: "cracha-contactos",
    quantas: porAtenderEmContactos,
    activo: view === "pessoas",
    toque: cotoveladaPorVer ? strings.rail.cotoveladaPorVer(nameFor(cotoveladaPorVer.de)) : undefined,
    chamada: chamadaEm === "pessoas",
  }
  const lastActivity = useMemo(() => lastActivityOf(messages), [messages])
  /*
    With live presence the last activity is not read, and it changes on every
    message: kept out of `presenceFor`'s identity (1.3.15), or every message made
    every presence function new, and the memoized sidebar rendered again.
  */
  const atividadeDaPresenca = livePresence ? SEM_ACTIVIDADE : lastActivity

  /** Live presence when the server relays it (the operator's explicit
   * choice); otherwise the derived, local fallback for older servers. */
  const presenceFor = useCallback(
    (who: string): "active" | "away" | "busy" | "idle" => {
      // Never look yourself up in the presence map: nobody broadcasts you to
      // you, so the answer is always "absent" and you would watch everyone
      // else go green while your own dot stayed grey.
      if (who === address) return selfPresenceOf(connection, activity)
      const connected = livePresence ? online.has(who) : presenceOf(atividadeDaPresenca, who) === "active"
      return presenceKindOf(connected, directory.get(who)?.activity)
    },
    [address, connection, activity, livePresence, online, atividadeDaPresenca, directory],
  )

  /**
   * Who is in a call or voice room, for the face ring to pulse.
   *
   * Two sources, for the reason of `quemEstaNaSala`: in the call we are in, the
   * peers this device has connected (and us, which they never include); in
   * other rooms, who announced themselves less than `PRESENCA_VALIDA_MS` ago. Without the
   * second, the ring only pulsed for who is already with us, which is who needs it least.
   */
  const emChamada = useCallback(
    (quem: string): boolean => {
      if (callChannel !== null && (quem === address || participants.some((par) => par.address === quem))) return true
      const agora = Date.now()
      for (const laDentro of vozPorSala.values()) if (presencasVivas(laDentro, agora).has(quem)) return true
      return false
    },
    [callChannel, address, participants, vozPorSala],
  )

  /** The tooltip must tell whichever truth is in force. */
  const presenceHint = livePresence ? strings.people.presenceTitleLive : strings.people.presenceTitle

  /**
   * The circle, by cryptographic fact in both directions.
   *
   * This used to count only the feed channels this device holds, which is one
   * of the three facts `friendsOf` weighs — and the narrowest. Someone who
   * reads my feed while I do not yet hold theirs, and someone I have a private
   * channel with, are friends by construction; listing them under "Outras
   * pessoas" is exactly the complaint that a friend "disappeared" while the
   * relationship was plainly still there.
   */
  const lugaresDeFeed = useMemo(
    () => lugaresDeFeedTrocados(channels, myFeedMembers, address),
    [channels, myFeedMembers, address],
  )
  /**
   * The direct conversations that reach the person, and the ones that do not.
   *
   * Someone who only OPENS a direct with us, without friendship and without a word,
   * seats us in a group and nothing else (12/11/2026). Without this
   * cut, that click put a row in the conversation column and the opener in the
   * friends circle. See `directasQueContam`. The open conversation always stays.
   */
  const directasVisiveis = useMemo(
    () =>
      directasQueContam(
        directChannels,
        messages,
        address,
        (peer) => friendships.ties.has(peer) || community.has(peer) || lugaresDeFeed.has(peer),
      ),
    [directChannels, messages, address, friendships, community, lugaresDeFeed],
  )
  const directs = useMemo(
    () =>
      listDirects(
        directChannels.filter((channel) => channel === directa || directasVisiveis.has(channel)),
        messages,
        directasFechadas,
        address,
        directa,
      ).filter((entrada) => entrada.peer === null || !escondidas.has(entrada.peer)),
    [directChannels, directasVisiveis, messages, directasFechadas, address, directa, escondidas],
  )
  const friends = useMemo(() => {
    const circulo = friendsOf(
      channels.filter((channel) => !isDirect(channel) || directasVisiveis.has(channel)),
      myFeedMembers,
      address,
    )
    /**
     * Minus who is no longer.
     *
     * `friendsOf` judges by cryptographic fact: a feed from this person that this
     * device has, or a place of theirs in mine. After a friendship is broken
     * both facts continue to exist for an instant, their feed only disappears
     * from here when they commit my exit, and that depends on their device.
     * Without this subtraction, breaking a friendship changed nothing on screen
     * until that person logged in, and the interface kept calling a friend someone who
     * had just stopped being one.
     */
    for (const cortado of friendships.severed) circulo.delete(cortado)
    // And who became another account (phase 8.2): that account no longer exists.
    for (const antiga of escondidas) circulo.delete(antiga)
    return circulo
  }, [channels, directasVisiveis, myFeedMembers, address, friendships, escondidas])

  /**
   * And the HARD half of the same circle, which is another question.
   *
   * `friends` counts the direct conversation as a relation, and to draw the circle
   * it is right. To decide who can write to whom it does not work: a friend request
   * opens the direct conversation before there is any friendship, so
   * by that criterion everyone we ask is already a friend, and who refuses
   * stays one. This comes down to feed places, which are not given without
   * acceptance. See `lugaresDeFeedTrocados`.
   */
  /**
   * Friend for real: feed places exchanged, and the link not broken.
   *
   * It is the question of the single button and the person's menu, and it is NOT `friends`.
   * `friends` counts any direct conversation as a relation, and a friend request
   * opens the direct before there is friendship: with it, who just asked already
   * appeared as "Friends", with "Call", and the request card never showed.
   */
  const amigoDeFacto = useCallback(
    (who: string): boolean => lugaresDeFeed.has(who) && !friendships.severed.has(who),
    [lugaresDeFeed, friendships],
  )

  /**
   * The tie with a person as the buttons read it: a request of ours already cancelled
   * here counts as none, so "Request friendship" comes back without waiting for the echo.
   */
  const lacoDe = useCallback(
    (who: string) => {
      const tie = friendships.ties.get(who)
      return amizade.cancelouJa(tie) ? undefined : tie
    },
    [friendships, amizade],
  )
  /** The circle that the Friends list draws: in community mode, everyone. */
  const circuloDosAmigos = useMemo(
    () => (community.size > 0 ? new Set([...friends, ...community]) : friends),
    [friends, community],
  )
  /**
   * How many friends the list shows, for the title "Friends (n)". The same count
   * that `PeopleScreen` does: who the directory knows, in the circle, without me and
   * without blocked people. Counting something else put the title in disagreement with the list.
   */
  const quantosAmigos = useMemo(
    () =>
      [...directory.keys()].filter(
        (quem) => quem !== address && circuloDosAmigos.has(quem) && !conjuntoDeBloqueados.has(quem),
      ).length,
    [directory, address, circuloDosAmigos, conjuntoDeBloqueados],
  )
  /** Our requests with no answer, for "Sent". In community there are no requests. */
  const pedidosEnviados = useMemo(
    () => friendships.sent.filter((pedido) => !community.has(pedido.peer) && !amizade.cancelouJa(pedido)),
    [friendships, community, amizade],
  )
  /**
   * Friends for real (tie or exchanged feed places), with the name, for the
   * choice of list I show on the profile. The core drops who is not.
   */
  const amigosParaMostrar = useMemo(
    () =>
      [...friends]
        .filter((quem) => quem !== address && !conjuntoDeBloqueados.has(quem))
        .filter((quem) => estadoDaAmizade(quem, address, friendships.ties.get(quem), amigoDeFacto(quem)) === "amigos")
        .map((quem) => ({ address: quem, nome: nameFor(quem) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt")),
    [friends, address, conjuntoDeBloqueados, friendships, amigoDeFacto, nameFor],
  )

  /**
   * The friends list that the person on the page chose to show, read when the
   * page opens. Null when they do not show, or when we are not friends with them:
   * there the "Friends" tab says why, with no list.
   */
  const [amigosDaPessoa, setAmigosDaPessoa] = useState<{ address: string; lista: string[] } | null>(null)
  const quemNaFolha = pessoa?.address ?? null
  /*
    Re-read when the relationship with that person changes (accepted, broken, blocked):
    the list is only for friends, and a friend who stops being one stops seeing it here.
  */
  const amigoNaFolha =
    quemNaFolha !== null &&
    !amizade.estaBloqueado(quemNaFolha) &&
    estadoDaAmizade(quemNaFolha, address, friendships.ties.get(quemNaFolha), amigoDeFacto(quemNaFolha)) === "amigos"
  useEffect(() => {
    setAmigosDaPessoa(null)
    const ler = bridge.social.shownFriendsOf
    if (!quemNaFolha || !ler || !amigoNaFolha) return
    let vivo = true
    void ler(quemNaFolha)
      .then((mostrada) => {
        if (vivo && mostrada && mostrada.shown.length > 0) setAmigosDaPessoa({ address: quemNaFolha, lista: mostrada.shown })
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [quemNaFolha, amigoNaFolha, bridge])

  /** The DM rows in the sidebar wear the other person's presence. */
  const presenceForChannel = useCallback(
    (channel: string): "active" | "away" | "busy" | "idle" | null => {
      const peer = dmPeerAddress(channel, address)
      return peer ? presenceFor(peer) : null
    },
    [address, presenceFor],
  )

  /**
   * Carry the microphone and camera choices to the call object.
   *
   * Here and not in there: the core does not know storage or preferences,
   * and giving it that dependency now would spoil the only reason it
   * runs the same in the browser and in Electron.
   *
   * **All keys, and not the ones that matter here.** The bridge replaces the
   * entire registry, so sending less ERASES the rest: this used to run each
   * view change with four of the seven keys, and that is why the chosen
   * microphone and gain disappeared from the core when leaving Settings. See
   * `prefsDeMediaParaONucleo`, which is the only place this list lives.
   */
  useEffect(() => {
    const guardadas = readPrefs()
    bridge.applyMediaPrefs?.(prefsDeMediaParaONucleo(guardadas))
    // Silence is a microphone choice like the others, and it also has to
    // be in the core BEFORE the first capture: without this, someone who reloaded the
    // page with the microphone muted entered the next call speaking.
    bridge.call.setMuted(guardadas.micMuted || guardadas.soundOff)
  }, [bridge, view])

  /**
   * The name of a channel on the screen.
   *
   * In order: the name someone gave it, the name of the other person if it is a
   * direct conversation, and only as a last resort the identifier. Before it was always the
   * identifier, writing "Voice Room #1" when creating gave `sala-de-voz-1` and
   * that is what everyone saw forever, because the identifier is the key
   * to the MLS group and changing it would mean changing groups. The label became something
   * else of the address.
   */
  const labelFor = useCallback(
    (channel: string): string => {
      const peer = dmPeerAddress(channel, address)
      if (peer) return nameFor(peer)
      /**
       * The common room has its own name before someone publishes one for it.
       *
       * The final resource in this chain is `shortName`, that is, the identifier
       * without the server, and the common room's identifier comes by default
       * from the server, no one chooses it and no one edits it. Dropping it to the
       * screen was putting plumbing in the label of the first place anyone sees.
       * The published name still wins: by default, not by force.
       */
      if (ehCanalOficial(channel, commonRoom)) {
        return spaceMeta.get(channel)?.name || NOME_CANAL_OFICIAL
      }
      return spaceMeta.get(channel)?.name || shortName(channel)
    },
    [address, nameFor, spaceMeta, commonRoom],
  )

  // The mirror of the system notification, complete only from here on: a channel
  // label needs the directory and published names, which are born above.
  avisoRef.current = { pronto: stage === "ready", labelFor, abrir: openNotification }

  /**
   * Friend notifications MSN-style: "Ana is online" (item 6), and since
   * November 3, 2026 "entered the voice room", "started sharing the screen", and
   * "joined the community". The rules are in `lib/amigosOnline.ts` and
   * `lib/avisosDeAmigos.ts`; here we just compose.
   *
   * **One notification only, never two.** The system one leaves when the person authorized it
   * (Notifications › "System notifications"). When it does not leave, the card from
   * inside the app leaves (`AvisosDeAmigos.tsx`). The two together were the same
   * news told twice.
   *
   * **"Show content" off:** neither the system notification nor the card carries
   * the name, the face, or the place. The switch only exists with system notifications
   * on, and that is where it matters: without system notifications there is no choice made, and the
   * card speaks as before, with the name.
   */
  const empurrarAvisoDeAmigo = useAvisoDeAmigo()
  const entrarNaSalaDoAviso = (canal: string, sala: string): void => {
    abrirConversa(canal)
    setActiveRooms((actual) => ({ ...actual, [canal]: sala }))
    setCallChannel(canal)
    setCallRoom(sala)
    void bridge.call.join(canal, { room: sala }).catch((error: Error) => {
      setCallChannel(null)
      setCallRoom("")
      pushToast(traduzirErro(error), "error")
    })
  }
  avisarAmigoRef.current = (quem: string, tipo: TipoDeAvisoDeAmigo, onde?: SitioDoAviso): void => {
    const prefs = readPrefs()
    const agora = Date.now()
    const conversa = channels.find((canal) => dmPeerAddress(canal, address) === quem)
    const ligado =
      tipo === "online"
        ? prefs.avisarAmigosOnline
        : tipo === "voz"
          ? prefs.avisarAmigosNaVoz
          : tipo === "ecra"
            ? prefs.avisarAmigosNoEcra
            : prefs.avisarAmigosNaComunidade
    const cabe = avisoDoAmigoCabe({
      ligado,
      eAmigo: quem !== address && amigoDeFacto(quem),
      ocupado: prefs.activity === "ocupado",
      pausado: estaEmPausa(prefs),
      silenciado:
        (conversa !== undefined && estaSilenciado(prefs.silenciados, conversa)) ||
        (onde !== undefined && estaSilenciado(prefs.silenciados, onde.canal)),
      desbloqueado: stage === "ready",
    })
    // The 30-minute window only counts notifications that left: a friend silenced by
    // "Busy" notifies the next time they arrive.
    if (!cabe || !vigiaDosAmigos.current.registar(quem, agora, tipo)) return
    const nome = nameFor(quem)
    // The names, or nothing: never an identifier in a notice (see `rotuloParaAviso`).
    const comunidade = onde ? rotuloParaAviso(onde.canal, labelFor(onde.canal), rotulosConhecidos.current) : null
    const sala = onde?.sala
      ? salaParaAviso(onde.sala, bridge.channels.rooms?.(onde.canal)?.find((quarto) => quarto.room === onde.sala))
      : null
    const frase =
      tipo === "online"
        ? strings.notifications.amigoOnline(nome)
        : tipo === "voz"
          ? sala
            ? strings.notifications.amigoNaVoz(nome, sala)
            : strings.notifications.amigoNaVozSemSala(nome)
          : tipo === "ecra"
            ? sala
              ? strings.notifications.amigoNoEcra(nome, sala)
              : strings.notifications.amigoNoEcraSemSala(nome)
            : comunidade
              ? strings.notifications.amigoNaComunidade(nome, comunidade)
              : strings.notifications.amigoNaComunidadeSemNome(nome)
    const discreta =
      tipo === "online"
        ? strings.notifications.amigoOnlineDiscreto
        : tipo === "voz"
          ? strings.notifications.amigoNaVozDiscreto
          : tipo === "ecra"
            ? strings.notifications.amigoNoEcraDiscreto
            : strings.notifications.amigoNaComunidadeDiscreto
    const abrir = (): void => {
      if (tipo === "online" || !onde) openDm(quem)
      else if (tipo === "comunidade" || !onde.sala) abrirConversa(onde.canal)
      else entrarNaSalaDoAviso(onde.canal, onde.sala)
    }
    const rotulo =
      tipo === "online"
        ? strings.notifications.abrirConversa
        : tipo === "voz"
          ? strings.notifications.juntarMe
          : tipo === "ecra"
            ? strings.notifications.ver
            : strings.notifications.abrir
    let caminho: CaminhoDoAviso = null
    if (prefs.notifications) {
      const cara = prefs.notifyPreview ? directory.get(quem)?.avatarDataUrl : undefined
      caminho = showSystemNotice(
        {
          id: `amigo:${tipo}:${quem}:${agora}`,
          title: strings.notifications.title,
          body: prefs.notifyPreview ? frase : discreta,
          // Does not count in the bar icon: there is nothing unread.
          countable: false,
          ...(cara ? { icon: cara } : {}),
          expiraEmMs: AVISO_DO_AMIGO_MS,
        },
        abrir,
      )
    }
    if (caminho === null) {
      const discreto = avisosDoSistemaLigados(prefs.notifications) && !prefs.notifyPreview
      const perfil = directory.get(quem)
      empurrarAvisoDeAmigo({
        tipo,
        texto: discreto ? discreta : frase,
        onde: discreto || tipo === "online" ? undefined : (comunidade ?? undefined),
        cara: discreto ? undefined : perfil?.avatarDataUrl,
        iniciais: discreto ? "" : (nome.trim()[0] ?? "?").toUpperCase(),
        rotulo,
        fazer: abrir,
      })
    }
    motor.tocar({ tipo: "amigo-online", avisoComSom: avisoTemSomProprio(caminho) })
  }

  /** The published icon of a channel, when it exists. See `RoomIcon`. */
  const iconFor = useCallback((channel: string): string | undefined => spaceMeta.get(channel)?.icon, [spaceMeta])

  /** Is this channel the common channel announced by the server? See `lib/oficial.ts`. */
  const oficialFor = useCallback((channel: string): boolean => ehCanalOficial(channel, commonRoom), [commonRoom])

  /**
   * The channels this account founded, for "Channels I founded" on the profile itself.
   *
   * From `rooms` and not from `channels`: a direct conversation and the feed are not
   * channels that someone founds. Without `channels.founder` (a legacy bridge), the
   * section does not render, instead of saying "none" without knowing.
   */
  const canaisFundados = useMemo((): CanalFundado[] | undefined => {
    const fundadorDe = bridge.channels.founder
    if (!fundadorDe || !address) return undefined
    return rooms
      .filter((canal) => fundadorDe(canal) === address)
      .map((canal) => ({ canal, nome: labelFor(canal), icone: iconFor(canal), oficial: oficialFor(canal) }))
  }, [bridge, address, rooms, labelFor, iconFor, oficialFor])

  /**
   * The ticket room of the open channel, if it exists there.
   *
   * Only serves for presentation, and it is the difference between pointing at a door
   * and pointing at a wall: a common channel created by an earlier version does not have
   * this room, and the sentence mentioning it should not appear in that case.
   */
  /**
   * The roles declared in the open channel.
   *
   * The version increments each time a role nomination prompts the list to
   * refresh: roles come from the vault, and the vault does not notify anyone
   * when it changes.
   *
   * **And `messages` too, for the same reason `quemVe` already gives:** `papeisVersao`
   * only increments from gestures on THIS device, so a role created or granted
   * elsewhere never arrived here, the person appeared with no role until someone
   * touched something. An incoming role assignment is a message, and that is the
   * notification that was missing. The possible delay is an instant, and the cost
   * is rereading a small list from the vault; the people list now relies on this
   * to group them, and a group that does not form is more visible than a missing
   * label.
   */
  const [papeisVersao, setPapeisVersao] = useState(0)
  /*
    The same list keeps its identity while its contents are equal: every message re-reads it, and a new array made `roleFor` new,
    and the member list of 400 people drew again for a message about nothing.
  */
  const papeis = useMesmoValor(
    useMemo(
      () => (active ? (bridge.channels.roles?.(active) ?? []) : []),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `papeisVersao` and `messages` are the triggers for re-reading
      [active, bridge, papeisVersao, messages],
    ),
  )
  /*
    Who holds authority in the open channel, read once and not once per person:
    `roleFor` runs for every member, and the core computes the admins over every
    assignment (`adminsOf`). Read again only when a role event of this channel
    arrives (`sinalDosCargos`), not on every message. `sinal` goes in the object
    so `roleFor`, which reads each person's roles live, changes with it.
  */
  const sinalDosCargos = useMemo(() => {
    let n = 0
    let ultima = -1
    for (const m of messages) {
      if (m.channel !== active || (m.payload.t !== "role.assign" && m.payload.t !== "role.define")) continue
      n++
      ultima = m.seq
    }
    return `${n}:${ultima}`
  }, [messages, active])
  const autoridade = useMemo(() => {
    if (!active || !admiteAdministracao(active)) return null
    const embutido = bridge.channels.adminRole?.(active) ?? null
    return {
      sinal: sinalDosCargos,
      fundador: bridge.channels.founder?.(active) ?? null,
      admins: new Set(bridge.channels.admins?.(active) ?? []),
      adminNome: embutido?.name ?? null,
      adminCor: embutido?.colour ?? null,
    }
  }, [active, bridge, papeisVersao, sinalDosCargos])

  /*
    The people of the open room (1.3.25): in a room of a restricted category,
    only who sees it. Computed once per room, member list and role change
    (`autoridade` carries `sinalDosCargos`), never per render; an open room
    returns `membrosVisiveis` itself. Tidying, not security: see `lib/membrosDaSala.ts`.
  */
  const exigidosDaSala = useMemo(() => {
    if (activeRoom === "") return undefined
    const categoria = salasDoCanal.find((sala) => sala.room === activeRoom)?.category ?? ""
    if (categoria === "") return undefined
    return categoriasDeclaradas.find((entrada) => entrada.category === categoria)?.roles
  }, [activeRoom, salasDoCanal, categoriasDeclaradas])
  const membrosDaSalaAberta = useMemo(() => {
    if (!active || !exigidosDaSala || exigidosDaSala.length === 0) return membrosVisiveis
    return [
      ...membrosDaSala(membrosVisiveis, exigidosDaSala, {
        fundador: autoridade?.fundador ?? null,
        admins: autoridade?.admins ?? new Set<string>(),
        papeisQueAdministram: new Set(papeis.filter((papel) => papel.powers.includes("renomear")).map((papel) => papel.role)),
        papeisDe: (quem) => bridge.channels.rolesFor?.(active, quem) ?? [],
      }),
    ]
  }, [active, exigidosDaSala, membrosVisiveis, autoridade, papeis, bridge])

  /**
   * The roles of ANY channel, not just the one open.
   *
   * Properties open from the context menu of a channel in the sidebar, which does not
   * have to be the channel in front. Reading `roles` there showed the roles of the
   * wrong channel, and worse, the editor let you create and delete them as if they
   * belonged to that one.
   */
  const papeisDe = useCallback(
    (channel: string) => bridge.channels.roles?.(channel) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `papeisVersao` is the trigger for re-reading
    [bridge, papeisVersao],
  )

  /**
   * Roles and rooms as tags in the open conversation (12/11/2026). See `lib/etiquetas.ts`.
   *
   * **Only rooms this account sees.** The text rooms of the visible groups (the
   * same filter as the sidebar, `quemVe`) and the default room. A room outside
   * that list is never suggested, and its chip reads `#sala-sem-acesso`: the name
   * stays with those who see it. Voice and AFK rooms stay out: opening them is
   * joining a call, not reading.
   *
   * The roles `@` offers are the ones this writer may mention here: all with
   * `mencionartodos`, otherwise only those marked `mencionavel`. The everyone
   * role is `@all`, not a role.
   */
  const etiquetasDaConversa = useMemo(() => {
    const salasVistas = new Map<string, string>()
    if (active && !isDirect(active)) {
      salasVistas.set("", nomeDaSalaDoCanal(""))
      for (const sala of roomGroups.flatMap((grupo) => grupo.rooms)) {
        if (sala.kind === "text" && sala.afk === undefined) salasVistas.set(sala.room, sala.name)
      }
    }
    const cargosDoCanal = new Map(papeis.filter((papel) => papel.role !== CARGO_TODOS).map((papel) => [papel.role, papel]))
    const podeTodos = active !== null && !isDirect(active) && (bridge.channels.mayMentionAll?.(active, activeRoom) ?? false)
    return {
      cargos: [...cargosDoCanal.values()]
        .filter((papel) => podeTodos || papel.powers.includes("mencionavel"))
        .map(candidatoDeCargo),
      salas: [...salasVistas].map(([room, name]) => candidatoDeSala({ room, name })),
      cargoDe: (role: string) => {
        const papel = cargosDoCanal.get(role)
        return papel ? { nome: papel.name, cor: hexDaCor(papel.colour) } : undefined
      },
      salaDe: (room: string) => {
        const nome = salasVistas.get(room)
        return nome === undefined ? null : { nome }
      },
      onSala: (room: string) => {
        if (!active || !salasVistas.has(room)) return
        setActiveRooms((actual) => ({ ...actual, [active]: room }))
      },
    }
  }, [active, activeRoom, roomGroups, papeis, bridge, nomeDaSalaDoCanal])

  /**
   * Create a role and return the identifier assigned to it.
   *
   * In one place only because it now comes from two: the role editor in channel
   * properties, and the sheet of whoever sees a category. Two copies of this derivation
   * would diverge at the first change, and what it decides is the identifier, which
   * never changes again and ties the role to whoever holds it.
   *
   * The identifier comes from the name and the suffix enters only when the chosen name
   * collides with a role that already exists. Renaming a role later does not unname
   * anyone, because it is the identifier that sticks.
   */
  const criarPapel = useCallback(
    (channel: string, nome: string, poderes: Power[], cor: string | undefined): Promise<string> => {
      const base = nome
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
      const usados = new Set(papeisDe(channel).map((papel) => papel.role))
      let id = base || "papel"
      for (let n = 2; usados.has(id); n += 1) id = `${base}-${n}`
      return bridge.channels
        // The color key only goes when a color is chosen: absence must stay absence,
        // not become a default color.
        .defineRole(channel, { role: id, name: nome, powers: poderes, ...(cor ? { colour: cor } : {}) })
        .then(() => {
          setPapeisVersao((n) => n + 1)
          return id
        })
    },
    [bridge, papeisDe],
  )

  /**
   * The roles of whoever has the profile open, in the channel through which you
   * reached it.
   *
   * **`undefined` when there is no channel, and that is the solution to the problem.**
   * A profile does not belong to any channel and a role always belongs to one, so the
   * section only exists when there is a channel to name in its title.
   *
   * Two paths lead to a profile, and only one brings a channel. From the people panel
   * comes the channel in front, where that list of people exists. From the feed comes
   * the channel of the post, which is the author's own feed, `!feed-…`, a channel and
   * not a place: it has no members or roles, and writing "Roles in feed-@ana" was worse
   * than silence. `isFeed` tells the two apart.
   *
   * Who sees: everyone. Knowing that Ana is a Moderator is not a privilege, it is what
   * makes the role useful, and it is how someone who holds one discovers what it gives
   * them. Who changes is `mayManageRoles`, from the core, and goes as a prop to the
   * section.
   */
  const papeisDoPerfil = useMemo(() => {
    /*
      `admiteAdministracao` and not `isFeed` alone.
      
      A feed has no members or roles, and that was already handled. **A
      two-person conversation does not either**, and that was missing: open the
      other person's profile from the conversation, the sheet offered role boxes
      and a channel administrator label where both can do everything. Checking
      them gave no power to anyone, it gave the impression of giving power, which
      is worse.
      */
    if (!pessoa || !canalDoPerfil || !admiteAdministracao(canalDoPerfil)) return undefined
    const canal = canalDoPerfil
    const quem = pessoa.address
    return {
      channelLabel: labelFor(canal),
      declared: bridge.channels.roles?.(canal) ?? [],
      mine: bridge.channels.rolesFor?.(canal, quem) ?? [],
      mayManage: bridge.channels.mayManageRoles?.(canal) ?? false,
      founder: bridge.channels.founder?.(canal) === quem,
      // `admins` brings who was assigned, not who founded: both states show
      // separately because neither is a declared role.
      admin: bridge.channels.admins?.(canal)?.includes(quem) ?? false,
      onToggle: (papel: string, ter: boolean): void => {
        // Reread at the moment of click and not captured: between opening the sheet and
        // hitting the checkbox an assignment from someone else could have arrived, and
        // saving the old list would undo it without anyone asking.
        const actuais = bridge.channels.rolesFor?.(canal, quem) ?? []
        const proximos = ter ? [...actuais, papel] : actuais.filter((id) => id !== papel)
        void bridge.channels
          .setRoles(canal, quem, proximos)
          .then(() => {
            setPapeisVersao((n) => n + 1)
            pushToast(strings.userMenu.adminChanged)
          })
          .catch((error: Error) => pushToast(traduzirErro(error), "error"))
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `papeisVersao` is the trigger for re-reading
  }, [pessoa, canalDoPerfil, labelFor, bridge, papeisVersao, pushToast])

  /**
   * Who is in the channel of properties, for the "Members" tab of the role editor
   * (phase 3 thread; the editor already knew how to draw it from Discord roles).
   * Read from the bridge, not from `members`: properties open from any channel in the
   * sidebar, and `members` is only the one of the open channel.
   */
  const [membrosDasPropriedades, setMembrosDasPropriedades] = useState<string[]>([])
  useEffect(() => {
    if (!propriedades) {
      setMembrosDasPropriedades([])
      return
    }
    let vivo = true
    void bridge.channels
      .members(propriedades)
      .then((lista) => {
        if (vivo) setMembrosDasPropriedades(lista)
      })
      .catch(() => {
        if (vivo) setMembrosDasPropriedades([])
      })
    return () => {
      vivo = false
    }
  }, [propriedades, bridge, epochTick])

  /** The members, with the name and roles of each. Reread each time roles change. */
  const membrosParaCargos = useMemo(
    () =>
      propriedades
        ? membrosDasPropriedades.map((quem) => ({
            address: quem,
            name: nameFor(quem),
            roles: bridge.channels.rolesFor?.(propriedades, quem) ?? [],
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `papeisVersao` is the trigger for re-reading
    [propriedades, membrosDasPropriedades, nameFor, bridge, papeisVersao],
  )

  /**
   * Grant or revoke a role from someone, from the Members tab.
   *
   * Rereads roles at the moment of the click, like `onToggle` in `papeisDoPerfil`:
   * saving the list that was on screen would have undone a role assignment that
   * arrived in the meantime.
   */
  const darCargoNasPropriedades = useCallback(
    (quem: string, papel: string, ter: boolean): void => {
      if (!propriedades) return
      const canal = propriedades
      const actuais = bridge.channels.rolesFor?.(canal, quem) ?? []
      const proximos = ter ? [...new Set([...actuais, papel])] : actuais.filter((id) => id !== papel)
      void bridge.channels
        .setRoles(canal, quem, proximos)
        .then(() => {
          setPapeisVersao((n) => n + 1)
          pushToast(strings.userMenu.adminChanged)
        })
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [propriedades, bridge, pushToast],
  )

  /** Close the properties sheet and forget where it was opened from. */
  const fecharPropriedades = useCallback((): void => {
    setPropriedades(null)
    setPropriedadesNosPapeis(false)
  }, [])

  /**
   * Someone's role in the open channel.
   *
   * Whoever founded it appears as founder, they cannot be removed, and it is useful
   * to know who it is. Whoever was assigned appears as admin, or with the name of the
   * role given to them. The rest have no role, and in that case the list shows the
   * address as it always has.
   */
  /**
   * The nicknames in the open channel (phase 3), by address.
   *
   * Reread each message: a nickname arrives as a message, and it is what makes the
   * question be asked again. Absent in the bridge is nobody having a nickname.
   */
  const apelidos = useMesmoValor(
    useMemo(
      () => (active ? (bridge.channels.nicknames?.(active) ?? {}) : {}),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `messages` is the trigger for re-reading
      [active, bridge, messages],
    ),
  )
  const apelidoDe = useCallback((quem: string): string | undefined => apelidos[quem], [apelidos])
  /** The nickname sheet: who, and in which channel. */
  const [aMudarApelido, setAMudarApelido] = useState<{ canal: string; who: string } | null>(null)

  /** Change (or remove, with empty) someone's nickname in a channel. The guard is in the core. */
  const mudarApelido = useCallback(
    (canal: string, quem: string, apelido: string): void => {
      void bridge.channels
        .setNickname?.(canal, quem, apelido)
        .then(() => pushToast(apelido ? strings.userMenu.nicknameSaved : strings.userMenu.nicknameRemoved))
        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
    },
    [bridge, pushToast],
  )

  const roleFor = useCallback(
    (address: string): CargoDoMembro | null => {
      /*
        The same guard as `papeisDoPerfil` (above), which was missing here.
        
        Where there is no administration, there is no administration label. In a
        two-person conversation nobody has authority over anybody, and "Founder"
        next to one of them announced an authority that does not exist, even
        worse because the conversation is the same for both and the label is not:
        whoever published `room.created` reads it, whoever only received it after
        it was already published does not, and they both end up seeing different
        conversations. With no label at all, both sides see the same again, the
        address, as always.
        */
      if (!active || !autoridade) return null
      /*
        Founder and admin come without color, and it is for them that color must come
        from here and not from a separate function. Neither is a declared role: they
        are not in `roles`, they do not paint in the editor, and there is no color that
        these two words could be showing. A separate color function would fetch the
        color of THIS person's DECLARED roles and paint it on a word that does not name
        them, the color saying one thing that the text does not say.
        */
      /*
        The GROUP goes out from here for the same reason as the color: it is the
        third thing asserted about a person's role, and three answers built in
        different places end up disagreeing. The first to disagree would be a
        group with the color of a role that the label does not name.

        Founder and administrator at the top, and in this order, because it is
        the order of authority; declared roles follow, in channel order. See
        `agruparMembros`.
      */
      if (autoridade.fundador === address) {
        const label = strings.roomProperties.roleFounder
        return { label, grupo: { id: "fundador", nome: label, ordem: 0 } }
      }
      if (autoridade.admins.has(address)) {
        /*
          The name that whoever manages roles gave to it, if they changed it (2/11/2026),
          and the color with it. Without a given name, the house word and no color, as
          always.
          */
        const label = autoridade.adminNome ?? strings.roomProperties.roleAdmin
        const tinta = hexDaCor(autoridade.adminCor ?? undefined)
        return {
          label,
          ...(tinta ? { tint: tinta } : {}),
          grupo: { id: "admin", nome: label, ordem: 1, ...(tinta ? { tint: tinta } : {}) },
        }
      }
      // Multiple roles show together: having two is normal and hiding one would
      // make the list lie about what someone can do.
      const seus = bridge.channels.rolesFor?.(active, address) ?? []
      // In channel order, not in the order they were given: the highest role first,
      // like in the group and profile.
      const nomes = papeis.filter((papel) => seus.includes(papel.role)).map((papel) => papel.name)
      if (nomes.length === 0) return null
      // The color is one, and the banner can name multiple roles. Send the first
      // in channel order that has a color, `papeis` comes pre-sorted. See
      // `corDosPapeis` for why it's that one and not another.
      const tinta = corDosPapeis(papeis, seus)
      /*
        The group is the PRIMARY role, which is the first in channel order, the same
        rule as color, and so the same list. Someone with two roles appears once, under
        the highest one, and the sub-line still names both: hiding the second would make
        the list lie about what the person can do.
        
        `order` starts at 2 because 0 and 1 are founder and admin.
        */
      const posicao = papeis.findIndex((papel) => seus.includes(papel.role))
      const principal = posicao === -1 ? null : papeis[posicao]
      return {
        label: nomes.join(", "),
        ...(tinta ? { tint: tinta } : {}),
        ...(principal
          ? {
              grupo: {
                id: principal.role,
                nome: principal.name,
                ordem: 2 + posicao,
                ...(tinta ? { tint: tinta } : {}),
              },
            }
          : {}),
      }
    },
    [active, bridge, autoridade, papeis],
  )

  /**
   * Everything the menu of a person needs to know, wherever the click comes from.
   *
   * In one place only because the menu now opens from five: members panel, post author,
   * Friends list, line of a conversation, and the name of someone in a voice room.
   * Written by hand in each one, the fifth would be born with an old copy of the four
   * management conditions, which is exactly how the voice room menu was born, with a
   * list just for it and an entry inside it.
   *
   * `channel` comes from outside and is not deduced: whoever clicks knows if there is
   * a shared channel, and which. From the Friends list it is null, and the menu shrinks
   * on its own.
   */
  const contextoDaPessoa = useCallback(
    (who: string, canal: string | null): Parameters<typeof itensDaPessoa>[0] => {
      const estado = estadoDaAmizade(who, address, lacoDe(who), amigoDeFacto(who))
      return {
      ehEuProprio: who === address,
      ehAmigo: estado === "amigos",
      naComunidade: community.has(who),
      ehBloqueado: amizade.estaBloqueado(who),
      ...(estado === "pedido-enviado" ? { pedido: "enviado" as const } : {}),
      ...(estado === "pedido-recebido" ? { pedido: "recebido" as const } : {}),
      canal,
      canalAdmiteAdministracao: admiteAdministracao(canal),
      podeGerirPapeis:
        canal !== null && (bridge.channels.mayManageRoles?.(canal) ?? bridge.channels.mayEdit?.(canal) ?? false),
      ehFundador: canal !== null && bridge.channels.founder?.(canal) === who,
      jaEhAdministrador: canal !== null && (bridge.channels.admins?.(canal)?.includes(who) ?? false),
      // `mayExpel` and not `mayManageRoles`: they are separate responsibilities
      // on purpose, and whoever arranges rooms does not expel anyone. Absent is "cannot",
      // which is the safe reading for the only gesture without a way back.
      podeExpulsar: canal !== null && (bridge.channels.mayExpel?.(canal) ?? false),
      // Phase 3: the nickname in this channel. I mute mine always; others' only if moderating.
      podeModerar: canal !== null && address !== null && (bridge.channels.mayModerate?.(canal, address) ?? false),
      temApelido: canal !== null && (bridge.channels.nicknames?.(canal)?.[who] ?? "") !== "",
      accoes: {
        ...(bridge.channels.setNickname
          ? {
              mudarApelido: () => {
                if (canal !== null) setAMudarApelido({ canal, who })
              },
              tirarApelido: () => {
                if (canal !== null) mudarApelido(canal, who, "")
              },
            }
          : {}),
        /*
          The channel of the click travels to the profile, and it is what decides there
          if the roles section appears. Coming from the Friends list it is null, and the
          page shows the person with no role, which is right: a profile does not belong
          to any channel.
        */
        verPerfil: () => openProfile(who, canal),
        copiarEndereco: () => {
          void copiarTexto(who)
            .then(() => pushToast(strings.social.authorCopied))
            .catch(() => pushToast(strings.common.copyFailed, "error"))
        },
        mensagem: () => openDm(who),
        chamada: () => chamarPessoa(who),
        pedirAmizade: () => amizade.pedir(who),
        aceitarAmizade: () => amizade.aceitar(who),
        desfazerAmizade: () => amizade.desfazer(who),
        ...(amizade.podeCancelar ? { cancelarPedido: () => amizade.cancelar(who) } : {}),
        ...(amizade.podeBloquear
          ? { bloquear: () => amizade.bloquear(who), desbloquear: () => amizade.desbloquear(who) }
          : {}),
        ...(bridge.denuncias ? { denunciar: () => setADenunciar({ who, canal }) } : {}),
        /*
          The invite sheet, with the person already filled in. The channel is chosen
          first from the list, with the channel of the click already marked when there
          is one that is not a direct conversation or feed.
        */
        convidarParaCanal: () =>
          setConvidar({
            channel: null,
            pessoa: who,
            ...(canal !== null && !isDirect(canal) && !isFeed(canal) ? { preferido: canal } : {}),
          }),
        /*
          Only opens the confirmation. The gesture happens inside, after the name is
          written by hand: it is the only one from this menu that advances the epoch
          and removes keys, and a menu is not the place for that to happen on a click.
        */
        expulsar: () => {
          if (canal === null) return
          setExpelling({ who, channel: canal })
        },
        alternarAdministrador: () => {
          if (canal === null) return
          const jaEra = bridge.channels.admins?.(canal)?.includes(who) ?? false
          void bridge.channels
            .setAdmin(canal, who, !jaEra)
            .then(() => pushToast(strings.userMenu.adminChanged))
            .catch((error: Error) => pushToast(traduzirErro(error), "error"))
        },
      },
      }
    },
    [address, amigoDeFacto, lacoDe, bridge, openProfile, openDm, chamarPessoa, amizade, pushToast, community, mudarApelido],
  )

  /**
   * The person's menu on call cards (phase 3): same context as the menu
   * for someone in a voice room, with destinations for "Move to…". The panel
   * adds volume to it (`itensDaPessoaNaChamada`). In a direct conversation there are no
   * rooms, and the menu stays the person's.
   */
  const menuDaPessoaNaChamada = useCallback(
    (quem: string) => {
      if (callChannel === null) return null
      const canal = callChannel
      const de = callRoom ?? ""
      const porSala = moverPorSala(canal, de, callChannel === active ? salasDeVozDoCanal : [])
      return {
        pessoa: contextoDaPessoa(quem, callChannel),
        podeMover: !isDirect(callChannel) && porSala.podeMover,
        salaActual: de,
        salasDeVoz: porSala.salasDeVoz,
        mover: (room: string) => moverPessoa(quem, room, de),
        ...(bridge.channels.disconnectVoice && porSala.podeDesligar ? { desligar: () => desligarPessoa(quem, canal, de) } : {}),
      }
    },
    [callChannel, callRoom, active, salasDeVozDoCanal, contextoDaPessoa, moverPorSala, moverPessoa, desligarPessoa],
  )

  // The toast layer (ToastProvider, above this component) wraps every stage,
  // gate included: setup failures speak through the same channel as the rest.
  /**
   * In which VOICE ROOM of this channel the call is happening.
   *
   * The banner "X is in a call" had a button that joined the channel and not the room,    * `join(active)` without a label. Whoever tapped fell into a parallel, empty call
   * while everyone else stayed in the voice room: two rooms where there should be one,
   * and nobody could hear anyone.
   *
   * `null` when there is no call; `""` in a direct conversation, which has no rooms and
   * where the call is the channel itself.
   */
  const salaDaChamada = useMemo(
    () => salaDaChamadaDe(active, active !== null && isDirect(active), ringing, vozPorSala, Date.now()),
    [active, ringing, vozPorSala],
  )

  /**
   * The name of the room where OUR call happens, for the dock to say where it is from.
   *
   * The dock floats over any screen, and the call channel often is not the channel you
   * are reading, which is exactly when it exists. So rooms come from `useRooms` only
   * when both match, and from the vault when they do not.
   *
   * In a direct conversation there is no room and the dock gets the person's name,
   * which is all there is to say.
   */
  const salaDaDoca = useMemo(() => {
    if (callChannel === null || isDirect(callChannel)) return undefined
    const salas = callChannel === active ? salasDoCanal : (bridge.channels.rooms?.(callChannel) ?? [])
    return nomeDaSala(salas, callRoom)
  }, [callChannel, callRoom, active, salasDoCanal, bridge])

  /*
    A call with the screen locked: the system's mute and hang-up buttons, the
    call audio session on Safari, and the screen kept on when the person asked
    for it.
  */
  useChamadaEmSegundoPlano({
    emChamada: callChannel !== null,
    titulo: callChannel === null ? "" : (salaDaDoca ?? labelFor(callChannel)),
    ecraLigado: prefsDoSilencio.ecraLigadoNaChamada,
    aoAlternarMicrofone: alternarMicrofone,
    aoSair: sairDaChamada,
  })

  /*
    And the truth on the iPhone's installed app: iOS turns off its microphone
    when the screen locks. Said on each call entry, until there is a native app.
  */
  const pwaDoIos = useMemo(() => ehPwaDoIos(), [])
  useEffect(() => {
    if (pwaDoIos && entradaNaChamada !== null) pushToast(strings.chamadaEcraBloqueado.avisoPwaIphone, "info")
  }, [pwaDoIos, entradaNaChamada, pushToast])

  /*
    The game overlay on the desktop app. The minimal summary of the voice room goes to the main process, which shows
    the pill on top of the game. The rules for when it appears and what it overlays are
    in `hooks/useOverlayDeJogo.ts` and `apps/client/src/main/overlay.ts`.
  */
  const audioDaChamadaParaAOverlay = (bridge.call as Partial<typeof bridge.call>).audio
  useOverlayDeJogo({
    ponte: bridge.overlay,
    sala:
      callChannel === null
        ? null
        : { chave: chaveDaSala(callChannel, callRoom), nome: salaDaDoca ?? labelFor(callChannel) },
    eu: {
      id: address ?? "",
      nome: profile.displayName || strings.call.selfFallback,
      // The own portrait in the store (Task 10) comes resolved by the directory.
      cara: profile.avatarDataUrl ?? (address ? directory.get(address)?.avatarDataUrl : undefined),
    },
    // `naSalaDaChamada` and not just `participants`: anyone who announced themselves and is still
    // connected is also in the room, like in the "calling" cards.
    outros: naSalaDaChamada.map((quem) => {
      const par = participants.find((p) => p.address === quem)
      return {
        id: quem,
        nome: nameFor(quem),
        cara: directory.get(quem)?.avatarDataUrl,
        stream: par?.stream ?? null,
        micCalado: par?.micMuted ?? false,
      }
    }),
    micMuted,
    soundOff,
    dbDaEntrada: () => {
      // `anelDb`: with the manual microphone slider, the ring follows the gate (see `CallPanel`).
      const medidas = audioDaChamadaParaAOverlay?.medir()
      if (medidas === undefined || medidas.entradaDb <= -119) return null
      return medidas.anelDb ?? medidas.entradaDb
    },
    ligada: prefsDaPresenca.overlayDeJogoLigada,
    opacidade: prefsDaPresenca.opacidadeDaOverlay,
    textos: { entrou: strings.overlayDeJogo.entrou, saiu: strings.overlayDeJogo.saiu },
  })

  /**
   * The FRIEND REQUEST CARD of this conversation, if there is one to resolve.
   *
   * It lived glued to the line where the request arrived, inside the list that scrolls.
   * It took just two messages after it for the buttons to rise out of view: the person
   * read what they had been written without having a way to respond there, and that was
   * the bug. Now it is a conversation card not a line of it, and it stays
   * until the request is open.
   *
   * **It appears in both places because ChatScreen is one**: the same conversation opens
   * in Friends and in channels, and the card goes with it.
   *
   * **And it is one card only.** It CAME OUT of `Timeline` on entering here, instead of
   * a second being added, two would give two "Accept" buttons on the same screen, which
   * is what the previous attempt produced and `App.test` caught.
   */
  const pedidoDeAmizade = useMemo(() => {
    if (!address || active === null || !isDirect(active)) return null
    const peer = dmPeerAddress(active, address)
    // In community mode, everyone is already a friend: there is nothing to respond to, and the same rule removes these requests from the Friends list.
    if (!peer || community.has(peer)) return null
    // Blocked: the person has no card. There is nothing to respond to.
    if (amizade.estaBloqueado(peer)) return null
    const tie = friendships.ties.get(peer)
    if (!tie) return null
    const nome = nameFor(peer)
    const comum = {
      aceitar: strings.people.accept,
      recusar: strings.people.decline,
      ocupado: amizade.respondendo === peer,
    }
    // A cross request counts as a request awaiting response: accepting is what closes it on both sides. See `openRequestsOf` in the protocol.
    if (tie.link === "pedido-recebido" || tie.link === "cruzado") {
      return {
        ...comum,
        titulo: strings.people.wantsToBeFriends(nome),
        // The note from the requester when they wrote it: that is what the person wants to read before deciding. Without a note, the system shows what is waiting to happen, because a silent card is indistinguishable from a failure.
        estado: tie.note ?? strings.people.requestWaits,
        respondivel: true,
      }
    }
    /*
      And our own request, which also had a line in the conversation and lost it.

      No buttons, there is nothing to respond to from this side, but with the card, otherwise
      the requester opens the conversation and sees no sign that they made the request.
    */
    if (tie.link === "pedido-enviado") {
      return { ...comum, titulo: strings.people.requestSent(nome), estado: strings.people.requestSentWait, respondivel: false }
    }
    return null
  }, [address, active, community, friendships, nameFor, amizade])

  /**
   * And the writing bar of this conversation, locked until there is friendship.
   *
   * The rule: only after the request is accepted do private messages get exchanged.
   * The card above shows what is happening; this is what makes it work,
   * because a card drawn on top of a working writing box does not prevent anything, and it really did not. See `escritaNaDirecta`, where the entire
   * rule lives and what was measured in real time before it.
   *
   * Direct conversations only. A channel belongs to whoever is there, and whoever is there writes.
   */
  const trancaDaEscrita = useMemo((): { texto: string; pedirA: string | null; bloqueado?: boolean } | null => {
    if (!address || active === null || !isDirect(active)) return null
    const peer = dmPeerAddress(active, address)
    if (!peer) return null
    switch (
      escritaNaDirecta(friendships.ties.get(peer), community.has(peer), lugaresDeFeed.has(peer), amizade.estaBloqueado(peer))
    ) {
      case "livre":
        return null
      case "bloqueado":
        return { texto: strings.people.escritaBloqueado, pedirA: null, bloqueado: true }
      case "espera-resposta":
        return { texto: strings.people.escritaEspera, pedirA: null }
      case "responde-primeiro":
        return { texto: strings.people.escritaAceitaPrimeiro, pedirA: null }
      case "sem-amizade":
        /*
          A direct message with someone who is not a friend was a dead end: the bar said "request friendship"
          and there was no button there. The button comes with the message, and calls the
          same function that the menu and the profile page use.
        */
        return { texto: strings.people.escritaSemAmizade, pedirA: peer }
    }
  }, [address, active, community, friendships, lugaresDeFeed, amizade])
  const escritaTrancada = trancaDaEscrita?.texto ?? null

  /**
   * The response given in the conversation, by the path that already exists.
   *
   * `amizade.aceitar`/`amizade.recusar` are the same ones that the Friends screen, the
   * bell, the menu and the profile page use. One function per action: if the conversation
   * had its own path, the two would diverge on the first change, and what
   * diverges here is not cosmetic, it is who ends up with which keys.
   */
  const responderAmizade = useCallback(
    (aceitar: boolean) => {
      if (!address || active === null) return
      const peer = dmPeerAddress(active, address)
      if (!peer) return
      if (aceitar) amizade.aceitar(peer)
      else amizade.recusar(peer)
    },
    [address, active, amizade],
  )

  /**
   * The card for a conversation line, if it is an invite to a channel.
   *
   * Here, and not inside the conversation, because this is where invite state lives
   *, and a second read of the state, done inside, would be a second
   * truth about who enters which channel.
   *
   * What cannot be responded to does not get buttons: `respondivel` is false for an invite from us, for one already responded to, and for an expired one. The status line
   * stays the same, because a silent card is indistinguishable from a failure.
   *
   * An invite stays per line and a friend request does not, and the difference is not arbitrary: there are many invites in the same conversation, each for its own channel
   * and each with its own outcome. There is one friend request.
   */
  const pedidoDe = useCallback(
    (message: ChatMessage) => {
      if (!address) return null

      const tie = conviteDaMensagem(convites, message, address)
      if (!tie) return null
      const nome = nameFor(tie.peer)
      const onde = tie.name ? `"${tie.name}"` : labelFor(tie.target)
      const estado =
        tie.state === "caducado"
          ? tie.mine
            ? strings.convite.caducadoMeu(nome)
            : strings.convite.caducado
          : tie.state === "recusado"
            ? tie.mine
              ? strings.convite.recusadoDeles(nome)
              : strings.convite.recusado
            : tie.state === "aceite"
              ? tie.mine
                ? strings.convite.aceiteDeles(nome)
                : channels.includes(tie.target)
                  ? strings.convite.aceiteDado
                  : strings.convite.aceiteFalta(nome)
              : tie.mine
                ? strings.convite.aguarda(nome)
                : strings.convite.porResponder
      return {
        titulo: strings.convite.titulo(onde),
        estado,
        aceitar: strings.convite.aceitar,
        recusar: strings.convite.recusar,
        respondivel: !tie.mine && tie.state === "pendente",
      }
    },
    [address, convites, channels, nameFor, labelFor],
  )

  /** The response to an invite, routed to the path that already exists. */
  const responderPedido = useCallback(
    (message: ChatMessage, aceitar: boolean) => {
      if (!address) return
      const alvo = message.payload.invite?.channel
      if (!alvo) return
      answerInvite(message.channel, alvo, message.sender, aceitar)
    },
    [address, answerInvite],
  )

  /**
   * Follow an already read invite: the sticky one and the startup one both pass through
   * here. Returns whether the invite was handled (so the dialog knows if it should close).
   */
  const seguirConvite = (convite: ConviteLido, nome: NomeDoConvite | null = null): boolean => {
    const destino = destinoDoConvite(convite, address, channels)
    if (destino.que === "outro-servidor") {
      pushToast(
        strings.invite.otherServer(servidorParaMostrar(destino.deles), servidorParaMostrar(destino.meu)),
        "error",
      )
      return false
    }
    if (destino.que === "ja-la-estou") {
      setCanal(destino.canal)
      setView("chat")
      pushToast(
        eMoradaOpaca(destino.canal) ? strings.invite.alreadyInOpaco : strings.invite.alreadyIn(canalParaMostrar(destino.canal)),
      )
      return true
    }
    esperarEntrada(destino.canal, nomeDoSelo(nome))
    canaisAoPedir.current = channels
    avisouDoNomeErrado.current = false
    pushToast(strings.chat.joinPending)
    // A failed request takes the invite with it, on purpose: the startup one
    // has already been marked as resolved by the caller. The code is a secret, and
    // keeping it waiting for a second attempt was keeping it alive because of
    // a case that the person resolves by clicking the link they have again.
    void bridge.invites.redeem(destino.link).catch((error: Error) => {
      // Only if this is still the request waiting: a link B followed in the meantime does not
      // lose the line because of A's failure.
      if (pendingJoin.current === destino.canal) esperarEntrada(null)
      pushToast(traduzirErro(error), "error")
    })
    return true
  }

  /*
    The sidebar's props, stable between renders (1.3.15), so its `memo` can skip
    it when nothing it shows changed. Event handlers go through `useEstavel`: a
    stable identity that runs the latest code. What the sidebar calls while it
    renders (`voicePresence`, `categoriaRestrita`, `salaDaChamadaEm`) uses
    `useCallback` with what it reads, so it changes when that changes.
  */
  // Only in the open app: this runs on every render, and with the vault locked or going
  // away (a removed device) the session has no identity to answer with.
  const editaOCanal = stage === "ready" && active !== null && (bridge.channels.mayEdit?.(active) ?? false)
  const esperaDaBarra = useMemo(
    () =>
      aEsperaDeEntrada.map((linha) => ({
        canal: linha.canal,
        nome: linha.nome,
        ...(linha.nota ? { nota: linha.nota } : {}),
        ...(linha.aEntrar ? {} : { onCancelar: () => cancelarEspera(linha.canal, linha.deLink) }),
      })),
    [aEsperaDeEntrada, cancelarEspera],
  )
  /* A non-empty role list is a restriction, empty means "everyone", not
     a restriction on nobody. Same reading as `categoriaVisivel`, and
     the decision lives here, with the model in front. */
  const categoriaRestritaDaBarra = useCallback(
    (nome: string) => (categoriasDeclaradas.find((entrada) => entrada.category === nome)?.roles.length ?? 0) > 0,
    [categoriasDeclaradas],
  )
  const salaDaChamadaDaBarra = useCallback(
    (channel: string) => salaUnicaDaChamadaDe(channel, vozPorSala, Date.now()),
    [vozPorSala],
  )
  const presencaNaVozDaBarra = useCallback(
    (room: string): PresenteNaVoz[] => {
      if (!active) return []
      /**
       * In the room we are in, the call peers: they come from the connections
       * this device has open, and that is the most reliable source.
       *
       * In other rooms, whoever announced and did not say goodbye. Less
       * reliable, and on purpose, a presence indicator that only worked
       * in the room we are already in would indicate nothing, because it
       * is exactly in other rooms that it serves a purpose.
       */
      if (callChannel === active && callRoom === room) {
        /**
         * Us first, then the peers.
         *
         * `participants` are the connections this device has open, so they
         * never include us, and without this line someone entering an
         * empty room saw nobody, not even themselves. They would not know
         * if they got in. It is also what lets an admin drag us to another
         * room: you can only drag someone on the list.
         */
        /* `presence`: the ring color. Without it the room painted everyone green,
           including those who chose "busy". */
        /* `transmite`: the broadcast signal next to the face. Known here, from
           participants and our screen and audio; in other rooms it comes
           from the announcement (`transmitePorSala`, phase 1i). */
        const euTransmito: Transmissao | undefined =
          screenStream !== null && minhaMusica
            ? "ecra+musica"
            : screenStream !== null
              ? "ecra"
              : minhaMusica
                ? "musica"
                : undefined
        const eu = address
          ? [
              {
                address,
                name: nameFor(address),
                profile: directory.get(address),
                presence: presenceFor(address),
                ...(euTransmito ? { transmite: euTransmito } : {}),
                calado: micMuted,
                semSom: soundOff,
              },
            ]
          : []
        /* `naSalaDaChamada` and not just `participants`: whoever announced and
           still has no media up is also in the room, and that is the
           window where the list stayed empty on entry. The broadcast signal is only known for those with media
           already. */
        return [
          ...eu,
          ...naSalaDaChamada
            .filter((quem) => quem !== address)
            .map((quem) => {
              const participante = participants.find((p) => p.address === quem)
              const transmite = participante ? transmissaoDe(participante) : undefined
              return {
                address: quem,
                name: nameFor(quem),
                profile: directory.get(quem),
                presence: presenceFor(quem),
                ...(transmite ? { transmite } : {}),
                ...(participante ? { calado: participante.micMuted } : {}),
              }
            }),
        ]
      }
      const laDentro = vozPorSala.get(chaveDaSala(active, room))
      if (!laDentro) return []
      // The broadcast signal from other rooms comes from the announcement (phase 1i).
      const transmitem = transmitePorSala.get(chaveDaSala(active, room))
      // Discarded on read, not just on write: with no more events coming in,
      // a stale presence would never be cleaned up, and that is exactly the
      // case for someone who left without saying goodbye.
      return [...presencasVivas(laDentro, Date.now()).keys()]
        .filter((quem) => quem !== address)
        .map((quem) => {
          const transmite = transmitem?.get(quem)
          return {
            address: quem,
            name: nameFor(quem),
            profile: directory.get(quem),
            presence: presenceFor(quem),
            ...(transmite ? { transmite } : {}),
          }
        })
    },
    [active, callChannel, callRoom, screenStream, minhaMusica, micMuted, soundOff, address, nameFor, directory, presenceFor, naSalaDaChamada, participants, vozPorSala, transmitePorSala],
  )
  /** "New room" already in a category: its `+` in the sidebar, or its menu (1.3.25). */
  const abrirNovaSalaNaCategoria = (category: string): void => {
    if (!active) return
    setCategoriaDaNovaSala(category)
    setNovaSalaEm(active)
  }
  /** The sheet closes: the next "New room" starts in no category. */
  const fecharNovaSala = (): void => {
    setNovaSalaEm(null)
    setCategoriaDaNovaSala("")
  }
  const barra = {
    abrirSala: useEstavel((room: string) => {
      // A room is a different place: the person's page moves out of the way.
      fecharPessoa()
      abrirSala(room)
      // On the phone, a room tapped in the list pushes its conversation.
      setConversaNoTelemovel(true)
    }),
    menuDaVoz: useEstavel((room: string, who: string, at: { x: number; y: number }) => setVozMenu({ room, address: who, at })),
    moverPessoa: useEstavel((who: string, room: string, de?: string) => moverPessoa(who, room, de)),
    arrumarSala: useEstavel((arrastado: string, destino: { antesDe: string } | { categoria: string }) => arrumarSala(arrastado, destino)),
    arrumarCategoria: useEstavel((arrastada: string, alvo: string) => arrumarCategoria(arrastada, alvo)),
    reabrirSala: useEstavel((room: string) => reabrirSala(room)),
    eliminarSala: useEstavel((room: string) => eliminarSala(room)),
    menuDaSala: useEstavel((room: string, at: { x: number; y: number }) => setRoomMenu({ room, at })),
    menuDaCategoria: useEstavel((category: string, at: { x: number; y: number }) => setCategoriaMenu({ category, at })),
    novaSala: useEstavel(() => {
      if (active) setNovaSalaEm(active)
    }),
    novaSalaNaCategoria: useEstavel((category: string) => abrirNovaSalaNaCategoria(category)),
    fechar: useEstavel(() => setSidebarOpen(false)),
    escolherCanal: useEstavel((channel: string) => {
      // The sidebar lists channels and only channels, and picking one goes to
      // their destination: without the `setView`, picking from Friends would
      // light the channel and keep showing the direct message next to it.
      setCanal(channel)
      setView("chat")
      /*
        The drawer only leaves when the channel has nothing more to say.
        
        This is where the phone got lost. Rooms in a channel draw below
        the OPEN channel, and this tap is what opens it, but it closed
        the drawer in the same gesture, so the tree appeared behind the
        panel sliding out. You read "this channel has no rooms", and a
        channel with rooms became a channel with one conversation only.
        
        A channel with a tree stays with the drawer open, which is where
        rooms are now. A channel without a tree already gave up everything
        it had (the conversation), and the drawer leaves it alone. Who
        closes the drawer in the first case is `abrirSala`, at the end of
        the path. A channel whose rooms have not arrived yet also stays: see
        `gavetaSaiAoTocar`.
        */
      if (gavetaSaiAoTocar(channel)) setSidebarOpen(false)
    }),
    menuDoCanal: useEstavel((channel: string, at: { x: number; y: number }) => setMenu({ channel, at })),
    editarPerfil: useEstavel(() => setEditingProfile(true)),
    menuDoMicrofone: useEstavel((at: { x: number; y: number }) => setAudioMenu({ qual: "mic", at })),
    menuDoSom: useEstavel((at: { x: number; y: number }) => setAudioMenu({ qual: "som", at })),
    abrirDefinicoes: useEstavel(() => setView("config")),
    latencia: useEstavel((dentro: boolean) => (dentro ? comecarLatencia() : pararLatencia())),
    // Defined further down, after the gate's early return; called only on events.
    guardarEstado: useEstavel((statusText: string) => guardarEstado(statusText)),
  }

  /** The screen pushed over the list, for the swipe from the left edge. */
  const ecraEmpurrado = useRef<HTMLDivElement>(null)
  /* On the phone, what is under a pushed screen stays mounted (its scroll
     stays) and out of reach. Before the gate's early return: it is a hook. */
  useEffect(() => {
    /* Also on a computer: a window that grows past 840 px with a conversation
       pushed must give the column back its clicks. */
    const coberta = telemovel && (profundidade > 0 || pessoa !== null)
    for (const lista of document.querySelectorAll<HTMLElement>(
      ".app :is(.carril-comunidades, .sidebar, .people-aside, .menu-do-tu)",
    )) {
      if (lista.inert !== coberta) lista.inert = coberta
    }
  })

  /*
    After the gate enters, the opening stays over the layout until the session
    is online and `POST_LOGIN_EXTRA_MS` have passed, capped at
    `POST_LOGIN_CAP_MS`. A hook, so before the early return.
  */
  const aSegurarAbertura = usePostLoginHold(entrada, connection === "online")

  if (stage !== "ready" || aSegurarAbertura) {
    // "ready" here only while the opening holds after entering.
    const abertura = stage === "loading" || stage === "ready"
    // One line, and discreet: the gate remains the gate. It only says that the
    // link was read and that it was not lost because there was still no open account.
    // The invite link the page opened with goes into the code field of "Criar conta" (1.3.26).
    const conviteParaOCampo = conviteAEspera
      ? formatInviteLink(conviteAEspera.server, conviteAEspera.channel, conviteAEspera.code)
      : (conviteCurtoAEspera ?? "")
    // The removed device has its own screen; only a pairing that never finished keeps the line.
    const avisoDoConvite = aparelhoRevogado && emparelhamentoPorAcabar && stage !== "removido"
      ? translateError("pairing-unfinished")
      : lockedMidSync && stage === "unlock"
        ? strings.sincronia.historyLockedMidSync
        : conviteInvalido
        ? strings.invite.gateInvalid
        : conviteAEspera || conviteCurtoAEspera
          ? strings.invite.gateWaiting
          : avisoDeEmparelhamento
    return (
      <>
        {avisoDoConvite && !abertura && (
          <p className="gate-convite" role="status">
            {avisoDoConvite}
          </p>
        )}
        {abertura ? (
          <Splash />
        ) : stage === "error" ? (
          <GateError detail={bootError} onRetry={checkVault} />
        ) : stage === "setup" ? (
          <Setup
            key={telaDoSetup}
            telaInicial={telaDoSetup}
            conviteInicial={conviteParaOCampo}
            onDone={(addr) => enter(addr)}
            onUnlockInstead={() => setStage("unlock")}
            onJoinInstead={() => setStage("emparelhar")}
          />
        ) : stage === "removido" ? (
          <AparelhoRemovido
            onFicheiro={() => sairDoAparelhoRemovido("ficheiro")}
            onOutroAparelho={() => sairDoAparelhoRemovido("outro-aparelho")}
          />
        ) : stage === "suspensa" ? (
          <ContaSuspensa
            aviso={avisoDeSuspensao}
            onPedirRevisao={async (nota) => {
              const pedir = bridge.denuncias?.pedirRevisao
              if (!pedir) throw new Error("the server did not take the review request")
              await pedir(nota)
            }}
            onTentarOutraVez={() => {
              // Again like at the gate: still suspended, the status puts the
              // warning back (`enter` reads the ref); lifted, it enters; no network, it enters
              // with the connection banner saying why.
              const addr = address ?? ""
              contaSuspensaRef.current = false
              setStage("loading")
              void bridge.session.connect().then(
                () => enter(addr),
                (erro: Error) => enter(addr, erro),
              )
            }}
          />
        ) : stage === "saiu-de-beta" ? (
          // Before the `Unlock` branch, which is the default: see `checkVault`.
          <SaiuDeBeta onCriarContaNova={criarContaNovaDoBeta} />
        ) : stage === "emparelhar" ? (
          <Emparelhar
            linkInicial={emparelhamentoDeArranque?.link ?? null}
            onDone={(addr) => {
              emparelhamentoDeArranque?.forget()
              /*
                A paired device joins an account that already lives on another
                device: the account file is that device's to save, like an
                imported account. Without this, the one-time notice opened on
                every freshly paired phone, over the app.
              */
              void marcarFicheiroTratado(addr).finally(() => enter(addr))
            }}
            onBack={() => {
              emparelhamentoDeArranque?.forget()
              /*
                A pairing left in an account added by "Usar outra conta" removes its
                empty vault, and that account leaves the list: the one from before is
                active again. Reload into it, as switching account does.
              */
              void bridge.vault
                .status()
                .then(({ exists }) => {
                  if (exists) pagina.recarregar()
                  else {
                    setTelaDoSetup("entrada")
                    setStage("setup")
                  }
                })
                .catch(() => {
                  setTelaDoSetup("entrada")
                  setStage("setup")
                })
            }}
          />
        ) : (
          <Unlock key={vezDoPortao} onDone={enter} onLigacaoFalhou={anotarLigacaoFalhada} />
        )}
      </>
    )
  }

  /**
   * The conversation screen, mounted once and used by two destinations.
   *
   * A channel opens it in "Conversations"; a direct message opens it inside
   * Friends, below the banner. It is the SAME element, with the same props, all
   * derived from `active`, which already knows which of the two conversations is in front.
   *
   * Written once and not twice on purpose: there are forty props, and two
   * copies would diverge on the first one someone added to either of them. The symptom
   * would be a direct conversation without a saved draft, or without loading old history,
   * and nobody would look for the cause here.
   */


  /**
   * The screen of a polls room (`layout: "polls"`): polls as cards and no conversation, in the slot of
   * the chat. A layout this version does not know shows the chat, which is what an older client sees.
   *
   * Creating needs the same right as writing in the room (roles and "read only" included): the
   * button is absent otherwise. Closing is the author's or a moderator's.
   */
  const ecraDasVotacoes =
    active === null || salaAberta?.layout !== "polls" ? null : (
      <SalaDeVotacoes
        nome={salaAberta.name}
        votacoes={votacoesDaSala}
        rastos={rastosDaSala}
        nameFor={nameFor}
        {...(bridge.votacoes ? { onVotar: votarNaConversa } : {})}
        podeFechar={(votacao) =>
          bridge.channels.editMessage !== undefined &&
          (votacao.message.sender === address || (bridge.channels.mayModerate?.(active, address ?? "") ?? false))
        }
        onFechar={(votacao) => {
          void bridge.channels
            .editMessage?.(active, votacao.id, votacao.message.payload.body ?? "", { closePoll: true })
            .then(() => pushToast(strings.votacao.fecharFeito))
            .catch((error: Error) => pushToast(traduzirErro(error), "error"))
        }}
        {...(address !== null &&
        (bridge.channels.permissoes?.em(active, address, { sala: activeRoom }).includes("escrever") ?? true) &&
        podeCriarVotacoes &&
        bridge.votacoes
          ? { onNova: () => setVotacaoNoCanal(active) }
          : {})}
        {...(bridge.channels.deleteMessage
          ? {
              podeEliminar: (votacao: VotacaoListada) =>
                votacao.message.sender === address || (bridge.channels.mayModerate?.(active, address ?? "") ?? false),
              onEliminar: (votacao: VotacaoListada) => eliminarVotacao(active, votacao.message),
            }
          : {})}
      />
    )

  /**
   * The ticket board, when the open room is a ticket room.
   *
   * It sits next to the conversation screen and not inside it: `ChatScreen` shows what was
   * SAID, in order, and a ticket board shows what needs to be
   * DONE. Putting the two in the same component was putting a fork in the middle of
   * forty props that have nothing to do with it.
   *
   * A layout that this version does not know falls back to the conversation screen, which is what
   * the room is underneath. See `layout` in `channel.meta`.
   */
  const ecraDosTickets =
    active === null || salaAberta?.layout !== "tickets" ? null : (
      <TicketsScreen
        tickets={tickets}
        linhas={linhasDoTicket}
        /* No account yet, nobody listens to anything: the empty string is not equal to
           any address, and that is what the screen needs to know. */
        me={address ?? ""}
        nameFor={nameFor}
        mayAttend={bridge.channels.mayAttend?.(active) ?? false}
        /* The real refusal is in the core. This just avoids offering a gesture that
           will be refused, the same rule as context menus. */
        mayDecide={(ticket) => bridge.channels.mayDecideTicket?.(active, activeRoom, ticket) ?? false}
        aberto={ticketAberto}
        onAbrir={(ticket) => setTicketsAbertos((antes) => ({ ...antes, [chaveDoTicket]: ticket }))}
        onNovo={async (subject) => {
          await bridge.channels.openTicket?.(active, activeRoom, subject)
        }}
        onResponder={async (ticket, body) => {
          await bridge.channels.replyToTicket?.(active, activeRoom, ticket, body)
        }}
        onEstado={async (ticket, state) => {
          await bridge.channels.setTicketState?.(active, activeRoom, ticket, state)
        }}
        onAtender={async (ticket) => {
          await bridge.channels.takeTicket?.(active, activeRoom, ticket)
        }}
        onLargar={async (ticket) => {
          await bridge.channels.releaseTicket?.(active, activeRoom, ticket)
        }}
        /* Phase 3: the moderator deletes a closed ticket. */
        mayModerate={address !== null && (bridge.channels.mayModerate?.(active, address) ?? false)}
        {...(bridge.channels.deleteTicket
          ? {
              onEliminar: async (ticket: string) => {
                await bridge.channels.deleteTicket?.(active, activeRoom, ticket)
              },
            }
          : {})}
      />
    )

  /**
   * The call panel is ACTUALLY mounted, not just "the conversation is what you see".
   *
   * The panel lives inside `ChatScreen`, and `ChatScreen` is not the only
   * occupant of the conversation destination: a ticket board takes its place. The dock asked
   * `conversaNoEcra`, which stays true with the board in front, and so it did not mount. The call
   * had no panel and no dock, that is, no single media element: the sound died, the cards
   * disappeared, and from inside that reads as having left the voice room.
   * That was the bug report.
   *
   * Four conditions because four are what the panel requires: the destination
   * shows the conversation, the conversation is the one where the call is happening, the panel
   * was not pulled out, and nothing is on top of it.
   */
  /**
   * How the call appears in the open conversation.
   *
   * From the window to Discord (visual phase): a voice room call only appears
   * when THAT room is open, and it occupies the main area (`sala`).
   * In a direct conversation it sits on top (`faixa`). In another room of
   * the same channel it does not appear: the card in the sidebar shows it (and plays the sound), or the dock.
   */
  const vistaDaChamada: "sala" | "faixa" | null =
    callChannel === null || active !== callChannel
      ? null
      : isDirect(callChannel)
        ? "faixa"
        : activeRoom === callRoom
          ? "sala"
          : null
  const painelDaChamadaNoEcra =
    conversaNoEcra && vistaDaChamada !== null && !callPopup && ecraDosTickets === null && ecraDasVotacoes === null && !escolhaNoEcra

  /**
   * Save the written state, with real rollback.
   *
   * Optimistic, with a real rollback: a failed save must not leave the screen
   * claiming a status nobody else will ever see.
   */
  const guardarEstado = (statusText: string): void => {
    const previous = profile
    const next = { ...profile, statusText }
    setProfile(next)
    void bridge.profile.set(next).catch((error: Error) => {
      setProfile(previous)
      pushToast(traduzirErro(error), "error")
    })
  }

  const ecraDaConversa = (
    <ChatScreen
      active={active}
      /* The phone (option B): the back arrow in the header, and the members as a
         pushed screen with its own history entry. Absent on a computer. */
      {...(telemovel
        ? {
            onVoltar: voltarNoTelemovel,
            membrosAbertos: membrosNoTelemovel,
            onMembrosAbertos: (abertos: boolean) => setMembrosDe(abertos ? active : null),
          }
        : {})}
      /* The ones the room was already showing by presence: the call panel draws them
         "connecting" until the media arrives, instead of hiding them.
         See `aLigar` in ChatScreen. */
      presentesNaSala={naSalaDaChamada}
      callChannel={callChannel}
      /* Screen sharing is a role power (12/11/2026). Read on each render, like the
         read-only bar: a role given mid-call frees the button without reload. An
         older host without the permissions model keeps the button as it was. */
      semTransmitir={callChannel !== null && bridge.channels.mayTransmit?.(callChannel, callRoom) === false}
      setCallChannel={setCallChannel}
      setCallRoom={setCallRoom}
      ringing={ringing}
      participants={participants}
      localStream={localStream}
      screenStream={screenStream}
      profile={profile}
      address={address}
      messages={visible}
      pins={fixadasDaSala}
      callPopup={callPopup}
      onCallPopup={() => setCallPopup(true)}
      vistaDaChamada={vistaDaChamada}
      tituloDaChamada={callChannel === null ? undefined : (salaDaDoca ?? labelFor(callChannel))}
      soPalco={soPalco}
      onSoPalco={() => setSoPalco((aberto) => !aberto)}
      /* The same two states that the sidebar card draws.
         One source only: the panel shows, never decides. */
      micMuted={micMuted}
      soundOff={soundOff}
      onToggleMic={alternarMicrofone}
      onToggleSound={alternarSom}
      /* In the installed app there are two things between the click and the capture: the
         macOS permission and someone who chooses the window. In the browser this
         gesture is the usual `startScreenShare`. See `usePartilhaDeEcra`. */
      onShareScreen={pedirPartilhaDeEcra}
      cameraOff={cameraOff}
      onToggleCamera={alternarCamara}
      members={membrosDaSalaAberta}
      membersState={membersState}
      onRetryMembers={retryMembers}
      directory={directory}
      nameFor={nameFor}
      connection={connection}
      connectionDetail={connectionDetail}
      outbox={outbox.entries.filter((entry) => entry.channel === active)}
      surda={active !== null && canaisSurdos.has(active)}
      onSend={(channel, body, extras) => {
        sendMessage(channel, body, activeRoom || undefined, extras)
        // The response went out: the bar closes. A message without `replyTo` leaves it open.
        if (extras?.replyTo) cancelarResposta()
      }}
      onRetryEntry={outbox.retry}
      onDiscardEntry={outbox.discard}
      draft={draftFor(active)}
      onDraftChange={setDraft}
      activeRoom={activeRoom}
      onPrompt={setPrompt}
      canCreateChannel={canCreateChannel}
      /* The single sheet for inviting, with this conversation's channel filled in. The
         member header and footer open it the same way. */
      onConvidar={(modo) => {
        if (active && !isDirect(active)) setConvidar({ channel: active, ...(modo ? { modo } : {}) })
      }}
      hasStoredHistory={active !== null && seededChannels.has(active)}
      canLoadOlder={active !== null && olderAvailable.get(active) === true}
      inicioDoAparelho={active !== null && inicioDoAparelho.has(active)}
      onLoadOlder={() =>
        active &&
        loadOlder(
          active,
          (message) => message.payload.t === "message" && salaDeLeitura((message.payload as { room?: string }).room ?? "") === activeRoom,
          activeRoom,
        )
      }
      labelFor={labelFor}
      iconFor={iconFor}
      oficial={active !== null && oficialFor(active)}
      /* The "announcements" room of the official channel reads like release notes.
         Text only, so a voice room with that name stays called that. */
      notasDeVersao={
        active !== null &&
        oficialFor(active) &&
        salaAberta?.kind === "text" &&
        ehSalaDeAnuncios(salaAberta.name)
      }
      /* The two call facts that the core only told the log. */
      caminhoDeMedia={caminhoDeMedia}
      avisoDeChamada={avisoDeChamada}
      onDispensarAviso={() => setAvisoDeChamada(null)}
      salaAfkAberta={salaAberta?.afk !== undefined}
      chamadaNaSalaAfk={chamadaNaSalaAfk}
      avisoAfk={avisoAfkDoPainel}
      salaDaChamada={salaDaChamada}
      roleFor={roleFor}
      apelidoDe={apelidoDe}
      menuDaPessoaNaChamada={menuDaPessoaNaChamada}
      presenceFor={presenceFor}
      presenceHint={presenceHint}
      emChamada={emChamada}
      onOpenProfile={(who) => openProfile(who, active)}
      onUserMenu={(who, at) => setUserMenu({ address: who, channel: active, at })}
      apuramentos={apuramentosDoCanal}
      onVotar={votarNaConversa}
      reaccoes={reaccoesDoCanal}
      ocultar={ocultarBloqueada}
      etiquetas={etiquetasDaConversa}
      {...(bridge.channels.react ? { onReagir: reagirNaConversa } : {})}
      onVotacao={podeCriarVotacoes ? () => setVotacaoNoCanal(active) : undefined}
      onEliminarVotacao={(message: ChatMessage) => {
        if (active) eliminarVotacao(active, message)
      }}
      meuNome={profile.displayName || undefined}
      onSaveStatus={guardarEstado}
      pedidoDe={pedidoDe}
      pedidoOcupado={respondendo}
      onPedidoResposta={responderPedido}
      procura={procuraDaConversa}
      procuraAberta={procuraAberta}
      /* Opening the search clears the previous selection.
       *
       * Without this, going back to the sheet and hitting the SAME result did nothing:
       * the state already had that identifier, no effect ran again,
       * and the button looked broken. Clearing the selection on open also makes sense
       * on its own, the mark is for finding the line after the jump, and whoever
       * reopens the search is not looking at it anymore. */
      onProcuraAberta={(aberta) => {
        setProcuraAberta(aberta)
        if (aberta) setDestacada(null)
      }}
      onSaltarPara={saltarParaMensagem}
      nomeDaSala={nomeDaSalaDoCanal}
      destacada={destacada}
      resposta={respostaAberta}
      onResponder={responderA}
      onAlternarMencao={alternarMencaoDaResposta}
      onCancelarResposta={cancelarResposta}
      citacaoDe={citacaoDoCanal}
      onIrParaOriginal={irParaOriginal}
      onAbrirFixada={abrirFixada}
      /* The friend request from this conversation, standing on top of it and outside the
         scrolling list. A single card, and this is it: see `pedidoDeAmizade`. */
      pedidoDeAmizade={pedidoDeAmizade}
      escritaTrancada={escritaTrancada}
      directaBloqueada={trancaDaEscrita?.bloqueado === true}
      onResponderAmizade={responderAmizade}
      {...(trancaDaEscrita?.pedirA
        ? {
            onPedirAmizade: () => {
              if (trancaDaEscrita.pedirA) void amizade.pedir(trancaDaEscrita.pedirA)
            },
          }
        : {})}
    />
  )


  /**
   * The menu of a direct conversation, the same in both destinations.
   *
   * The channel bar used the channel menu (with "Leave channel" and
   * "Properties"), and Friends used this one. A two-person conversation does not get left
   * and has no properties: it closes, and comes back when a message arrives.
   *
   * The conversation's channel travels with the profile: that is what gives the page the
   * security number, which comes from the keys of the two people in the group.
   */
  const itensDeUmaDirecta = (channel: string): MenuItem[] => {
    const quem = dmPeerAddress(channel, address)
    // The call by the same rule as writing: friends only, or in community mode.
    const podeChamar =
      quem !== null &&
      (community.has(quem) ||
        estadoDaAmizade(quem, address, friendships.ties.get(quem), amigoDeFacto(quem)) === "amigos")
    return itensDaConversa({
      ehAberta: view === "pessoas" && channel === directa,
      porLer: (unreads.get(channel) ?? 0) > 0,
      pessoa: quem,
      emChamada: callChannel === channel,
      podeChamar,
      silencio: { silenciado: silenciados.includes(channel), alternar: () => alternarSilencio(channel) },
      accoes: {
        abrir: () => abrirConversa(channel),
        marcarLida: () => darPorLido(channel),
        fechar: () => fecharDirecta(channel),
        verPerfil: () => {
          if (quem) openProfile(quem, channel)
        },
        entrarNaChamada: () => entrarNaChamada(channel),
        entrarComVideo: () => entrarNaChamada(channel, true),
        sairDaChamada: () => leaveCall(),
      },
    })
  }

  /**
   * The account card, mounted once for the two columns that show it.
   *
   * The channel bar takes it to the bottom in Profile, Conversations, Social and
   * Settings; the conversation column takes it in Friends, which no longer has
   * a channel bar. It is the same element and the same decision in both, the bell, the
   * identity and the microphone cannot answer differently depending on
   * which destination you are in.
   */
  const cartaoDaConta = (
    <CartaoDaConta
      profile={profile}
      address={address}
      activity={activity}
      ligacao={connection}
      onActivityMenu={setActivityMenu}
      onEditProfile={() => setEditingProfile(true)}
      onNotifications={setNotifAt}
      unreadNotifications={unreadCountOf(notificacoesVisiveis) + ofertas.length}
      avisaDeNotificacao={sinoAvisa}
      micMuted={micMuted}
      soundOff={soundOff}
      onToggleMic={alternarMicrofone}
      onToggleSound={alternarSom}
      onMicMenu={(at) => setAudioMenu({ qual: "mic", at })}
      onSoundMenu={(at) => setAudioMenu({ qual: "som", at })}
      onAbrirDefinicoes={() => setView("config")}
      latencia={latencia}
      onLatenciaHover={(dentro) => (dentro ? comecarLatencia() : pararLatencia())}
      onSaveStatus={guardarEstado}
      pedidoDeEstado={pedidoDeEstado}
      /* The face itself pulses while this device is in a call. */
      emChamada={callChannel !== null}
    />
  )

  /**
   * The drawer of this destination, so the rail button knows what to open.
   *
   * On a narrow screen there is one drawer per destination, not one: in Friends it is the
   * conversation list, in all others it is the channel bar. Without this
   * distinction the rail button would keep opening a bar that in Friends is no longer drawn, a button that leads nowhere, which is exactly what
   * this product does not do.
   */

  /**
   * A tab, by hand. Each tab keeps its own stack: the open conversation of
   * Communities, the direct conversation of Messages, the screen of "Tu".
   * Tapping the open tab again goes back to its list.
   */
  const escolherSeparador = (seguinte: Separador): void => {
    guardarRolagem(separador)
    if (seguinte === separador) {
      fecharPessoa()
      voltarAte(0)
      return
    }
    setSeparadorEscolhido(seguinte)
    if (seguinte === "comunidades") setView("chat", "separador")
    else if (seguinte === "tu") setView(ecraDoTu, "separador")
    else {
      setView("pessoas", "separador")
      if (seguinte === "amigos") {
        // The open direct conversation waits in Messages, for the way back.
        if (directa !== null) directaGuardada.current = directa
        setDirecta(null)
      } else if (directa === null && directaGuardada.current !== null) {
        setDirecta(directaGuardada.current)
        directaGuardada.current = null
      }
    }
  }

  /**
   * The notices of the four tabs: the rail's notices, sorted by where each
   * thing is handled on the phone. Direct conversations (and their nudges and
   * calls) are in Messages; friend requests in Friends; the bell and the
   * comments on my posts in "Tu".
   */
  const avisosDosSeparadores = {
    comunidades: { quantas: mencoesEmCanais, porLer: porLerEmCanais > 0, chamada: chamadaEm === "chat" },
    mensagens: {
      quantas: porDestino.contactos,
      toque: avisosDosAmigos.toque,
      chamada: chamadaEm === "pessoas",
    },
    amigos: { quantas: openRequests.length },
    tu: { quantas: comentariosNoMural + unreadCountOf(notificacoesVisiveis) + ofertas.length },
  }
  /** One community's notices on the phone rail: the same shapes as the main rail. */
  const avisosDaComunidade = (canalDaLista: string): { quantas: number; porLer: boolean; chamada: boolean } => {
    let quantas = 0
    for (const conta of porLerPorSala.get(canalDaLista)?.values() ?? []) quantas += conta.mencoes
    return {
      quantas,
      porLer: (porLerNosCanais.get(canalDaLista) ?? 0) > 0,
      chamada: callChannel === canalDaLista || (ringing.get(canalDaLista)?.size ?? 0) > 0,
    }
  }
  /** A pushed screen: the edge that swipes back, and the motion it enters with. */
  const empurrado = (conteudo: React.ReactNode, barra?: React.ReactNode): React.JSX.Element => (
    <div className="ecra-empurrado" ref={ecraEmpurrado}>
      <BordaDeVoltar alvo={ecraEmpurrado} onVoltar={voltarNoTelemovel} />
      {barra}
      {conteudo}
    </div>
  )
  const nomesDoTu: Record<"perfil" | "social" | "config", string> = {
    perfil: strings.telemovel.perfil,
    social: strings.telemovel.mural,
    config: strings.telemovel.definicoes,
  }
  /** A screen of "Tu" on the phone: pushed over its list, with the bar back. On a computer, as it is. */
  const noTu = (ecra: React.JSX.Element): React.JSX.Element =>
    telemovel && (view === "perfil" || view === "social" || view === "config")
      ? empurrado(ecra, <BarraDoTelemovel titulo={nomesDoTu[view]} onVoltar={voltarNoTelemovel} />)
      : ecra

  /** The bar of tabs: on a list, never over a conversation or a person's page. */
  const mostrarSeparadores = telemovel && !naConversa && !pessoa

  const gavetaAberta = view === "pessoas" ? listaAberta : sidebarOpen
  const alternarGaveta = (): void => {
    if (view === "pessoas") setListaAberta((aberta) => !aberta)
    else setSidebarOpen((aberto) => !aberto)
  }

  /**
   * The call dock, in its two forms.
   *
   * The sound from a call lives in media elements, and an element dies with the
   * component: there is always ONE sound owner mounted. The panel, when it is on
   * screen; otherwise the dock.
   *
   * On a wide screen, with the sidebar in view, the dock is the call box
   * in the middle of the control panel, at the bottom of it (P1, 28 October 2026),
   * and stays there even with the call panel on screen, just without sound. On phone, in Friends (which has no sidebar) and
   * with "Open in a window", it is the compact bar that floats.
   */
  const docaLateral = ecraLargo && view !== "pessoas" && !callPopup && !soPalco
  const docaFlutuante = !docaLateral && !painelDaChamadaNoEcra
  const docaDaChamada = (variante: "flutuante" | "lateral"): React.JSX.Element | null =>
    callChannel === null ? null : (
      <CallDock
        variante={variante}
        comAudio={!painelDaChamadaNoEcra}
        channel={callChannel}
        channelLabel={labelFor(callChannel)}
        /* The place where the call happens, not just the channel: with two voice
           rooms open, "channel" alone does not tell them apart. */
        roomLabel={salaDaDoca}
        /* The ping on the side card, the same size as the account banner. */
        latencia={latencia}
        /* Only our share turns it on: whoever reads the dock needs to know if
           it is the screen itself that is going live. */
        aPartilharEcra={screenStream !== null}
        participants={participants}
        localStream={localStream}
        nameFor={nameFor}
        /* This one plays the sound when the panel is off screen. Without
           this, muting the sound would silence the panel and the dock would
           keep talking, the card saying "muted" and sound coming out. */
        soundOff={soundOff}
        micMuted={micMuted}
        /* There is no microphone in the AFK room: the button leaves the dock. */
        {...(chamadaNaSalaAfk ? {} : { onToggleMic: alternarMicrofone })}
        onBack={() => {
          setCallPopup(false)
          // Go back to where that conversation lives: a two-person call is in
          // Friends, and sending it to "Conversations" opened a call panel without
          // the conversation it belonged to. In a channel, it goes back to the ROOM
          // of the call, which is where you see the call.
          if (!isDirect(callChannel)) setActiveRooms((actual) => ({ ...actual, [callChannel]: callRoom }))
          abrirConversa(callChannel)
        }}
        onLeave={leaveCall}
      />
    )

  return (
    // Each screen's "No connection" banner reads the button and the outage time
    // from here. See `LigacaoContext`. Left the rest indented as is, so the diff
    // shows only this.
    <LigacaoContext.Provider value={ligacaoDaFaixa}>
    <FaixaDoFicheiroContext.Provider value={faixaDoFicheiro}>
    <ErrorBoundary bridge={bridge} connection={connection}>
      {/* Without the channel bar the grid has two columns instead of three: auto
          placement fills them in order, and the destination would end up in the
          236px column with the `1fr` one empty next to it. See `.app.sem-barra`. */}
      <div
        className={`${view === "pessoas" ? "app sem-barra" : "app"}${soPalco && painelDaChamadaNoEcra ? " so-palco" : ""}${telemovel ? " telemovel" : ""}${nudgeShaking ? " buzzing" : ""}`}
        /* The phone layout reads these: which tab, how many screens over its list,
           and whether the bar of tabs is on screen. See `styles/telemovel.css`. */
        data-separador={telemovel ? separador : undefined}
        data-profundidade={telemovel ? profundidade : undefined}
        data-separadores={telemovel ? (mostrarSeparadores ? "sim" : "nao") : undefined}
      >
        <nav className="rail">
          {/* The connection dropped after being online: the mark fades and takes
              an amber seal with "!" (20/11/2026). Not before the first
              connection: starting up is not a drop. The banner over the
              conversation says the rest; here the words are for readers. */}
          <span className={caiuEm === null ? "rail-logo" : "rail-logo sem-ligacao"} title="Orwell">
            <OrwellMark size={24} />
            {caiuEm !== null && (
              <>
                <span className="rail-offline" aria-hidden="true">
                  <GlifoSemLigacao />
                </span>
                <span className="sr-only">{strings.rail.semLigacao}</span>
              </>
            )}
          </span>
          {/* Only exists on narrow screens (CSS-hidden when the sidebar is a
              plain column): opens this destination's drawer over the content.
              In Friends that drawer is the conversation list, see `gavetaAberta`. */}
          <button
            className="rail-btn rail-menu"
            data-tip={strings.rail.menu}
            data-tip-side="right"
            aria-label={strings.rail.menu}
            aria-expanded={gavetaAberta}
            onClick={alternarGaveta}
          >
            <MenuIcon />
          </button>
          <button
            className={view === "perfil" ? "rail-btn active" : "rail-btn"}
            data-tip={strings.rail.profile}
            data-tip-side="right"
            aria-label={strings.rail.profile}
            aria-current={view === "perfil" ? "page" : undefined}
            onClick={() => setView("perfil")}
          >
            <PersonIcon />
          </button>
          {/* The notices of each destination: the pill for unread, the number for
              what waits for you, the glyph for a nudge, the green seal for a
              call. See `components/AvisosDoCarril.tsx`. */}
          <button
            className={classeDoBotaoDoCarril({ activo: view === "chat", toque: false })}
            data-tip={strings.rail.chat}
            data-tip-side="right"
            aria-label={strings.rail.chat}
            aria-describedby={descricaoDoCarril(avisosDosCanais)}
            aria-current={view === "chat" ? "page" : undefined}
            onClick={() => setView("chat")}
          >
            <ChatIcon />
            <AvisosDoCarril {...avisosDosCanais} />
          </button>
          <button
            className={classeDoBotaoDoCarril({ activo: view === "social", toque: false })}
            data-tip={strings.rail.social}
            data-tip-side="right"
            aria-label={strings.rail.social}
            aria-describedby={descricaoDoCarril(avisosDoSocial)}
            aria-current={view === "social" ? "page" : undefined}
            onClick={() => setView("social")}
          >
            <FeedIcon />
            <AvisosDoCarril {...avisosDoSocial} />
          </button>
          <button
            className={classeDoBotaoDoCarril({ activo: view === "pessoas", toque: toquePorVer })}
            data-tip={strings.rail.people}
            data-tip-side="right"
            aria-label={strings.rail.people}
            aria-describedby={descricaoDoCarril(avisosDosAmigos)}
            aria-current={view === "pessoas" ? "page" : undefined}
            onClick={() => setView("pessoas")}
          >
            <FriendsIcon />
            <AvisosDoCarril {...avisosDosAmigos} />
          </button>
          <div className="rail-spacer" />
          <button
            className={view === "config" ? "rail-btn active" : "rail-btn"}
            data-tip={strings.rail.settings}
            data-tip-side="right"
            aria-label={strings.rail.settings}
            aria-current={view === "config" ? "page" : undefined}
            onClick={() => setView("config")}
          >
            <GearIcon />
          </button>
        </nav>

        {/* Click-away for the drawer. Only rendered while open; CSS removes
            it entirely on wide screens, where the sidebar is a column.

            And only where the drawer exists: in Friends there is no channel
            bar, and a veil over the screen with nothing behind it is a locked
            app. Friends has its own veil, inside the destination. */}
        {sidebarOpen && view !== "pessoas" && !telemovel && (
          <div className="drawer-scrim" aria-hidden="true" onMouseDown={() => setSidebarOpen(false)} />
        )}

        {/*
          The channel bar, in every destination but Friends.
          
          There it had the header repeating the banner text and the body empty:
          236px of frame before the conversations, with "Friends" written
          twice. The code that lists Friends conversations is `FriendsAside`,
          which was already there.
          */}
        {/* The phone: the 72 px rail of communities, at the left of the chosen one's channels. */}
        {telemovel && view === "chat" && (
          <CarrilDeComunidades
            comunidades={rooms}
            activa={canal}
            labelFor={labelFor}
            iconFor={iconFor}
            oficialFor={oficialFor}
            avisosDe={avisosDaComunidade}
            onEscolher={setCanal}
            onMenu={barra.menuDoCanal}
            onNova={canCreateChannel ? () => setPrompt("channel") : undefined}
            novaBloqueada={channelCapTip}
          />
        )}
        {/* The phone: the list of "Tu", under the screen it pushes. */}
        {telemovel && separador === "tu" && (
          <MenuDoTu cartao={cartaoDaConta} comentarios={comentariosNoMural} onAbrir={(ecra) => setView(ecra)} />
        )}
        {view !== "pessoas" && (!telemovel || view === "chat") && (
        <ChannelSidebar
          view={view}
          /* On the phone, only the community chosen on the rail: its line (with the
             community menu) and its channels under it. */
          rooms={telemovel ? (canal !== null && rooms.includes(canal) ? [canal] : []) : rooms}
          aEsperaDeEntrada={esperaDaBarra}
          labelFor={labelFor}
          iconFor={iconFor}
          oficialFor={oficialFor}
          roomGroups={roomGroups}
          activeRoom={activeRoom}
          onSelectRoom={barra.abrirSala}
          categoriaRestrita={categoriaRestritaDaBarra}
          onVoiceMemberMenu={barra.menuDaVoz}
          mayMove={active ? (bridge.channels.mayMove?.(active) ?? false) : false}
          onMovePerson={barra.moverPessoa}
          onReorderRoom={editaOCanal ? barra.arrumarSala : undefined}
          onReorderCategory={
            // Also needs the bridge to declare categories: an older host does not bring
            // `setCategory`, and a handle that goes nowhere is worse than having no
            // handle at all.
            editaOCanal && bridge.channels.setCategory ? barra.arrumarCategoria : undefined
          }
          closedRooms={roomsFechadas}
          onReopenRoom={editaOCanal ? barra.reabrirSala : undefined}
          onRemoveRoom={editaOCanal ? barra.eliminarSala : undefined}
          voicePresence={presencaNaVozDaBarra}
          onRoomMenu={barra.menuDaSala}
          {...(editaOCanal ? { onCategoryMenu: barra.menuDaCategoria } : {})}
          onNewRoom={editaOCanal && canCreateRoom ? barra.novaSala : undefined}
          onNewRoomInCategory={editaOCanal && canCreateRoom ? barra.novaSalaNaCategoria : undefined}
          {...(editaOCanal && !canCreateRoom && roomQuota ? { roomCapTip: strings.sidebar.roomLimit(roomQuota) } : {})}
          presenceForChannel={presenceForChannel}
          presenceHint={presenceHint}
          active={active}
          callChannel={callChannel}
          ringing={ringing}
          nameFor={nameFor}
          /* The reader does not have to open the channel to see where the
             conversation is. `Date.now()` read in the call, not stored: a stale
             presence cannot send anyone to a room that has already emptied. */
          salaDaChamadaEm={salaDaChamadaDaBarra}
          unreads={porLerNosCanais}
          porLerNaSala={porLerNaSala}
          silenciado={silenciadoExacto}
          profile={profile}
          address={address}
          connection={connection}
          open={telemovel ? false : sidebarOpen}
          onClose={barra.fechar}
          seccaoConfig={seccaoConfig}
          onSeccaoConfig={setSeccaoConfig}
          onSelectChannel={barra.escolherCanal}
          onChannelMenu={barra.menuDoCanal}
          onCompose={compose}
          onEditProfile={barra.editarPerfil}
          onActivityMenu={setActivityMenu}
          activity={activity}
          onNotifications={setNotifAt}
          unreadNotifications={unreadCountOf(notificacoesVisiveis) + ofertas.length}
          avisaDeNotificacao={sinoAvisa}
          micMuted={micMuted}
          soundOff={soundOff}
          onToggleMic={alternarMicrofone}
          onToggleSound={alternarSom}
          onMicMenu={barra.menuDoMicrofone}
          onSoundMenu={barra.menuDoSom}
          onAbrirDefinicoes={barra.abrirDefinicoes}
          latencia={latencia}
          onLatenciaHover={barra.latencia}
          onPrompt={setPrompt}
          channelCapTip={channelCapTip}
          onSaveStatus={barra.guardarEstado}
          pedidoDeEstado={pedidoDeEstado}
          /* The call goes into the panel at the column foot (P1): the side dock is
             the middle box, and the hang up button is the fifth in the row. */
          chamada={
            docaLateral && callChannel !== null ? { caixa: docaDaChamada("lateral"), onSair: leaveCall } : null
          }
        />
        )}

        {/*
          The open destination, hidden while a person's page is in front.
          `display: contents` leaves the children in the shell grid as if this
          wrapper did not exist; `none` takes them out without unmounting them.
          */}
        <div className="vista-guardada" style={{ display: pessoa ? "none" : "contents" }}>
        {/* The phone: "Tu" shows its list until a screen is pushed over it (`noTu`). */}
        {telemovel && separador === "tu" && !tuAberto ? null : view === "perfil" ? (
          noTu(
          <ProfileScreen
            profile={profile}
            address={address}
            posts={myPosts}
            /* The same pair Social gets, for the same reason: likes and comments come
               from the feed, not from the home. A post open here shows what it
               would show there. */
            messages={messages}
            directory={directory}
            nameFor={nameFor}
            onCompose={compose}
            onEdit={() => setEditingProfile(true)}
            connection={connection}
            connectionDetail={connectionDetail}
            canaisFundados={canaisFundados}
            onAbrirCanal={(canal) => {
              // The same path as the sidebar: the channel, and its destination.
              setCanal(canal)
              setView("chat")
            }}
          />)
        ) : view === "config" ? (
          noTu(
          <SettingsScreen
            seccao={seccaoConfig}
            /* On the phone the screen itself shows the list of sections (1.3.6). */
            onSeccao={setSeccaoConfig}
            /* The microphone tests use the call banner, without opening it again. */
            microfoneDaChamada={callChannel !== null ? localStream : null}
            address={address}
            connection={connection}
            connectionDetail={connectionDetail}
            onLock={() => onRelock("manual")}
            onSessaoMudou={lerSessaoSemExpirar}
            /* The same pair the sidebar card and the call panel get, for the same
               reason: one source. See `SettingsScreen`. */
            micMuted={micMuted}
            soundOff={soundOff}
            onToggleMic={alternarMicrofone}
            onToggleSound={alternarSom}
            onEditProfile={() => setEditingProfile(true)}
            bloqueados={amizade.bloqueados}
            nomeDe={nameFor}
            {...(amizade.podeBloquear ? { onDesbloquear: amizade.desbloquear } : {})}
          />)
        ) : view === "pessoas" ? (
          /**
           * Friends: the conversation column, the top banner, and the body.
           *
           * **The open conversation takes the middle**, because that is what
           * you are doing; requests and management live in the banner, which
           * stays on top of it. See `PeopleDestination`.
           *
           * With no conversation open, the body is the friends list, or the
           * requests, or "add", depending on the tab. This is what this
           * destination was entirely, with requests stacked on top.
           */
          <PeopleDestination
            tab={peopleTab}
            /**
             * Picking a tab closes any open conversation.
             *
             * Without this the tab changed and nothing else happened: the
             * conversation kept taking the body, and "All", "Pending" and "Add"
             * looked like dead buttons. Same reasoning that keeps the tab from
             * lighting with a conversation in front, if it controls the body,
             * picking a tab has to be the move that takes control away.
             */
            onTab={(nome) => {
              setPeopleTab(nome)
              setDirecta(null)
            }}
            pending={openRequests.length}
            amigos={quantosAmigos}
            conversaAberta={directa !== null}
            listaAberta={listaAberta}
            onOpenLista={() => setListaAberta(true)}
            onCloseLista={() => setListaAberta(false)}
            aside={{
              directs,
              active: directa,
              unreads: porLerNasPrivadas,
              silenciado: silenciadoExacto,
              directory,
              nameFor,
              presenceFor,
              presenceHint,
              emChamada,
              onOpen: setDirecta,
              onClose: fecharDirecta,
              onConversaMenu: (channel, at) => setConversaMenu({ channel, at }),
              /* The column foot: it is the same card the channel bar carries in other
                 destinations, not a second copy of it. Without this, removing
                 the bar from Friends would remove the bell and "how you appear"
                 too, which live nowhere else. */
              rodape: cartaoDaConta,
            }}
          >
            {directa !== null ? (
              telemovel ? empurrado(ecraDaConversa) : ecraDaConversa
            ) : (
              <PeopleScreen
                directory={directory}
                me={address}
                connection={connection}
                connectionDetail={connectionDetail}
                requests={openRequests}
                sent={pedidosEnviados}
                bloqueados={conjuntoDeBloqueados}
                presenceFor={presenceFor}
                presenceHint={presenceHint}
                emChamada={emChamada}
                friends={circuloDosAmigos}
                busy={amizade.respondendo}
                tab={peopleTab}
                nameFor={nameFor}
                onAcceptRequest={amizade.aceitar}
                onDeclineRequest={amizade.recusar}
                {...(amizade.podeCancelar ? { onCancelRequest: amizade.cancelar } : {})}
                /* The channel is null: the Friends list is no channel at all, and that is
                   what removes admin naming from the menu. */
                onOpenProfile={(who) => openProfile(who, null)}
                onUserMenu={(who, at) => setUserMenu({ address: who, channel: null, at })}
              />
            )}
          </PeopleDestination>
        ) : view === "chat" && telemovel ? (
          naConversa ? (
            empurrado(
              <SemVotoContext.Provider value={semVoto}>
                {escolhaNoEcra && active ? (
                  <EscolherSalaDeVotacoes
                    salas={salasDeVotacoes}
                    podeCriar={bridge.channels.mayEdit?.(active) ?? false}
                    onAbrir={(room) => {
                      setActiveRooms((actual) => ({ ...actual, [active]: room }))
                      setEscolhaDeVotacoes(null)
                    }}
                    onCriar={() => {
                      setEscolhaDeVotacoes(null)
                      setNovaSalaEm(active)
                    }}
                    onVoltar={() => setEscolhaDeVotacoes(null)}
                  />
                ) : (
                  (ecraDasVotacoes ?? ecraDosTickets ?? ecraDaConversa)
                )}
              </SemVotoContext.Provider>,
              /* The polls and tickets rooms have no header with a way back: this bar is it. */
              (escolhaNoEcra || ecraDasVotacoes || ecraDosTickets) && active ? (
                <BarraDoTelemovel titulo={salaAberta?.name ?? labelFor(active)} contexto={labelFor(active)} onVoltar={voltarNoTelemovel} />
              ) : undefined,
            )
          ) : null
        ) : view === "chat" ? (
          escolhaNoEcra && active ? (
            <EscolherSalaDeVotacoes
              salas={salasDeVotacoes}
              podeCriar={bridge.channels.mayEdit?.(active) ?? false}
              onAbrir={(room) => {
                setActiveRooms((actual) => ({ ...actual, [active]: room }))
                setEscolhaDeVotacoes(null)
              }}
              onCriar={() => {
                setEscolhaDeVotacoes(null)
                setNovaSalaEm(active)
              }}
              onVoltar={() => setEscolhaDeVotacoes(null)}
            />
          ) : (
            /* The 5-day rule reaches the poll cards of the conversation and of the polls room. */
            <SemVotoContext.Provider value={semVoto}>{ecraDasVotacoes ?? ecraDosTickets ?? ecraDaConversa}</SemVotoContext.Provider>
          )
        ) : (
          noTu(
          <Social
            feed={feed}
            /* Likes and comments are tallied from the feed, not the home. */
            messages={messages}
            me={address}
            connection={connection}
            connectionDetail={connectionDetail}
            nameFor={nameFor}
            directory={directory}
            draft={socialDraft}
            onDraft={patchSocialDraft}
            composeSignal={composeSignal}
            presenceFor={presenceFor}
            presenceHint={presenceHint}
            onUserMenu={(who, at, channel) => setUserMenu({ address: who, channel, at })}
            onOpenProfile={openProfile}
            circleSize={friends.size}
          />)
        )}
        </div>

        {/**
          * Another person's page, mounted here because this is where the whole
          * feed lives. It takes the place of the destination, which stays hidden
          * on top (`vista-guardada`) without unmounting: going back restores it
          * as it was, with the draft and the reading place.
          *
          * `directory.get` returns `undefined` when nothing about this person
          * reached this device, and it stays that way: there is no server
          * request to make here, and the sheet says it does not know instead
          * of appearing empty pretending the person has nothing.
          */}
        {pessoa &&
          (() => {
            /*
              The page is the superset of the person's menu, and it mounts from
              the SAME context: the same conditions and the same functions.
              Message and Call go to another destination, and close the page
              right away, without waiting for the direct message to exist.
              Invite, Remove and Verify open a sheet ON TOP of the page, and
              the page stays: close the sheet, go back to it.
            */
            const quem = pessoa.address
            const base = contextoDaPessoa(quem, pessoa.channel)
            const fecharE =
              (gesto: () => void): (() => void) =>
              () => {
                fecharPessoa()
                gesto()
              }
            const ctx = {
              ...base,
              accoes: {
                ...base.accoes,
                mensagem: fecharE(base.accoes.mensagem),
                chamada: fecharE(base.accoes.chamada),
              },
            }
            const tie = lacoDe(quem)
            const estado = estadoDaAmizade(quem, address, tie, amigoDeFacto(quem))
            const publicacaoAberta = entradaDaPessoa?.publicacao
            const aberta =
              publicacaoAberta === undefined
                ? null
                : (pessoaPosts.find((post) => idDaPublicacao(post) === publicacaoAberta) ?? null)
            return (
              <PersonProfile
                key={quem}
                address={quem}
                name={nameFor(quem)}
                profile={directory.get(quem)}
                posts={pessoaPosts}
                /* See the note in `ProfileScreen`: a post open in another person's sheet
                   brings the same thumbs and the same comments. */
                messages={messages}
                me={address}
                directory={directory}
                nameFor={nameFor}
                presenca={presenceFor(quem)}
                presenceHint={presenceHint}
                {...(papeisDoPerfil ? { roles: papeisDoPerfil } : {})}
                onMessage={ctx.accoes.mensagem}
                {...(estado === "amigos" || community.has(quem) ? { onCall: ctx.accoes.chamada } : {})}
                {...(estado !== "eu" && !community.has(quem)
                  ? {
                      amizade: {
                        estado,
                        nota: tie?.note,
                        ocupado: amizade.respondendo === quem,
                        pedir: (nota?: string) => amizade.pedir(quem, nota),
                        aceitar: () => amizade.aceitar(quem),
                        recusar: () => amizade.recusar(quem),
                        desfazer: () => amizade.desfazer(quem),
                        ...(amizade.podeCancelar ? { cancelar: () => amizade.cancelar(quem) } : {}),
                      },
                    }
                  : {})}
                bloqueado={amizade.estaBloqueado(quem)}
                amigosMostrados={
                  // Second defense: the core only gives the list to friends, and the page
                  // only shows it to whoever is a friend now.
                  estado === "amigos" && !amizade.estaBloqueado(quem) && amigosDaPessoa?.address === quem
                    ? amigosDaPessoa.lista.map((quemMais) => ({
                        address: quemMais,
                        // From the directory: the address word without a profile. No highlight for someone who is also my friend-no cross-listing.
                        nome: nameFor(quemMais),
                      }))
                    : null
                }
                onOpenAmigo={(outro) => openProfile(outro, null)}
                canaisEmComum={
                  canaisEmComum?.quem === quem
                    ? canaisEmComum.lista.map((canalEmComum) => ({ channel: canalEmComum, nome: labelFor(canalEmComum) }))
                    : null
                }
                onAbrirCanal={(canalEmComum) => {
                  setCanal(canalEmComum)
                  setView("chat")
                }}
                onInvite={ctx.accoes.convidarParaCanal}
                menu={itensDaPessoa(ctx, { semAccoesDaPagina: true })}
                {...(canalDoPerfil ? { onVerify: () => openVerify(canalDoPerfil, quem) } : {})}
                {...(bridge.social.pedirPublicacoes && feedDaPessoa
                  ? {
                      onAskPosts: () => {
                        const canal = feedDaPessoa
                        void bridge.social
                          .pedirPublicacoes?.(canal)
                          .then(() => pushToast(strings.personProfile.askPostsSent(nameFor(quem)), "info"))
                          .catch((error: Error) => pushToast(traduzirErro(error), "error"))
                      },
                    }
                  : {})}
                aberta={aberta}
                onAbrirPublicacao={(post) =>
                  abrirPessoa({ address: quem, channel: pessoa.channel, publicacao: idDaPublicacao(post) })
                }
                onBack={pilhaDaPessoa.voltar}
                connection={connection}
                connectionDetail={connectionDetail}
              />
            )
          })()}

        {/* The phone notice: a grid row over a list, only where the tabs are. */}
        {mostrarSeparadores && <MobileNotice />}
        {/* The phone: the four tabs at the bottom, only on a list (option B). */}
        {mostrarSeparadores && (
          <Separadores actual={separador} avisos={avisosDosSeparadores} onEscolher={escolherSeparador} />
        )}

        {/* The channel menu. What you can do comes from your roles, and what you cannot does not appear grayed out: it does not appear at all. See `itensDoCanal`. A direct conversation has its own menu, the same one it has in Friends. */}
        {menu && (
          <ContextMenu
            at={menu.at}
            onClose={() => setMenu(null)}
            items={
              isDirect(menu.channel)
                ? itensDeUmaDirecta(menu.channel)
                : itensDoCanal({
                    emChamada: callChannel === menu.channel,
                    porLer: (unreads.get(menu.channel) ?? 0) > 0,
                    podeOrganizar: bridge.channels.mayEdit?.(menu.channel) ?? false,
                    podeConvidar: bridge.channels.mayInvite?.(menu.channel) ?? true,
                    /*
                      From the core, in full. `mayDeleteChannel` combines the ability
                      to "delete" with exceptions that do not depend on any permission: the
                      feed channel, a two-person conversation, the server's common room.
                      Without a responding bridge, it is not offered: it is the failure in
                      the safe direction, unlike `mayInvite` above, where the old host can
                      keep inviting as they always could.
                    */
                    podeEliminar: bridge.channels.mayDelete?.(menu.channel) ?? false,
                    ehFeed: isFeed(menu.channel),
                    // A feed does not mute: it makes no sound and shows no count.
                    ...(isFeed(menu.channel)
                      ? {}
                      : {
                          silencio: {
                            silenciado: silenciados.includes(menu.channel),
                            alternar: () => alternarSilencio(menu.channel),
                          },
                        }),
                    accoes: {
                      abrir: () => abrirConversa(menu.channel),
                      sairDaChamada: () => leaveCall(),
                      marcarLido: () => darPorLido(menu.channel),
                      propriedades: () => setPropriedades(menu.channel),
                      votacoes: () => abrirVotacoes(menu.channel),
                      // The room cap (1.3.26): no "New room" at the cap.
                      ...(canCreateRoom ? { novaSala: () => setNovaSalaEm(menu.channel) } : {}),
                      // Own sheet: creating a category and creating something to file are
                      // two separate gestures. See `NewCategory`.
                      novaCategoria: () => setNovaCategoriaEm(menu.channel),
                      // The menu's channel, never the open one: the menu may belong to
                      // another channel in the sidebar.
                      convidar: () => setConvidar({ channel: menu.channel }),
                      sair: () => sairDoCanal(menu.channel),
                      eliminar: () => eliminarCanal(menu.channel),
                    },
                  })
            }
          />
        )}

        {/* The person's menu. What is offered is in `itensDaPessoa`-pure and
            tested-and what it decides is most important is that in a two-person
            conversation no one is made an admin. */}
        {userMenu && (
          <ContextMenu
            at={userMenu.at}
            onClose={() => setUserMenu(null)}
            items={itensDaPessoa(contextoDaPessoa(userMenu.address, userMenu.channel))}
          />
        )}

        {/* The menu of a conversation in the Friends list. Closing does not delete: the line
            leaves the list and returns when a message arrives. See `itensDaConversa`. */}
        {conversaMenu && (
          <ContextMenu
            at={conversaMenu.at}
            onClose={() => setConversaMenu(null)}
            items={itensDeUmaDirecta(conversaMenu.channel)}
          />
        )}

        {/* The call, audible from any tab: mounted here whenever the full
            panel is off-screen, so the media elements never die with a view.

            The question is `painelDaChamadaNoEcra` and not `view === "chat"`: the
            panel lives inside the conversation screen, that screen now appears
            in two places, and things take its place without changing destination. Tied
            to the channels' destination, a direct call showed the panel in Friends
            and the dock above it at the same time; tied to the conversation, a
            ticket board silenced the entire call. */}
        {callChannel && docaFlutuante && docaDaChamada("flutuante")}

        {/* The window picker, or the macOS permission sheet.
            Drawn here, next to the dock and not inside the call panel:
            it is a response to a request already standing on the Chromium side, and
            it must survive changing conversation. In the browser it is always nothing. */}
        {folhaDeEcra}

        {activityMenu && (
          <ActivityMenu
            activity={activity}
            at={activityMenu}
            onChoose={chooseActivity}
            onEditStatus={() => {
              // The status line already owns the free text: the menu tells it
              // to enter edit mode, instead of having a second idea of "status".
              setActivityMenu(null)
              setPedidoDeEstado((n) => n + 1)
            }}
            onClose={() => setActivityMenu(null)}
          />
        )}

        {/* The microphone and volume dropdown arrows. Both menus are the same component
            with different lists-see `menuDeAudio.ts`, where the rule of what
            appears and what does not appears lives. */}
        {audioMenu && (
          <ContextMenu
            at={audioMenu.at}
            onClose={() => setAudioMenu(null)}
            items={
              audioMenu.qual === "mic"
                ? itensDoMicrofone({
                    microfones,
                    nomeados: microfonesNomeados,
                    escolhido: readPrefs().inputDeviceId,
                    escolher: escolherMicrofone,
                    abrirDefinicoes: () => setView("config"),
                    abrirConta: () => setEditingProfile(true),
                  })
                : itensDoSom({
                    abrirDefinicoes: () => setView("config"),
                    abrirConta: () => setEditingProfile(true),
                  })
            }
          />
        )}

        {notifAt && (
          <NotificationPanel
            at={notifAt}
            notifications={notificacoesVisiveis}
            nameFor={nameFor}
            labelFor={labelFor}
            directory={directory}
            presenceFor={presenceFor}
            emChamada={emChamada}
            friendships={friendshipsDoSino}
            ofertas={ofertas}
            ofertaOcupada={ofertaOcupada}
            onOferta={responderOferta}
            busy={amizade.respondendo}
            onAcceptRequest={amizade.aceitar}
            onDeclineRequest={amizade.recusar}
            aparelhosNaConta={aparelhosNaConta}
            aparelhoARemover={aparelhoARemover}
            onRemoverAparelho={bridge.pairing?.revoke ? removerAparelhoNovo : undefined}
            onOpen={openNotification}
            onMarkAllRead={() => setNotifications((current) => markAllRead(current))}
            onClose={() => setNotifAt(null)}
            /* Reading the vault failed: the panel cannot say "nothing here"
               over a list it could not read. */
            falhou={notifFalhou}
          />
        )}

        {/*
          Invite: first the channel, when the gate does not know it (the menu of a
          person); then the single sheet, with the channel written in. See `ConvidarSheet`.
          The list only brings channels where you can invite: what you cannot do does
          not appear.
        */}
        {convidar && convidar.channel === null && (
          <RoomPicker
            rooms={rooms.filter(
              (room) => !isDirect(room) && !isFeed(room) && (bridge.channels.mayInvite?.(room) ?? true),
            )}
            {...(convidar.preferido ? { preferido: convidar.preferido } : {})}
            labelFor={labelFor}
            iconFor={iconFor}
            onCancel={() => setConvidar(null)}
            onPick={(room) => setConvidar({ ...convidar, channel: room })}
          />
        )}
        {convidar && convidar.channel !== null && (
          <ConvidarSheet
            channel={convidar.channel}
            label={labelFor(convidar.channel)}
            {...(convidar.pessoa ? { pessoa: convidar.pessoa } : {})}
            {...(convidar.modo ? { modoInicial: convidar.modo } : {})}
            /* Never add someone to a direct conversation or a feed: there is no third
               person who fits there, and whoever opened the direct has all the power. */
            podeMeter={
              !isDirect(convidar.channel) &&
              !isFeed(convidar.channel) &&
              (bridge.channels.mayInvite?.(convidar.channel) ?? false)
            }
            onClose={() => setConvidar(null)}
          />
        )}

        {/* The sheet to create a poll in the conversation. Here and not inside the
            message box: the box says someone requested one, and whoever builds and
            sends it is the shell, which is the one that knows the channel and room. */}
        {votacaoNoCanal && (
          <NovaVotacao
            onSubmit={(votacao) => criarVotacao(votacaoNoCanal, votacao)}
            onCancel={() => setVotacaoNoCanal(null)}
          />
        )}


        {cartaoDeAparelho && (
          <CartaoDeAparelhoNovo
            quando={cartaoDeAparelho.at}
            aRemover={aparelhoARemover === cartaoDeAparelho.aparelho}
            onFuiEu={() => setNotifications((current) => markRead(current, cartaoDeAparelho.id))}
            onRemover={
              bridge.pairing?.revoke && cartaoDeAparelho.aparelho
                ? () => {
                    // The card stays until the person confirms: "Cancel" leaves it as it was.
                    void removerAparelhoNovo(cartaoDeAparelho.aparelho!).then((confirmed) => {
                      if (confirmed) setNotifications((current) => markRead(current, cartaoDeAparelho.id))
                    })
                  }
                : undefined
            }
          />
        )}
        {folhaDoFicheiro && address && (
          <FolhaDoFicheiroDaConta
            address={address}
            onGuardado={() => setFolhaDoFicheiro(false)}
            onFechar={() => setFolhaDoFicheiro(false)}
          />
        )}

        {verifying && (
          <VerifyModal
            name={nameFor(verifying.address)}
            address={verifying.address}
            number={verifying.number}
            onClose={() => setVerifying(null)}
          />
        )}

        {editingProfile && (
          <ProfileEditor
            initial={profile}
            address={address}
            onSaved={setProfile}
            onClose={() => setEditingProfile(false)}
            amigos={amigosParaMostrar}
          />
        )}

        {prompt === "channel" && (
          <Prompt
            title={strings.prompts.createRoomTitle}
            label={strings.prompts.nameLabel}
            placeholder={strings.prompts.namePlaceholder}
            onCancel={() => setPrompt(null)}
            onSubmit={(name) => {
              setPrompt(null)
              void (async () => {
                // The address is random (1.0 "Arca", slice 3): the name does not go in the
                // address, it goes encrypted inside the channel (`room.created` and
                // `space.meta`), and the server never sees it.
                const channel = moradaDeSala(parseServerName(serverOf(address)))
                selfOpened.current.add(channel)
                await bridge.channels.create(channel, name)
                await refreshChannels()
                // A newly created channel opens in the channels destination, even
                // if "new channel" was clicked from Friends.
                setCanal(channel)
                setView("chat")
              })().catch((error: Error) => pushToast(traduzirErro(error), "error"))
            }}
          />
        )}

        {prompt === "link" && (
          <Prompt
            title={strings.prompts.joinTitle}
            label={strings.prompts.joinLabel}
            placeholder={strings.prompts.joinPlaceholder}
            hint={strings.prompts.joinHint}
            /*
              The official channel, for whoever is not in it (12/11/2026): the same
              dialog as any other community, and no longer a button in the column.
              One door in: `escolherSalaComum(true)`, however the room is encrypted.
            */
            {...(commonRoom && !channels.includes(commonRoom) && bridge.session.escolherSalaComum
              ? {
                  extra: (
                    <Button
                      variant="ghost"
                      type="button"
                      className="wide join-link"
                      disabled={aEntrarNoCanalOficial}
                      onClick={() => {
                        entrarNoCanalOficial()
                        setPrompt(null)
                      }}
                    >
                      {aEntrarNoCanalOficial ? strings.sidebar.aEntrarNoCanalOficial : strings.sidebar.entrarNoCanalOficial}
                    </Button>
                  ),
                }
              : {})}
            onCancel={() => setPrompt(null)}
            onSubmit={(link) => {
              // Parse before redeeming: a malformed link is a local mistake,
              // and the prompt stays open so it can be corrected.
              const parsed = parseInviteLink(link)
              if (parsed) {
                // Another server is also a local mistake: it stays open, like the
                // mistyped link, and nothing leaves this machine.
                if (seguirConvite(parsed)) setPrompt(null)
                return
              }
              /*
                The short link (5b-2): first the server says the channel, then
                it follows like the long one. The same two local checkpoints before
                anything leaves: the form, and the server.
              */
              const curta = parseShortInviteLink(link)
              const resolver = bridge.invites.resolve
              if (!curta || !resolver) {
                pushToast(strings.prompts.joinInvalid, "error")
                return
              }
              if (!sameHomeserver(curta.server, serverOf(address))) {
                pushToast(strings.invite.otherServer(servidorParaMostrar(curta.server), servidorParaMostrar(serverOf(address))), "error")
                return
              }
              void resolver(link)
                .then((longa) => {
                  const convite = parseInviteLink(longa)
                  if (!convite) throw new Error("that is not a valid invite link")
                  // Only closes the link window: another that opened in the meantime stays.
                  if (seguirConvite(convite)) setPrompt((aberto) => (aberto === "link" ? null : aberto))
                })
                .catch((error: Error) => pushToast(traduzirErro(error), "error"))
            }}
          />
        )}

        {/* Only with the session connected: accepting sends a request, and asking without
            being able to do it was asking twice. Never on top of another dialog
            already open by whoever is here. */}
        {conviteAEspera &&
          destinoDoArranque &&
          destinoDoArranque.que !== "ja-la-estou" &&
          (destinoDoArranque.que === "outro-servidor" || nomeDoArranque?.link === destinoDoArranque.link) &&
          connection === "online" &&
          prompt === null && (
          <ConviteChegado
            destino={destinoDoArranque}
            nome={destinoDoArranque.que === "redimir" && nomeDoArranque?.link === destinoDoArranque.link ? nomeDoArranque.nome : null}
            onDecline={onConviteResolvido}
            onAccept={() => {
              // The seal's name goes with the request: it is what the wait and the
              // entry notice show instead of an opaque address.
              seguirConvite(
                conviteAEspera,
                destinoDoArranque.que === "redimir" && nomeDoArranque?.link === destinoDoArranque.link
                  ? nomeDoArranque.nome
                  : null,
              )
              onConviteResolvido()
            }}
          />
        )}

        {prompt === "amigo" && (
          <Prompt
            title={strings.prompts.friendTitle}
            label={strings.prompts.personLabel}
            placeholder={strings.prompts.personPlaceholder}
            hint={strings.prompts.friendHint}
            confirmLabel={strings.prompts.friendConfirm}
            onCancel={() => setPrompt(null)}
            onSubmit={(who) => {
              /*
                Opens the profile page for that address, where the friend request
                button and the note field are. It was a direct request, on its own
                path: now it is requested in one place only.
              */
              setPrompt(null)
              openProfile(who.trim(), null)
            }}
          />
        )}

        {/*
          Change the name of a room or a category in the open channel, with the
          house `Prompt`. It was a `window.prompt`, unthemed, blocking the window
          in Electron, and different from the sheet that renames the channel.
        */}
        {/* Only in the channel where the menu opened: changing channels with the sheet open
            cannot rename a room in another. */}
        {aRenomear && active === aRenomear.canal && (
          <Prompt
            title={aRenomear.tipo === "sala" ? strings.menu.renameRoomTitle : strings.menu.renameCategory}
            label={strings.prompts.nameLabel}
            placeholder={aRenomear.tipo === "sala" ? aRenomear.nome : aRenomear.categoria}
            initialValue={aRenomear.tipo === "sala" ? aRenomear.nome : aRenomear.categoria}
            onCancel={() => setARenomear(null)}
            onSubmit={(nome) => {
              const alvo = aRenomear
              setARenomear(null)
              if (alvo.tipo === "categoria") {
                renomearCategoria(alvo.categoria, nome)
                return
              }
              const sala = roomGroups.flatMap((grupo) => grupo.rooms).find((r) => r.room === alvo.room)
              if (!sala || nome === sala.name) return
              // Valid for the default room as for any other:
              // publishing `channel.meta` with the empty identifier is what
              // gives it its own name.
              void bridge.channels
                .setRoom(alvo.canal, { ...sala, name: nome })
                .then(() => refreshRooms())
                .catch((error: Error) => pushToast(traduzirErro(error), "error"))
            }}
          />
        )}

        {/* Someone's nickname in this channel (phase 3). Empty is not submitted: removing
            the nickname is the "Remove nickname" entry in the menu. */}
        {aMudarApelido && (
          <Prompt
            title={
              aMudarApelido.who === address
                ? strings.userMenu.nicknameTitleSelf
                : strings.userMenu.nicknameTitle(nameFor(aMudarApelido.who))
            }
            label={strings.userMenu.nicknameLabel}
            nome
            placeholder={nomeVisivel(nameFor(aMudarApelido.who))}
            hint={strings.userMenu.nicknameHint}
            initialValue={bridge.channels.nicknames?.(aMudarApelido.canal)?.[aMudarApelido.who] ?? ""}
            onCancel={() => setAMudarApelido(null)}
            onSubmit={(apelido) => {
              const alvo = aMudarApelido
              setAMudarApelido(null)
              mudarApelido(alvo.canal, alvo.who, apelido)
            }}
          />
        )}

        {/* The expulsion, which asks for the name written before it happens. It is the only
            gesture here with cryptographic effect-see `ExpelModal`. */}
        {expelling && (
          <ExpelModal
            who={expelling.who}
            channel={expelling.channel}
            name={nameFor(expelling.who)}
            onClose={() => setExpelling(null)}
          />
        )}

        {/* Report a person, from their menu or from the profile's "⋯". */}
        {aDenunciar && (
          <DenunciarSheet
            alvo={{ canal: aDenunciar.canal ?? "", pessoa: aDenunciar.who }}
            nomeDoAlvo={nameFor(aDenunciar.who)}
            nomeDe={nameFor}
            {...(aDenunciar.canal !== null ? { nomeDoCanal: labelFor(aDenunciar.canal) } : {})}
            onClose={() => setADenunciar(null)}
          />
        )}

        {/* The menu of a room in the channel. In a voice room, opening is called
            entering, which is what clicking on it does. See `itensDaSala`. */}
        {roomMenu &&
          active &&
          (() => {
            const sala = roomGroups.flatMap((grupo) => grupo.rooms).find((r) => r.room === roomMenu.room)
            if (!sala) return null
            return (
              <ContextMenu
                at={roomMenu.at}
                onClose={() => setRoomMenu(null)}
                items={itensDaSala({
                  sala,
                  podeOrganizar: bridge.channels.mayEdit?.(active) ?? false,
                  /* The phone: the order without dragging (`itemDeMover`). */
                  mover: telemovel ? moverDaSala(sala.room) : null,
                  silencio: {
                    silenciado: silenciados.includes(chaveDoSilencio(active, sala.room)),
                    alternar: () => alternarSilencio(chaveDoSilencio(active, sala.room)),
                  },
                  accoes: {
                    abrir: () => abrirSala(roomMenu.room),
                    renomear: () => setARenomear({ tipo: "sala", canal: active, room: sala.room, nome: sala.name }),
                    // Text rooms only, and only for whoever can change this room's overrides.
                    ...(sala.kind === "text" &&
                    (!sala.layout || sala.layout === "polls") &&
                    (bridge.channels.permissoes?.maySetSobreposicoes(active, { sala: sala.room }) ?? false)
                      ? { quemEscreve: () => setQuemEscreveEm({ room: sala.room, nome: sala.name }) }
                      : {}),
                    fechar: () => {
                      /*
                        No confirmation: closing undoes itself. The notice says what
                        happened and brings "Show again". The default room has its own
                        message, because it is where messages without a room land, and
                        closing it hides it from the list and does not disconnect anything.
                      */
                      const canal = active
                      const fechada = roomMenu.room
                      const mostrarDeNovo = (): void => {
                        void bridge.channels
                          .setRoom(canal, { ...sala, closed: false })
                          .then(() => {
                            refreshRooms()
                            pushToast(strings.rooms.reopened(sala.name))
                          })
                          .catch((error: Error) => pushToast(traduzirErro(error), "error"))
                      }
                      void bridge.channels
                        .setRoom(canal, { ...sala, closed: true })
                        .then(() => {
                          refreshRooms()
                          pushToast(fechada === "" ? strings.rooms.closedDefault : strings.rooms.closed(sala.name), "info", {
                            rotulo: strings.rooms.showAgain,
                            fazer: mostrarDeNovo,
                          })
                          /**
                           * Leave the room that closed-and only that one.
                           *
                           * Always falling back to the default was wrong both ways:
                           * closing a room we were not in pulled us out of where we were,
                           * and closing the DEFAULT room itself put us inside it, which
                           * is the one we had just left the list from. We go to the first
                           * one that stays open; if there is none, we stay in the default,
                           * which is where messages without a room land and therefore is
                           * never really a place at all.
                           */
                          setActiveRooms((a) => {
                            if ((a[active] ?? "") !== roomMenu.room) return a
                            const abertas = roomGroups
                              .flatMap((grupo) => grupo.rooms)
                              .filter((candidata) => candidata.room !== roomMenu.room)
                            return { ...a, [active]: abertas[0]?.room ?? "" }
                          })
                        })
                        .catch((error: Error) => pushToast(traduzirErro(error), "error"))
                    },
                  },
                })}
              />
            )
          })()}

        {/* The menu of a category. A category is not a saved thing: it is the
            name that channels have written, so changing or deleting it means
            rewriting it in all of them. See `itensDaCategoria`. */}
        {categoriaMenu && active && (
          <ContextMenu
            at={categoriaMenu.at}
            onClose={() => setCategoriaMenu(null)}
            items={itensDaCategoria({
              podeOrganizar: bridge.channels.mayEdit?.(active) ?? false,
              /* The phone: the order without dragging (`itemDeMover`). */
              mover: telemovel ? moverDaCategoria(categoriaMenu.category) : null,
              accoes: {
                criarSala: () => abrirNovaSalaNaCategoria(categoriaMenu.category),
                renomear: () => setARenomear({ tipo: "categoria", canal: active, categoria: categoriaMenu.category }),
                // Without `setCategory` there is nowhere for the choice to go-an
                // older host does not bring it, and the entry does not appear.
                ...(bridge.channels.setCategory
                  ? { visibilidade: () => setVisibilidadeDe(categoriaMenu.category) }
                  : {}),
                apagar: () => apagarCategoria(categoriaMenu.category),
              },
            })}
          />
        )}

        {/*
          Who is inside a voice room.

          It is the PERSON'S MENU, plus the destinations to move them to. It was a list
          just for this, with one entry inside it, and it hid itself entirely from anyone
          without the `move` permission: right-clicking a name in a voice room did nothing.
          See `itensDaPessoaEmVoz`.

          `active` and not a menu channel: a voice room only exists in the tree of the
          open channel, so it is always that one.
        */}
        {vozMenu &&
          active &&
          (() => {
            const porSala = moverPorSala(active, vozMenu.room, salasDeVozDoCanal)
            const itens = itensDaPessoaEmVoz({
              pessoa: contextoDaPessoa(vozMenu.address, active),
              podeMover: porSala.podeMover,
              salaActual: vozMenu.room,
              salasDeVoz: porSala.salasDeVoz,
              mover: (room) => moverPessoa(vozMenu.address, room, vozMenu.room),
              ...(bridge.channels.disconnectVoice && porSala.podeDesligar
                ? { desligar: () => desligarPessoa(vozMenu.address, active, vozMenu.room) }
                : {}),
            })
            if (itens.length === 0) return null
            return <ContextMenu at={vozMenu.at} onClose={() => setVozMenu(null)} items={itens} />
          })()}

        {novaCategoriaEm && (
          <NewCategory
            onCancel={() => setNovaCategoriaEm(null)}
            onSubmit={async (nome) => {
              // The position comes from the clock, like the rooms do: it puts the new
              // category at the end without having to rewrite the order of the others.
              await bridge.channels.setCategory?.(novaCategoriaEm, { category: nome, position: Date.now() })
              refreshRooms()
              setNovaCategoriaEm(null)
              pushToast(strings.newCategory.created)
            }}
          />
        )}

        {/*
          Who sees the rooms of a category.

          `active` and not the menu channel: a category header only exists in
          the tree of the open channel, so it is always that one. And `categoriasDeclaradas`
          brings the roles WITH no filter at all-whoever manages must see the
          restriction to be able to undo it.
        */}
        {visibilidadeDe && active && (
          <CategoryProperties
            categoria={visibilidadeDe}
            roles={papeis}
            initial={categoriasDeclaradas.find((entrada) => entrada.category === visibilidadeDe)?.roles ?? []}
            salas={roomGroups.find((grupo) => grupo.category === visibilidadeDe)?.rooms.length ?? 0}
            /*
              Create a role without leaving the sheet, for whoever can manage roles.
              
              `mayManageRoles` and not `mayEdit`: arranging rooms is the
              `rename` permission, which a role can give on its own, and whoever
              only arranges does not create roles. Without this the form does
              not appear-does not appear grayed out, which is the house rule-and
              the sheet goes back to sending anyone without power to the channel
              properties.
              
              No permissions and no color: here the role is a label to say who
              sees a category. Permissions are given in the role editor, and
              offering them in both sheets was a second copy of the same
              boxes.
              */
            {...((bridge.channels.mayManageRoles?.(active) ?? false)
              ? { onCreateRole: (nome: string) => criarPapel(active, nome, [], undefined) }
              : {})}
            onCancel={() => setVisibilidadeDe(null)}
            onSubmit={async (novosPapeis) => {
              /**
               * The position the category already had, sent again.
               *
               * A declaration wins in full, and missing `position` is zero-
               * not "leave it as it was". Without this, choosing who sees a category
               * threw it to the head of the list, which is the kind of side effect
               * that nobody ties to the gesture that caused it.
               *
               * An undeclared category has no position, and goes to the end by
               * the clock, like a new category.
               */
              const declarada = categoriasDeclaradas.find((entrada) => entrada.category === visibilidadeDe)
              await bridge.channels.setCategory?.(active, {
                category: visibilidadeDe,
                position: declarada?.position ?? Date.now(),
                roles: novosPapeis,
              })
              refreshRooms()
              setVisibilidadeDe(null)
              pushToast(strings.categoryProperties.saved(visibilidadeDe))
            }}
          />
        )}

        {/* Who writes in a text room (read-only rooms). See `QuemEscreve`. */}
        {quemEscreveEm &&
          active &&
          bridge.channels.permissoes &&
          (() => {
            const p = bridge.channels.permissoes
            const lugar = { sala: quemEscreveEm.room }
            return (
              <QuemEscreve
                roles={papeis}
                initial={soLeituraDe(p.sobreposicoes(active, lugar))}
                onCancel={() => setQuemEscreveEm(null)}
                onSubmit={async (escolha) => {
                  // Re-read now: someone may have changed the other overrides while the sheet was open.
                  await p.setSobreposicoes(active, lugar, comSoLeitura(p.sobreposicoes(active, lugar), escolha))
                  refreshRooms()
                  setPapeisVersao((n) => n + 1)
                  setQuemEscreveEm(null)
                  pushToast(strings.soLeitura.saved(quemEscreveEm.nome))
                }}
              />
            )
          })()}

        {novaSalaEm && (
          <NewRoom
            categorias={roomGroups.map((grupo) => grupo.category).filter(Boolean)}
            categoria={categoriaDaNovaSala}
            /* The room's AFK timeout that the channel already has, or 15. Read-only. */
            {...((bridge.channels.mayEdit?.(novaSalaEm) ?? false)
              ? { minutosAfk: bridge.channels.rooms(novaSalaEm).find((sala) => sala.afk)?.afk?.minutos ?? 15 }
              : {})}
            /* The read-only choice, for whoever can set room overrides. See `QuemEscreve`. */
            {...(bridge.channels.permissoes && (bridge.channels.mayEdit?.(novaSalaEm) ?? false)
              ? { cargos: papeisDe(novaSalaEm) }
              : {})}
            onCancel={fecharNovaSala}
            onSubmit={async ({ soLeitura, ...next }) => {
              await bridge.channels.setRoom(novaSalaEm, {
                ...next,
                position: Date.now(),
                // In the same publish: two would leave the room open to everyone in between.
                ...(soLeitura ? { perms: comSoLeitura(undefined, soLeitura) } : {}),
              })
              refreshRooms()
              fecharNovaSala()
              pushToast(strings.newRoom.created)
            }}
          />
        )}

        {propriedades && (
          <RoomProperties
            channel={propriedades}
            initial={spaceMeta.get(propriedades) ?? null}
            mayEdit={bridge.channels.mayEdit?.(propriedades) ?? true}
            founder={bridge.channels.founder?.(propriedades) ?? null}
            onClaim={async () => {
              await bridge.channels.claimFounder(propriedades)
              refreshSpaceMeta()
              fecharPropriedades()
              pushToast(strings.roomProperties.claimed)
            }}
            omissao={labelFor(propriedades)}
            official={oficialFor(propriedades)}
            roles={papeisDe(propriedades)}
            mayManageRoles={bridge.channels.mayManageRoles?.(propriedades) ?? false}
            souFundador={address !== null && bridge.channels.founder?.(propriedades) === address}
            cargoAdmin={bridge.channels.adminRole?.(propriedades) ?? null}
            membros={membrosParaCargos}
            onSetMemberRole={darCargoNasPropriedades}
            seccaoAfk={
              <SeccaoSalaAfk
                salasDeVoz={bridge.channels.rooms(propriedades).filter((sala) => sala.kind === "voice")}
                actual={(() => {
                  const marcada = bridge.channels.rooms(propriedades).find((sala) => sala.afk)
                  return marcada?.afk ? { room: marcada.room, minutos: marcada.afk.minutos } : null
                })()}
                onGuardar={async (room, minutos) => {
                  const salas = bridge.channels.rooms(propriedades)
                  if (room === null) {
                    // "None": republish the current one without the banner.
                    const marcada = salas.find((sala) => sala.afk)
                    if (marcada) {
                      const { afk: _semMarca, ...semAfk } = marcada
                      await bridge.channels.setRoom(propriedades, semAfk)
                    }
                  } else {
                    const escolhida = salas.find((sala) => sala.room === room)
                    // The core clears the previous one. See `Session.upsertRoom`.
                    if (escolhida) await bridge.channels.setRoom(propriedades, { ...escolhida, afk: { minutos } })
                  }
                  refreshRooms()
                  pushToast(strings.salaAfk.guardado)
                }}
              />
            }
            seccaoPermissoes={
              address !== null ? (
                <CargosEPermissoesLigado
                  bridge={bridge}
                  channel={propriedades}
                  address={address}
                  ordemAoLado
                  onMudou={() => {
                    setPapeisVersao((n) => n + 1)
                    refreshRooms()
                  }}
                  onErro={(mensagem) => pushToast(mensagem, "error")}
                />
              ) : undefined
            }
            seccaoDenuncias={(() => {
              // Without a report bridge (old `preload`), Moderation stays as it was.
              const denuncias = bridge.denuncias
              if (!denuncias) return undefined
              return (
                <SeccaoDenuncias
                  carregar={() => denuncias.lista(propriedades)}
                  carregarPorAbrir={denuncias.porAbrir ? () => denuncias.porAbrir!(propriedades) : undefined}
                  nomeDe={nameFor}
                  nomeDoCanal={labelFor(propriedades)}
                  nomeDaSala={(sala) => nomeDaSala(bridge.channels.rooms(propriedades), sala) ?? NOME_POR_OMISSAO}
                  onLida={(id) => void denuncias.marcarLida(id).catch(() => {})}
                />
              )
            })()}
            seccaoInicial={propriedadesNosPapeis ? "cargos" : undefined}
            onCreateRole={(nome, poderes, cor) => {
              void criarPapel(propriedades, nome, poderes, cor).catch((error: Error) =>
                pushToast(traduzirErro(error), "error"),
              )
            }}
            onEditRole={(papel, nome, poderes, cor) => {
              // The identifier stays exactly as is: `defineRole` creates or updates, and
              // it's the `role` that ties the role to who holds it. Changing it here would
              // create a new role and leave everyone named with the old one.
              void bridge.channels
                .defineRole(propriedades, { role: papel, name: nome, powers: poderes, ...(cor ? { colour: cor } : {}) })
                .then(() => setPapeisVersao((n) => n + 1))
                .catch((error: Error) => pushToast(traduzirErro(error), "error"))
            }}
            onDeleteRole={(papel) => {
              void bridge.channels
                .deleteRole(propriedades, papel)
                .then(() => setPapeisVersao((n) => n + 1))
                .catch((error: Error) => pushToast(traduzirErro(error), "error"))
            }}
            onReorderRoles={
              podeOrdenarCargos(bridge, propriedades, address)
                ? (ordem) =>
                    // Order travels in the `rank` of each role; the member list,
                    // profile, and menus re-read it from here (`papeisVersao`).
                    bridge.channels
                      .reorderRoles?.(propriedades, ordem)
                      .then(() => setPapeisVersao((n) => n + 1))
                      .catch((error: Error) => pushToast(traduzirErro(error), "error"))
                : undefined
            }
            onCancel={() => fecharPropriedades()}
            onSubmit={async (next) => {
              await bridge.channels.setMeta(propriedades, next)
              // Read from the vault: the message we just sent doesn't come back
              // as an echo, so the new name wouldn't reach us that way.
              refreshSpaceMeta()
              fecharPropriedades()
              pushToast(strings.roomProperties.saved)
            }}
          />
        )}

        {/* Fixed at the bottom left, outside the grid. Returns `null` when there's
            nothing to show, which is almost always and is always the case in the browser. */}
        <AvisoDeActualizacao
          aviso={avisoDeVersao}
          onDescarregar={descarregarVersao}
          onDispensar={dispensarVersao}
        />
    </div>
    </ErrorBoundary>
    </FaixaDoFicheiroContext.Provider>
    </LigacaoContext.Provider>
  )
}

/*
 * The small number above a destination's icon used to live here (`Cracha`).
 * Since 20/11/2026 (rail notices, option A) every notice of a rail button,
 * the number included, is drawn by `components/AvisosDoCarril.tsx`, with the
 * reasons for "9+" and for the words in `aria-describedby`.
 */

/** How many alerted ids `idsNoSino` remembers. The bell holds 50; a day of messages fits. */
const IDS_NO_SINO_MAX = 2_000
