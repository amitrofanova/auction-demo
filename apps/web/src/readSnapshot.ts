import type { Snapshot } from '@auction/domain'

const STAGES = new Set(['absent', 'awaiting', 'live', 'closed'])

export type Incoming =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'rejected'; reason: string; command?: string }

export function readIncoming(text: string): Incoming | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const body = value as { type?: unknown; role?: unknown; stage?: unknown; reason?: unknown; command?: unknown }
  if (body.type === 'rejected') {
    if (typeof body.reason !== 'string') return null
    return {
      kind: 'rejected',
      reason: body.reason,
      command: typeof body.command === 'string' ? body.command : undefined,
    }
  }
  if (body.type !== 'snapshot') return null
  if (body.role !== 'buyer' && body.role !== 'seller') return null
  if (typeof body.stage !== 'string' || !STAGES.has(body.stage)) return null
  return { kind: 'snapshot', snapshot: value as Snapshot }
}
