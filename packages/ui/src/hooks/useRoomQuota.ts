import { useEffect, useState } from "react"

/** What the bridge says about the rooms this account created (1.3.26). Same shape as `RoomQuota` in the protocol. */
export interface RoomQuotaOnBridge {
  created: number
  max: number
  newAccount?: boolean | undefined
}

/**
 * The cap on rooms (inside channels) this account may create,
 * asked again each time the connection comes up and each time `version`
 * changes (the open channel, or the number of its rooms). `canCreate` is
 * `true` while nothing is known: an older host or server, or no answer yet.
 * The server still decides.
 */
export function useRoomQuota(
  read: (() => Promise<RoomQuotaOnBridge | null>) | undefined,
  connection: string,
  version: string,
): { quota: RoomQuotaOnBridge | null; canCreate: boolean } {
  const [quota, setQuota] = useState<RoomQuotaOnBridge | null>(null)
  useEffect(() => {
    if (!read || connection !== "online") return
    let alive = true
    void read()
      .then((answer) => {
        if (alive) setQuota(answer)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [read, connection, version])
  return { quota, canCreate: quota === null || quota.created < quota.max }
}
