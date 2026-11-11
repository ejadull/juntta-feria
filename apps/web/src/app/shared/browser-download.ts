import { InjectionToken } from '@angular/core';

/** Saves a blob as a file through a temporary link. A token so tests never touch the DOM download. */
export const BROWSER_DOWNLOAD = new InjectionToken<(blob: Blob, filename: string) => void>(
  'BrowserDownload',
  {
    providedIn: 'root',
    factory: () => (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  },
);
