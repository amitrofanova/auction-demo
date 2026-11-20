export type CatchUp = {
  seq: number
  replace: boolean
}

export function freshCatchUp(): CatchUp {
  return { seq: 0, replace: true }
}

export function noteConnected(catchUp: CatchUp): CatchUp {
  return { ...catchUp, replace: true }
}

/** Снимок после нового join заменяет состояние. Более поздние кадры со старым seq не применяются. */
export function takeSnapshot(catchUp: CatchUp, seq: number): { catchUp: CatchUp; apply: boolean } {
  if (!catchUp.replace && seq < catchUp.seq) return { catchUp, apply: false }
  return { catchUp: { seq, replace: false }, apply: true }
}
