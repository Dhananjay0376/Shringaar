import { useCallback, useEffect, useRef, useState } from 'react'
import { isServiceError } from '../types/seller'
import {
  approveAssetJob,
  createAssetJob,
  fetchAssetJob,
  isAssetApiConfigured,
  isJobSettled,
  rejectAssetJob,
  retryAssetJob,
} from '../services/assetApi'
import type { AssetJob, CreateAssetJobInput } from '../services/assetApi'

/**
 * Owns one processing job for one screen: submit, poll, and the three decisions a seller can make
 * about the result.
 *
 * The polling loop lives in a single effect that owns its own timer and cancellation, rather than
 * in a `setInterval` that outlives the component. That matters here specifically because
 * `<StrictMode>` mounts every effect twice in development: an interval started without a matching
 * cleanup would poll the same job from two loops, and a rejected job would be rejected twice.
 *
 * Polling stops on its own at a terminal state, on unmount, and at a hard deadline. The deadline
 * exists so a job that never settles — a worker that died holding it — reports something to the
 * seller instead of a spinner that spins until the tab is closed.
 */

/** How often to ask. The pipeline settles in seconds; this is not a long poll. */
const POLL_INTERVAL_MS = 900

/** After this many polls, stop and say so. ~5 minutes at the interval above. */
const MAX_POLLS = 340

export interface UseAssetJob {
  /** The job being watched, or null before one has been submitted. */
  job: AssetJob | null
  /** A seller-facing sentence for anything that went wrong client-side. */
  error: string | null
  /** True from submit until the job settles, or while a decision is being recorded. */
  busy: boolean
  /** The file the seller chose, held so the screen can show it before the result exists. */
  source: File | null
  configured: boolean
  choose: (file: File | null) => void
  process: (options?: Omit<CreateAssetJobInput, 'file'>) => Promise<void>
  retry: () => Promise<void>
  approve: (assetIds: string[]) => Promise<AssetJob | null>
  reject: (reason: string) => Promise<void>
  /** Forget the current job and start over. Does not delete it on the server. */
  reset: () => void
}

function messageFor(cause: unknown, fallback: string): string {
  return isServiceError(cause) ? cause.message : fallback
}

export function useAssetJob(): UseAssetJob {
  const [job, setJob] = useState<AssetJob | null>(null)
  const [source, setSource] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  //: Bumped to restart the poll loop after a retry, since the job id does not change.
  const [generation, setGeneration] = useState(0)

  const configured = isAssetApiConfigured()

  // Stops an in-flight decision from setting state after the screen is gone.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const jobId = job?.id ?? null
  const settled = job !== null && isJobSettled(job.state)

  useEffect(() => {
    if (!jobId || settled) return

    const controller = new AbortController()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let polls = 0

    const poll = async () => {
      polls += 1
      try {
        const fresh = await fetchAssetJob(jobId, controller.signal)
        if (cancelled) return
        setJob(fresh)
        if (isJobSettled(fresh.state)) {
          setBusy(false)
          return
        }
      } catch (cause) {
        if (cancelled) return
        // A failed poll is reported and the loop stops: continuing would repeat the same failure
        // every second and bury the first, most informative message.
        setError(messageFor(cause, 'The processing service stopped responding.'))
        setBusy(false)
        return
      }

      if (polls >= MAX_POLLS) {
        setError(
          'This is taking much longer than expected. The job may still be running on the server — ' +
            'reload to check, or start again.',
        )
        setBusy(false)
        return
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }

    // The first poll is immediate: the job may already have settled while the response was in
    // flight, and waiting a full interval to find that out is a needless pause.
    void poll()

    return () => {
      cancelled = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [jobId, settled, generation])

  const choose = useCallback((file: File | null) => {
    setError(null)
    setSource(file)
  }, [])

  const process = useCallback(
    async (options?: Omit<CreateAssetJobInput, 'file'>) => {
      if (!source) {
        setError('Choose a photograph first.')
        return
      }
      setError(null)
      setBusy(true)
      setJob(null)
      try {
        const created = await createAssetJob({ file: source, ...options })
        if (mounted.current) setJob(created)
      } catch (cause) {
        if (mounted.current) {
          setError(messageFor(cause, 'That photograph could not be sent for processing.'))
          setBusy(false)
        }
      }
    },
    [source],
  )

  const retry = useCallback(async () => {
    if (!jobId) return
    setError(null)
    setBusy(true)
    try {
      const fresh = await retryAssetJob(jobId)
      if (!mounted.current) return
      setJob(fresh)
      setGeneration((value) => value + 1)
    } catch (cause) {
      if (mounted.current) {
        setError(messageFor(cause, 'That job could not be retried.'))
        setBusy(false)
      }
    }
  }, [jobId])

  const approve = useCallback(
    async (assetIds: string[]): Promise<AssetJob | null> => {
      if (!jobId) return null
      setError(null)
      setBusy(true)
      try {
        const fresh = await approveAssetJob(jobId, assetIds)
        if (mounted.current) setJob(fresh)
        return fresh
      } catch (cause) {
        if (mounted.current) {
          setError(messageFor(cause, 'Those assets could not be approved.'))
        }
        return null
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [jobId],
  )

  const reject = useCallback(
    async (reason: string) => {
      if (!jobId) return
      setError(null)
      setBusy(true)
      try {
        const fresh = await rejectAssetJob(jobId, reason)
        if (mounted.current) setJob(fresh)
      } catch (cause) {
        if (mounted.current) setError(messageFor(cause, 'That job could not be rejected.'))
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [jobId],
  )

  const reset = useCallback(() => {
    setJob(null)
    setSource(null)
    setError(null)
    setBusy(false)
  }, [])

  return {
    job,
    source,
    error,
    busy,
    configured,
    choose,
    process,
    retry,
    approve,
    reject,
    reset,
  }
}
