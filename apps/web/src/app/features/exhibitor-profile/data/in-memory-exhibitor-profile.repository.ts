import { defer, of, type Observable } from 'rxjs';
import {
  ExhibitorProfileRepository,
  type ExhibitorProfileDto,
  type ExhibitorProfileInput,
} from './exhibitor-profile.repository';

/** Test double: one profile, created by the first save like the API's `PUT`. */
export class InMemoryExhibitorProfileRepository extends ExhibitorProfileRepository {
  readonly saved: ExhibitorProfileInput[] = [];

  constructor(private profile: ExhibitorProfileDto | null = null) {
    super();
  }

  get(): Observable<ExhibitorProfileDto | null> {
    return defer(() => of(this.profile));
  }

  save(input: ExhibitorProfileInput): Observable<ExhibitorProfileDto> {
    return defer(() => {
      this.saved.push(input);
      this.profile = { id: this.profile?.id ?? 'profile-1', category: null, ...input };
      return of(this.profile);
    });
  }
}
