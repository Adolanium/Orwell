/**
 * A stylesheet imported with `?url`: Vite builds it as its own file and gives
 * back its address (`folha-da-aurora.ts`). Declared here because the desktop's
 * renderer typecheck does not load `vite/client`.
 */
declare module "*.css?url" {
  const url: string
  export default url
}
