import { strings } from "../strings.js"

/**
 * "Privacy · Terms": the two pages of the site, in the app's language
 * (`strings.legal`). `target="_blank"` opens a new tab in the browser; in the
 * desktop app, `setWindowOpenHandler` hands the address to the system browser
 * (`links-externos.ts`), and nothing opens inside the app.
 */
export function LigacoesLegais({ className }: { className: string }) {
  return (
    <>
      <a className={className} href={strings.legal.privacidadeUrl} target="_blank" rel="noopener noreferrer">
        {strings.legal.privacidade}
      </a>
      {" · "}
      <a className={className} href={strings.legal.termosUrl} target="_blank" rel="noopener noreferrer">
        {strings.legal.termos}
      </a>
    </>
  )
}
