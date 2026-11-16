/**
 * The reference to a media item in the vault (`contents.media[sha]`), design §2.2.
 * It lives in the vault types (`vault.ts`); it is only re-exported here, so the
 * store does not have to import the vault.
 */
export type { RefDeMedia } from "../vault.js"
