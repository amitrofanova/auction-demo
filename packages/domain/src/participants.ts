export const PARTICIPANTS = [
  { id: 'a', role: 'Покупатель', name: 'Покупатель 1' },
  { id: 'b', role: 'Покупатель', name: 'Покупатель 2' },
  { id: 's', role: 'Продавец', name: 'Продавец' },
] as const

export type Participant = (typeof PARTICIPANTS)[number]
export type ParticipantId = Participant['id']

const participantsById = new Map<ParticipantId, Participant>(
  PARTICIPANTS.map((participant) => [participant.id, participant]),
)

export function participantById(id: string): Participant | null {
  return participantsById.get(id as ParticipantId) ?? null
}
