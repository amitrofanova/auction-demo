import type { Snapshot } from '@auction/domain'

const STAGES = new Set(['absent', 'awaiting', 'live', 'closed'])

export function readSnapshot(text: string): Snapshot | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const body = value as { type?: unknown; role?: unknown; stage?: unknown }
  if (body.type !== 'snapshot') return null
  if (body.role !== 'buyer' && body.role !== 'seller') return null
  if (typeof body.stage !== 'string' || !STAGES.has(body.stage)) return null
  return value as Snapshot
}
