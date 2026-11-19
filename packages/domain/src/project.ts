import type { AuctionState, AuctionTerms, Bid, BidSource } from './auction'
import { participantById, type ParticipantId } from './participants'

/** Факты комнаты. Домен их не хранит, но без них клиенту не собрать часы и присутствие. */
export type ProjectContext = {
  seq: number
  serverNow: number
  onlineParticipantIds: readonly ParticipantId[]
}

export type OwnAutoBid = {
  seq: number
  amount: number
  at: number
}

export type FeedBid = {
  seq: number
  participantId: ParticipantId
  name: string
  amount: number
  at: number
  source: BidSource
}

export type NamedLeader = {
  participantId: ParticipantId
  name: string
}

type SharedSnapshot = {
  type: 'snapshot'
  seq: number
  serverNow: number
  stage: AuctionState['stage']
  terms: AuctionTerms | null
  endsAt: number | null
  amount: number | null
  onlineParticipantIds: ParticipantId[]
}

export type BuyerSnapshot = SharedSnapshot & {
  role: 'buyer'
  youLead: boolean
  autobids: OwnAutoBid[]
  autobroker: { maxAmount: number } | null
}

export type SellerSnapshot = SharedSnapshot & {
  role: 'seller'
  leader: NamedLeader | null
  bids: FeedBid[]
}

export type Snapshot = BuyerSnapshot | SellerSnapshot

/** Покупателю не отдаём ленту, имя лидера и чужой потолок. Продавцу не отдаём потолки. */
export function project(state: AuctionState, viewerId: ParticipantId, context: ProjectContext): Snapshot {
  const round = roundOf(state)
  const leader = round?.leader ?? null
  const shared: SharedSnapshot = {
    type: 'snapshot',
    seq: context.seq,
    serverNow: context.serverNow,
    stage: state.stage,
    terms: state.terms ? { ...state.terms } : null,
    endsAt: state.endsAt,
    amount: leader ? leader.amount : null,
    onlineParticipantIds: [...context.onlineParticipantIds],
  }

  if (viewerId === 's') {
    return {
      ...shared,
      role: 'seller',
      leader: leader ? { participantId: leader.participantId, name: participantName(leader.participantId) } : null,
      bids: (round?.bids ?? []).map(toFeedBid),
    }
  }

  const own = round?.autobrokers[viewerId]
  return {
    ...shared,
    role: 'buyer',
    youLead: leader?.participantId === viewerId,
    autobids: (round?.bids ?? [])
      .filter((bid) => bid.participantId === viewerId && bid.source === 'autobroker')
      .map((bid) => ({ seq: bid.seq, amount: bid.amount, at: bid.at })),
    autobroker: own ? { maxAmount: own.maxAmount } : null,
  }
}

function roundOf(state: AuctionState): Extract<AuctionState, { stage: 'live' | 'closed' }> | null {
  if (state.stage === 'live' || state.stage === 'closed') return state
  return null
}

function toFeedBid(bid: Bid): FeedBid {
  return {
    seq: bid.seq,
    participantId: bid.participantId,
    name: participantName(bid.participantId),
    amount: bid.amount,
    at: bid.at,
    source: bid.source,
  }
}

function participantName(id: ParticipantId): string {
  const participant = participantById(id)
  if (!participant) throw new Error(`Unknown participant: ${id}`)
  return participant.name
}
