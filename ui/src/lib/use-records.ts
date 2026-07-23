import { useEffect, useState } from "react"
import { listRecords, type PBRecord } from "./pb"

export interface RecordsState {
  records: PBRecord[]
  loading: boolean
  error: string | null
}

export function useRecords(collection: string): RecordsState {
  const [state, setState] = useState<RecordsState>({
    records: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    setState({ records: [], loading: true, error: null })
    listRecords(collection)
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
  }, [collection])

  return state
}
