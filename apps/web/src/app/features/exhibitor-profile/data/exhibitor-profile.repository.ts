import type { Observable } from 'rxjs';

/** `GET /me/exhibitor-profile` (EXH-01): the exhibitor's own private profile. */
export interface ExhibitorProfileDto {
  readonly id: string;
  readonly legalName: string;
  readonly tradeName: string;
  readonly taxId: string | null;
  readonly categoryId: string | null;
  readonly category: string | null;
  readonly description: string;
  readonly publicContactOptIn: boolean;
}

/** What the exhibitor saves (`PUT`): the whole profile; owner and organization come from the session. */
export interface ExhibitorProfileInput {
  readonly legalName: string;
  readonly tradeName: string;
  readonly taxId: string | null;
  readonly categoryId: string;
  readonly description: string;
  readonly publicContactOptIn: boolean;
}

/**
 * Port for the signed-in exhibitor's profile. Also the DI token. `get` answers null while there is
 * no profile yet (the API's 404); `save` fails with 400 on invalid data (CUIT, rubro).
 */
export abstract class ExhibitorProfileRepository {
  abstract get(): Observable<ExhibitorProfileDto | null>;
  abstract save(input: ExhibitorProfileInput): Observable<ExhibitorProfileDto>;
}
