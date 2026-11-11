import { parsePesosToCents } from '../../../shared/decimal';
import type {
  EditableStandStatus,
  StandChange,
  StandDto,
} from '../data/event-inventory.repository';

/** What the row inputs hold: the price as typed, the sector id (null = none) and the status. */
export interface StandDraft {
  readonly price: string;
  readonly sectorId: string | null;
  readonly status: EditableStandStatus | 'ASSIGNED';
}

export type StandDelta = Omit<StandChange, 'standIds'>;

const MAX_PRICE_CENTS = 1_000_000_000_000;

/** The draft a row starts with: exactly what the stand has now. */
export function draftOf(stand: StandDto, priceText: string): StandDraft {
  return { price: stand.hasPrice ? priceText : '', sectorId: stand.sectorId, status: stand.status };
}

export type RowResult =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'changed'; readonly delta: StandDelta };

/** Compares a draft with its stand: the fields to send, or why the price cannot be read. */
export function diffStand(stand: StandDto, draft: StandDraft): RowResult {
  const text = draft.price.trim();
  const delta: { priceCents?: number; sectorId?: string | null; status?: EditableStandStatus } = {};
  if (text === '') {
    if (stand.hasPrice) return { kind: 'invalid', message: 'El precio no puede quedar vacío.' };
  } else {
    const cents = parsePesosToCents(text);
    if (cents === null || cents > MAX_PRICE_CENTS)
      return { kind: 'invalid', message: 'Ingresá un precio en pesos, con hasta 2 decimales.' };
    if (!stand.hasPrice || cents !== stand.priceCents) delta.priceCents = cents;
  }
  if (draft.sectorId !== stand.sectorId) delta.sectorId = draft.sectorId;
  if (draft.status !== stand.status && draft.status !== 'ASSIGNED') delta.status = draft.status;
  return Object.keys(delta).length === 0 ? { kind: 'unchanged' } : { kind: 'changed', delta };
}

/** The API applies one change to many stands, so rows with the same change share one request. */
export function groupChanges(
  rows: readonly { readonly id: string; readonly delta: StandDelta }[],
): readonly StandChange[] {
  const groups = new Map<string, { delta: StandDelta; ids: string[] }>();
  for (const { id, delta } of rows) {
    const key = JSON.stringify([delta.priceCents, delta.sectorId, delta.status]);
    const group = groups.get(key) ?? { delta, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ delta, ids }) => ({ ...delta, standIds: ids }));
}
