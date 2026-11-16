/**
 * A fake IndexedDB, with the part of the contract that the vault depends on.
 *
 * jsdom does not ship IndexedDB, and the `fake-indexeddb` package is not in the project.
 * This fake mimics only what `vault-backend.ts` uses, but it mimics it for real:
 *
 * - transactions run one at a time, in the order they were created
 *   (this is what the browser does for `readwrite` transactions on the same store, from
 *   any connection, that is, from any tab);
 * - what a transaction writes only becomes visible on `oncomplete`, and an `abort`
 *   discards everything it did;
 * - requests made inside the `onsuccess` of another request belong to the same
 *   transaction (this is how the owner's token is read and written without races).
 *
 * `reter` deixa o teste decidir quando cada transacção acaba.
 *
 * O armazém de media (`armazem-backend.ts`) usa mais: vários stores numa base,
 * `getAll`, várias bases com nome (`BasesFalsas`, com `deleteDatabase`) e uma
 * quota (`aoGravar` atira o `QuotaExceededError` do browser). O store `vault`
 * continua a ser `dados`, para os testes do cofre.
 */

type Stores = Map<string, Map<string, unknown>>
type Op = { fazer: (stores: Stores) => unknown; pedido: PedidoFalso }

function copiaDe(stores: Stores): Stores {
  return new Map([...stores].map(([nome, dados]) => [nome, new Map(dados)]))
}

interface PedidoFalso {
  result: unknown
  error: DOMException | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

class TxFalsa {
  readonly ops: Op[] = []
  oncomplete: (() => void) | null = null
  onabort: (() => void) | null = null
  onerror: (() => void) | null = null
  error: DOMException | null = null
  abortada = false
  activa = false
  aCorrer = false
  staging: Stores | null = null
  puts = 0
  putsDoCofre = 0

  constructor(
    private readonly idb: IdbFalso,
    readonly modo: string,
  ) {}

  objectStore(nome = "vault"): unknown {
    const doStore = (stores: Stores): Map<string, unknown> => {
      let dados = stores.get(nome)
      if (!dados) stores.set(nome, (dados = new Map()))
      return dados
    }
    const pedir = (fazer: Op["fazer"]): PedidoFalso => {
      if (this.abortada) throw new DOMException("transaction aborted", "TransactionInactiveError")
      const pedido: PedidoFalso = { result: undefined, error: null, onsuccess: null, onerror: null }
      this.ops.push({ fazer, pedido })
      if (this.activa) this.idb.processar(this)
      return pedido
    }
    return {
      get: (chave: string) => pedir((stores) => doStore(stores).get(chave)),
      getAll: () => pedir((stores) => [...doStore(stores).values()]),
      getAllKeys: () => pedir((stores) => [...doStore(stores).keys()]),
      put: (valor: unknown, chave: string) =>
        pedir((stores) => {
          if (this.modo !== "readwrite") throw new DOMException("read only", "ReadOnlyError")
          this.idb.aoGravar?.(nome, chave, valor)
          this.puts += 1
          if (nome === "vault" && chave === "current") this.putsDoCofre += 1
          doStore(stores).set(chave, valor)
          return chave
        }),
      delete: (chave: string) =>
        pedir((stores) => {
          if (this.modo !== "readwrite") throw new DOMException("read only", "ReadOnlyError")
          doStore(stores).delete(chave)
          return undefined
        }),
      clear: () =>
        pedir((stores) => {
          if (this.modo !== "readwrite") throw new DOMException("read only", "ReadOnlyError")
          doStore(stores).clear()
          return undefined
        }),
    }
  }

  abort(): void {
    if (this.abortada) return
    this.abortada = true
    this.idb.abortar(this)
  }
}

export class IdbFalso {
  /** Os stores desta base, por nome. */
  readonly stores: Stores = new Map([["vault", new Map<string, unknown>()]])
  /** The `vault` store (the vault's). */
  get dados(): Map<string, unknown> {
    return this.store("vault")
  }
  store(nome: string): Map<string, unknown> {
    let dados = this.stores.get(nome)
    if (!dados) this.stores.set(nome, (dados = new Map()))
    return dados
  }
  /** Called on each `put`: a test throws the browser error here (the quota). */
  aoGravar: ((store: string, chave: string, valor: unknown) => void) | null = null
  /** How many `put` calls reached the disk (completed transactions). */
  putsGravados = 0
  /** Of those, how many came from the vault itself (the `current` key), not counting the token. */
  putsDoCofre = 0
  /** How many times `open` was called. */
  aberturas = 0
  /** How many transactions were created. */
  transaccoes = 0
  reter = false
  readonly #retidas: (() => void)[] = []
  readonly #fila: TxFalsa[] = []
  #activa: TxFalsa | null = null

