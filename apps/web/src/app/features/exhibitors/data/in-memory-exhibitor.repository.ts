import { defer, of, type Observable } from 'rxjs';
import {
  ExhibitorRepository,
  type DocumentsStatus,
  type ExhibitorSummaryDto,
} from './exhibitor.repository';

type Row = [string, string, string, string | null, DocumentsStatus, boolean, string];

// Fictitious people and businesses (from the UX prototype). Tax ids follow an obviously fake
// pattern (NN-000000NN-D) so they can never match a real CUIT.
const ROWS: readonly Row[] = [
  [
    'Lanas del Limay',
    'Textil de autor',
    'Florencia Quiroga',
    '20-00000001-5',
    'APPROVED',
    true,
    'Hilados y tejidos con lana de oveja de la meseta.',
  ],
  [
    'Barro Cordillerano',
    'Cerámica',
    'Martín Sepúlveda',
    '20-00000002-3',
    'APPROVED',
    true,
    'Vajilla de gres hecha a mano.',
  ],
  [
    'Cordero & Lúpulo',
    'Gastronomía',
    'Hernán Pacheco',
    '20-00000003-1',
    'PENDING',
    false,
    'Sándwiches de cordero y maridajes.',
  ],
  [
    'Verde Ruca',
    'Cosmética natural',
    'Julieta Antinao',
    '27-00000004-6',
    'PENDING',
    true,
    'Cremas y aceites con plantas nativas.',
  ],
  [
    'Miel del Valle',
    'Productos regionales',
    'Rosa Ñancucheo',
    null,
    'MISSING',
    false,
    'Miel multifloral del Alto Valle.',
  ],
  [
    'Taller Confluencia',
    'Diseño de objetos',
    'Agustina Ferraro',
    '27-00000006-2',
    'APPROVED',
    true,
    'Luminarias y objetos en madera reciclada.',
  ],
  [
    'Birra Norpatagónica',
    'Cervecería artesanal',
    'Lucas Benedetti',
    '20-00000007-9',
    'REJECTED',
    false,
    'Cervezas de estilo con lúpulo patagónico.',
  ],
  [
    'Cuero Austral',
    'Marroquinería',
    'Diego Huenchumil',
    '20-00000008-7',
    'APPROVED',
    true,
    'Bolsos y cinturones de cuero curtido vegetal.',
  ],
  [
    'Frutos del Alto Valle',
    'Productos regionales',
    'Carla Domínguez',
    '27-00000009-3',
    'PENDING',
    true,
    'Dulces y frutas deshidratadas.',
  ],
  [
    'Jabonería Lafken',
    'Cosmética natural',
    'Sofía Melinao',
    '27-00000010-1',
    'APPROVED',
    true,
    'Jabones de glicerina con aromas del lago.',
  ],
  [
    'Alfarería Collón Curá',
    'Cerámica',
    'Ignacio Rivas',
    '20-00000011-8',
    'MISSING',
    false,
    'Piezas de barro cocido a leña.',
  ],
  [
    'Cafetería Viento Sur',
    'Gastronomía',
    'Valentina Sosa',
    '27-00000012-4',
    'PENDING',
    true,
    'Café de especialidad y pastelería.',
  ],
];

export const DEMO_EXHIBITORS: readonly ExhibitorSummaryDto[] = ROWS.map(
  (
    [tradeName, category, legalName, taxId, documentsStatus, publicContactOptIn, description],
    i,
  ) => ({
    id: `demo-exh-${String(i + 1).padStart(2, '0')}`,
    tradeName,
    legalName,
    taxId,
    category,
    description,
    publicContactOptIn,
    documentsStatus,
  }),
);

/** Stand-in for EXH-01 (`GET /api/v1/exhibitors`). */
export class InMemoryExhibitorRepository extends ExhibitorRepository {
  constructor(private readonly seed: readonly ExhibitorSummaryDto[] = DEMO_EXHIBITORS) {
    super();
  }

  list(): Observable<readonly ExhibitorSummaryDto[]> {
    return defer(() => of(this.seed));
  }
}
