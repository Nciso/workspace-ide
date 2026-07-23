import { useCallback, useEffect, useState } from "react"
import { listRecords, type PBRecord } from "./pb"

export interface RecordsState {
  records: PBRecord[]
  loading: boolean
  error: string | null
  /** Re-fetch — called after an action writes, so the screen shows what the server stored. */
  reload: () => void
}

export function useRecords(
  collection: string,
  sort?: string,
  filter?: string
): RecordsState {
  const [state, setState] = useState<Omit<RecordsState, "reload">>({
    records: [],
    loading: true,
    error: null,
  })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setState({ records: [], loading: true, error: null })
    listRecords(collection, sort, filter)
      .then((records) => {
        if (!cancelled) setState({ records, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ records: [], loading: false, error: String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [collection, sort, filter, nonce])

  return { ...state, reload }
}
