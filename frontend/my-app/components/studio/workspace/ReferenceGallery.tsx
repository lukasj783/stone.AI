"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Images, RefreshCw, Star, Trash2, Upload, Wand2 } from 'lucide-react';
import ImagePreviewModal, { ImagePreview } from '@/components/ui/ImagePreviewModal';
import {
  deleteEntityReference,
  generateEntityReferences,
  listEntityReferences,
  setEntityPrimaryReference,
  uploadEntityReference,
} from '@/lib/api/image-generation';
import { EntityReference, EntityReferenceAngle, ReferenceEntityType } from '@/lib/types/image-generation';

interface ReferenceGalleryProps {
  projectId: string;
  entityType: ReferenceEntityType;
  entityId: string;
  entityName: string;
  /** Bumped by the parent after it creates a new main image, so the gallery reloads. */
  refreshKey?: number;
  /** Called after the gallery changes, so the parent can refresh its main image. */
  onChanged?: () => void;
}

/**
 * Several reference images for one environment or object. The storyboard picks from
 * these per shot: wide shots take more of the location, close-ups more of the object.
 */
export function ReferenceGallery({ projectId, entityType, entityId, entityName, refreshKey = 0, onChanged }: ReferenceGalleryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [references, setReferences] = useState<EntityReference[]>([]);
  const [angles, setAngles] = useState<EntityReferenceAngle[]>([]);
  const [selectedAngles, setSelectedAngles] = useState<string[]>([]);
  const [uploadAngle, setUploadAngle] = useState('');
  const [busy, setBusy] = useState<'load' | 'generate' | 'upload' | 'update' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const noun = entityType === 'environment' ? 'location' : 'object';
  const aspectClass = entityType === 'environment' ? 'aspect-video' : 'aspect-square';

  const load = useCallback(async () => {
    setBusy('load'); setError(null);
    try {
      const result = await listEntityReferences(projectId, entityType, entityId);
      setReferences(result.references); setAngles(result.available_angles);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Failed to load reference images.'); }
    finally { setBusy(null); }
  }, [projectId, entityType, entityId]);

  useEffect(() => { setSelectedAngles([]); setNotice(null); void load(); }, [load, refreshKey]);

  const run = async (kind: 'generate' | 'upload' | 'update', action: () => Promise<string | null>) => {
    setBusy(kind); setError(null); setNotice(null);
    try {
      const message = await action();
      await load(); onChanged?.();
      if (message) setNotice(message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Reference update failed.'); }
    finally { setBusy(null); }
  };

  const hasPrimary = references.some((reference) => reference.is_primary);
  const existingAngles = new Set(references.map((reference) => reference.angle));
  const toggleAngle = (angle: string) => setSelectedAngles((current) => current.includes(angle) ? current.filter((value) => value !== angle) : [...current, angle]);

  const generate = () => run('generate', async () => {
    const result = await generateEntityReferences(projectId, entityType, entityId, selectedAngles);
    setSelectedAngles([]);
    const failed = Object.keys(result.failed);
    return failed.length
      ? `Added ${result.references.length} image(s). Could not generate: ${failed.map((angle) => angles.find((item) => item.angle === angle)?.label ?? angle).join(', ')}.`
      : `Added ${result.references.length} new angle${result.references.length === 1 ? '' : 's'}.`;
  });

  const upload = (files: FileList | null) => {
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    void run('upload', async () => {
      for (const image of images) await uploadEntityReference(projectId, entityType, entityId, image, uploadAngle || undefined);
      return `Uploaded ${images.length} image${images.length === 1 ? '' : 's'}.`;
    });
  };

  const previews: ImagePreview[] = references.map((reference) => ({
    id: reference.asset_id, url: reference.url, prompt: `${entityName} - ${reference.label}`, model: 'Reference image', aspect_ratio: entityType === 'environment' ? '16:9' : '1:1',
  }));
  const isBusy = busy !== null && busy !== 'load';
  const chipClass = 'border px-2 py-1 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';

  return <section className="mt-4 border-t border-zinc-800 pt-4">
    <div className="mb-2 flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300"><Images className="h-3.5 w-3.5" />Reference images</span>
      <span className="font-mono text-[10px] text-zinc-600">{busy === 'load' ? 'Loading...' : `${references.length} image${references.length === 1 ? '' : 's'}`}</span>
    </div>
    {references.length > 0 ? <div className="grid grid-cols-3 gap-2">{references.map((reference, index) => (
      <div key={reference.asset_id} className={`group relative ${aspectClass} overflow-hidden border bg-zinc-900 ${reference.is_primary ? 'border-violet-400' : 'border-zinc-800'}`}>
        <button type="button" onClick={() => setPreviewIndex(index)} aria-label={`Preview ${reference.label}`} className="absolute inset-0 cursor-zoom-in"><Image src={reference.url} alt={`${entityName} ${reference.label}`} fill sizes="128px" unoptimized className={entityType === 'environment' ? 'object-cover' : 'object-contain'} /></button>
        <span className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-zinc-950/85 px-1 py-0.5 text-[9px] font-medium text-zinc-300">{reference.is_primary ? 'Main · ' : ''}{reference.label}</span>
        <div className="absolute right-0.5 top-0.5 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {!reference.is_primary && <button type="button" disabled={isBusy} onClick={() => void run('update', async () => { await setEntityPrimaryReference(projectId, entityType, entityId, reference.asset_id); return `${reference.label} is now the main image.`; })} title="Make main image" className="flex h-5 w-5 items-center justify-center bg-zinc-950/85 text-zinc-300 hover:text-violet-300"><Star className="h-3 w-3" /></button>}
          <button type="button" disabled={isBusy} onClick={() => { if (window.confirm(`Remove "${reference.label}" from ${entityName}? The image stays in the asset library.`)) void run('update', async () => { await deleteEntityReference(projectId, entityType, entityId, reference.asset_id); return 'Reference removed.'; }); }} title="Remove from references" className="flex h-5 w-5 items-center justify-center bg-zinc-950/85 text-zinc-300 hover:text-red-300"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
    ))}</div> : busy !== 'load' && <p className="border border-dashed border-zinc-800 px-3 py-3 text-[11px] leading-relaxed text-zinc-500">No images yet. Create the main image above or upload your own, then add more angles so storyboard shots of this {noun} stay consistent.</p>}

    <div className="mt-3">
      <span className="text-[10px] uppercase tracking-wide text-zinc-600">Generate more angles</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{angles.map((angle) => {
        const exists = existingAngles.has(angle.angle);
        const active = selectedAngles.includes(angle.angle);
        return <button key={angle.angle} type="button" disabled={!hasPrimary || isBusy} onClick={() => toggleAngle(angle.angle)} aria-pressed={active} title={exists ? 'Already added; select to generate another' : undefined} className={`${chipClass} ${active ? 'border-violet-400 bg-violet-500/15 text-violet-200' : exists ? 'border-emerald-500/30 text-emerald-300' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}>{exists && !active ? '✓ ' : ''}{angle.label}</button>;
      })}</div>
      {!hasPrimary && busy !== 'load' && <p className="mt-1.5 text-[10px] text-zinc-600">New angles are generated from the main image, so add one first.</p>}
      <button type="button" onClick={() => void generate()} disabled={!hasPrimary || !selectedAngles.length || isBusy} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 border border-violet-400/40 bg-violet-500/10 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50">{busy === 'generate' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}{busy === 'generate' ? `Generating ${selectedAngles.length} angle${selectedAngles.length === 1 ? '' : 's'}...` : selectedAngles.length ? `Generate ${selectedAngles.length} selected` : 'Select angles to generate'}</button>
    </div>

    <div className="mt-3">
      <span className="text-[10px] uppercase tracking-wide text-zinc-600">Upload your own</span>
      <div className="mt-1.5 flex gap-2">
        <select value={uploadAngle} onChange={(event) => setUploadAngle(event.target.value)} disabled={isBusy} aria-label="Angle of uploaded image" className="h-8 min-w-0 flex-1 border border-zinc-700 bg-zinc-950 px-2 text-[11px] text-zinc-200 outline-none focus:border-violet-400">
          <option value="">Any angle</option>
          {angles.map((angle) => <option key={angle.angle} value={angle.angle}>{angle.label}</option>)}
        </select>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy} className="inline-flex h-8 items-center gap-1.5 border border-zinc-700 px-3 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-900 disabled:opacity-50">{busy === 'upload' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{busy === 'upload' ? 'Uploading...' : 'Upload'}</button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { upload(event.target.files); event.target.value = ''; }} />
      </div>
    </div>

    {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
    {notice && <p role="status" className="mt-2 text-[11px] text-emerald-300">{notice}</p>}
    <ImagePreviewModal isOpen={previewIndex !== null} onClose={() => setPreviewIndex(null)} images={previews} selectedIndex={previewIndex ?? 0} onNavigate={(index: number) => setPreviewIndex(index)} />
  </section>;
}
