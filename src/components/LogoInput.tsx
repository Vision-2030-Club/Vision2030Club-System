'use client';

import { useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui';

/** Longest side of a stored logo, in pixels. Twice the largest size it is shown at. */
const SIDE = 160;

/**
 * A logo picker that needs no file storage. The chosen image is shrunk in the
 * browser to at most SIDE×SIDE and written into the hidden `logo_data` field
 * as a `data:` URL, a few kilobytes, which the server stores in
 * `companies.logo_url` like any other address. The original file is never
 * sent: the file input has no name.
 *
 * Any image the browser can open works (SVG included); what is stored is
 * always a raster, so nothing in it can run.
 */
export function LogoInput({ id }: { id: string }) {
  const t = useTranslations('interviews');
  const [data, setData] = useState('');
  const [failed, setFailed] = useState(false);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFailed(false);
    setData('');
    if (!file) return;
    try {
      setData(await shrink(file));
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-2">
      <Input id={id} type="file" accept="image/*" onChange={onChange} />
      <input type="hidden" name="logo_data" value={data} />
      {data ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data} alt="" width={48} height={48} className="size-12 rounded-lg border border-line bg-surface-muted object-contain p-1" />
      ) : null}
      {failed ? <p className="text-xs text-danger">{t('errors.not_image')}</p> : null}
    </div>
  );
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, SIDE / Math.max(image.naturalWidth || SIDE, image.naturalHeight || SIDE));
    const width = Math.max(1, Math.round((image.naturalWidth || SIDE) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || SIDE) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    // WebP keeps transparency and is smallest; a browser that cannot write
    // it hands back a PNG instead, which is fine too.
    return canvas.toDataURL('image/webp', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
