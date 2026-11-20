import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { formatArs } from '../../../shared/money';
import { STATUS_LABEL, type PublicStandStatus } from '../data/public-catalog.repository';
import type { StandView } from '../domain/stand-filters';
import { galleryOf, type GalleryItem } from '../domain/stand-media';
import { browserShareEnv, copyLink, shareMedia, type ShareOption } from '../../../shared/share';

/** The share page of a publication: the link people share, with its preview tags. */
const shareUrlOf = (id: string): string => `${location.origin}/api/v1/public/share/${id}`;

const STATUS_ICON: Readonly<Record<PublicStandStatus, string>> = {
  AVAILABLE: '✓',
  RESERVED: '◷',
  OCCUPIED: '●',
  BLOCKED: '⊘',
};

/** Descriptions longer than this get the "Ver más" toggle (the clamp shows about three lines). */
const LONG_DESCRIPTION = 140;
const METERS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
/** Context shown around the stand in the miniature, in meters. */
const PLAN_PADDING_M = 3;

/**
 * Visitor stand detail: a native modal `<dialog>` (focus containment, Esc and focus return to the
 * invoker come from the browser). Presentational: the parent mounts it while a stand is open and
 * unmounts it on `closed`. Photos come from the consented exhibitor profile.
 */
@Component({
  selector: 'app-stand-detail-dialog',
  templateUrl: './stand-detail-dialog.html',
  styleUrl: './stand-detail-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StandDetailDialog {
  readonly stand = input.required<StandView>();
  /** Every stand of the plan: the neighbors are drawn faint around this one. */
  readonly plan = input<readonly StandView[]>([]);
  /** Publication a share link points to: shown first in the gallery. */
  readonly highlight = input<string | null>(null);

  readonly closed = output<void>();

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusIcon = STATUS_ICON;
  protected readonly formatArs = formatArs;
  protected readonly expanded = signal(false);

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly supportsClosedBy = 'closedBy' in HTMLDialogElement.prototype;

  protected readonly width = computed(() => METERS.format(this.stand().w));
  protected readonly depth = computed(() => METERS.format(this.stand().h));
  protected readonly area = computed(() => METERS.format(this.stand().areaM2));
  protected readonly hasPrice = computed(() => this.stand().priceCents > 0);
  protected readonly description = computed(() => this.stand().exhibitor?.description ?? null);
  protected readonly isLongDescription = computed(
    () => (this.description()?.length ?? 0) > LONG_DESCRIPTION,
  );

  protected readonly gallery = computed(() => galleryOf(this.stand().exhibitor, this.highlight()));
  /** Options for the publication whose share menu is open (no native menu in this browser). */
  protected readonly shareMenu = signal<{
    readonly id: string;
    readonly options: readonly ShareOption[];
  } | null>(null);
  protected readonly shareStatus = signal('');

  protected isProfile(item: GalleryItem): boolean {
    return item.id.startsWith('profile-');
  }

  /** Native share menu with the file when the browser has one; otherwise the links menu. */
  protected async share(item: GalleryItem): Promise<void> {
    const exhibitor = this.stand().exhibitor;
    if (!exhibitor) return;
    this.shareStatus.set('');
    const outcome = await shareMedia(
      {
        pageUrl: shareUrlOf(item.id),
        url: item.url,
        contentType: item.kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg',
        caption: item.caption,
        exhibitorName: exhibitor.name,
      },
      browserShareEnv(),
    );
    this.shareMenu.set(outcome.kind === 'options' ? { id: item.id, options: outcome.options } : null);
  }

  protected async copy(id: string): Promise<void> {
    const ok = await copyLink(shareUrlOf(id));
    this.shareStatus.set(
      ok ? 'Link copiado.' : 'No pudimos copiar el link. Copialo desde la barra de direcciones.',
    );
  }

  protected readonly miniature = computed(() => {
    const s = this.stand();
    const x = s.x - PLAN_PADDING_M;
    const y = s.y - PLAN_PADDING_M;
    const w = s.w + PLAN_PADDING_M * 2;
    const h = s.h + PLAN_PADDING_M * 2;
    const neighbors = this.plan().filter(
      (o) => o.id !== s.id && o.x < x + w && o.x + o.w > x && o.y < y + h && o.y + o.h > y,
    );
    return {
      viewBox: `${x} ${y} ${w} ${h}`,
      neighbors,
      fontSize: Math.max(w * 0.032, h * 0.06),
    };
  });

  constructor() {
    afterNextRender(() => {
      const dialog = this.dialogRef().nativeElement;
      // jsdom has no showModal(); the attribute keeps the content reachable there.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  protected close(): void {
    const dialog = this.dialogRef().nativeElement;
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      this.closed.emit();
    }
  }

  /** The browser already closed it (Esc, back gesture, light dismiss or our Close button). */
  protected onClosed(): void {
    this.closed.emit();
  }

  /** Fallback of `closedby="any"`: the panel fills the dialog, so only the backdrop hits it. */
  protected onDialogClick(e: MouseEvent): void {
    if (!this.supportsClosedBy && e.target === this.dialogRef().nativeElement) this.close();
  }
}