  readonly indexedDB = {
    open: (): PedidoFalso & { onupgradeneeded: (() => void) | null } => {
      this.aberturas += 1
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        close: () => {},
        onversionchange: null,
        onclose: null,
        transaction: (_store: string, modo: string) => {
          this.transaccoes += 1
          const tx = new TxFalsa(this, modo)
          this.#fila.push(tx)
          setTimeout(() => this.#seguinte(), 0)
          return tx
        },
      }
      const pedido = { result: db as unknown, error: null, onsuccess: null as (() => void) | null, onerror: null, onupgradeneeded: null }
      setTimeout(() => pedido.onsuccess?.(), 0)
      return pedido
    },
  }

  /** Let retained transactions complete. */
  soltar(): void {
    this.reter = false
    for (const acabar of this.#retidas.splice(0)) acabar()
  }

  get retidas(): number {
    return this.#retidas.length
  }

  #seguinte(): void {
    if (this.#activa) return
    const tx = this.#fila.shift()
    if (!tx) return
    if (tx.abortada) {
      this.#seguinte()
      return
    }
    this.#activa = tx
    tx.activa = true
    tx.staging = copiaDe(this.stores)
    this.processar(tx)
  }

  processar(tx: TxFalsa): void {
    if (tx.aCorrer || tx.abortada) return
    const op = tx.ops.shift()
    if (!op) {
      // No requests: wait a moment for requests made in `onsuccess` callbacks.
      setTimeout(() => {
        if (tx.ops.length > 0) this.processar(tx)
        else this.#acabar(tx)
      }, 0)
      return
    }
    tx.aCorrer = true
    setTimeout(() => {
      tx.aCorrer = false
      if (tx.abortada || !tx.staging) return
      try {
        op.pedido.result = op.fazer(tx.staging)
      } catch (erro) {
        op.pedido.error = erro as DOMException
        tx.error = erro as DOMException
        op.pedido.onerror?.()
        tx.abort()
        return
      }
      op.pedido.onsuccess?.()
      this.processar(tx)
    }, 0)
  }

  #acabar(tx: TxFalsa): void {
    if (tx.abortada || this.#activa !== tx) return
    const acabar = (): void => {
      if (tx.abortada) return
      for (const [nome, dados] of tx.staging ?? []) {
        const gravados = this.store(nome)
        gravados.clear()
        for (const [chave, valor] of dados) gravados.set(chave, valor)
      }
      this.putsGravados += tx.puts
      this.putsDoCofre += tx.putsDoCofre
      tx.activa = false
      this.#activa = null
      tx.oncomplete?.()
      this.#seguinte()
    }
    if (this.reter) this.#retidas.push(acabar)
    else acabar()
  }

  abortar(tx: TxFalsa): void {
    tx.staging = null
    if (this.#activa === tx) this.#activa = null
    tx.activa = false
    setTimeout(() => {
      tx.onabort?.()
      this.#seguinte()
    }, 0)
  }
}

/**
 * Several named databases, like an origin's `indexedDB`: `open(nome)` always
 * opens the same database for the same name, and `deleteDatabase` deletes it.
 */
export class BasesFalsas {
  readonly bases = new Map<string, IdbFalso>()
  /** Quantas vezes se chamou `deleteDatabase`, por nome. */
  readonly apagadas: string[] = []

  base(nome: string): IdbFalso {
    let base = this.bases.get(nome)
    if (!base) this.bases.set(nome, (base = new IdbFalso()))
    return base
  }

  readonly indexedDB = {
    open: (nome: string) => this.base(nome).indexedDB.open(),
    deleteDatabase: (nome: string) => {
      this.apagadas.push(nome)
      const pedido = { result: undefined, error: null, onsuccess: null as (() => void) | null, onerror: null, onblocked: null }
      setTimeout(() => {
        this.bases.delete(nome)
        pedido.onsuccess?.()
      }, 0)
      return pedido
    },
  }
}
