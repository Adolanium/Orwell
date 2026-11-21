/**
 * Every desktop menu, and the phone's way to it (option B, 20/11/2026).
 *
 * The rule: on a phone every menu is complete and no feature is lost. On a computer the context menus open with a right
 * click; on a phone the same menu opens with a long press (`useToqueLongo`),
 * as a bottom sheet with the same entries in the same order
 * (`ContextMenu`, 840 px and less).
 *
 * `inventario.test.ts` reads the source and fails when:
 * - a file mounts a `<ContextMenu` that is not listed here;
 * - a file has an `onContextMenu=` that is not listed here, or whose element
 *   has no long press next to it;
 * - a test named here does not exist.
 *
 * The full inventory, with every entry of every menu, is kept with the
 * project notes.
 */

/** A file that mounts menus, what opens each one on a phone, and the test that proves it. */
export interface MontagemDeMenus {
  /** How many `<ContextMenu` this file mounts. */
  quantos: number
  /** Each menu, in source order: the menu, and the phone gesture that opens it. */
  menus: readonly string[]
  /** The tests that open them on a phone (paths from `packages/ui/src`). */
  testes: readonly string[]
}

export const MONTAGENS: Readonly<Record<string, MontagemDeMenus>> = {
  "App.tsx": {
    quantos: 7,
    menus: [
      "Comunidade (itensDoCanal): toque longo na cara do carril de comunidades, ou na linha da comunidade",
      "Pessoa (itensDaPessoa): toque longo na pessoa nos membros, nos Amigos, ou no autor de uma mensagem",
      "Conversa directa (itensDaConversa): toque longo na conversa em Mensagens",
      "Microfone e som (menuDeAudio): toque longo nos botões do cartão da conta, em Tu",
      "Sala (itensDaSala, com Mover no telemóvel): toque longo na sala",
      "Categoria (itensDaCategoria, com Mover no telemóvel): toque longo no cabeçalho da categoria",
      "Pessoa numa sala de voz (itensDaPessoaEmVoz): toque longo na pessoa debaixo da sala",
    ],
    testes: ["App.telemovel.test.tsx", "screens/overlays/ContextMenu.test.tsx", "hooks/useToqueLongo.test.tsx"],
  },
  "screens/chat/ChatScreen.tsx": {
    quantos: 1,
    menus: [
      "Mensagem (copiar, média, fechar votação, reagir, ver reacções, responder, fixar, editar, eliminar, denunciar, e as reacções rápidas no topo): toque longo na mensagem. A barra de acções que o rato mostra fica toda dentro deste menu.",
    ],
    testes: ["App.telemovel.test.tsx", "screens/chat/Timeline.test.tsx"],
  },
  "screens/chat/Composer.tsx": {
    quantos: 1,
    menus: ["Mais (imagem, ficheiro): o botão + da caixa de escrita, igual no computador"],
    testes: ["screens/chat/Composer.test.tsx"],
  },
  "screens/social/Social.tsx": {
    quantos: 1,
    menus: ["Publicação: toque longo na publicação, ou o botão ⋯"],
    testes: ["screens/social/Social.test.tsx"],
  },
  "screens/call/CallPanel.tsx": {
    quantos: 1,
    menus: ["Pessoa na chamada (com o volume): toque longo no cartão da pessoa"],
    testes: ["screens/call/CallPanel.test.tsx"],
  },
  "screens/profile/PersonProfile.tsx": {
    quantos: 1,
    menus: ["Mais na página da pessoa: o botão ⋯, igual no computador"],
    testes: ["screens/profile/PersonProfile.test.tsx"],
  },
}

/** Each file with right clicks, how many, and what each one opens. */
export const GATILHOS: Readonly<Record<string, { quantos: number; abre: readonly string[] }>> = {
  "screens/chat/Timeline.tsx": { quantos: 2, abre: ["menu da mensagem", "quem reagiu (ficha de reacção)"] },
  "screens/chat/ChannelSidebar.tsx": {
    quantos: 4,
    abre: ["menu da sala", "menu da pessoa numa sala de voz", "menu da comunidade", "menu da categoria"],
  },
  "screens/chat/MemberPanel.tsx": { quantos: 1, abre: ["menu da pessoa"] },
  "screens/social/Social.tsx": { quantos: 1, abre: ["menu da publicação"] },
  "screens/call/CallChip.tsx": { quantos: 1, abre: ["menu da pessoa na chamada"] },
  "screens/profile/CartaoDaConta.tsx": { quantos: 2, abre: ["menu do microfone", "menu do som"] },
  "screens/people/FriendsAside.tsx": { quantos: 1, abre: ["menu da conversa directa"] },
  "screens/people/PeopleScreen.tsx": { quantos: 1, abre: ["menu da pessoa"] },
  "screens/telemovel/CarrilDeComunidades.tsx": { quantos: 1, abre: ["menu da comunidade"] },
}
