'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  ArrowRight,
  Save,
  Image as ImageIcon,
  Wand2,
  ChevronLeft,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Expand,
  LayoutPanelLeft,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useProject } from '@/lib/useProject';
import { CharacterReferencePicker, useReferenceDrafts } from '@/components/characters/CharacterReferencePicker';
import { SheetReviewBadge } from '@/components/characters/SheetReviewBadge';
import { CharacterSheetModal } from '@/components/characters/CharacterSheetModal';
import { CharacterSheetReference, CharacterSheetResponse, DraftCharacterSheetResponse } from '@/lib/types/image-generation';
import { createCharacterFromSheet, draftCharacterSheet } from '@/lib/api/image-generation';
import { useSheetModel } from '@/components/characters/useSheetModel';
import { StoryboardModelPicker } from '@/components/studio/workspace/StoryboardModelPicker';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

// Workflow steps: pick how to start, describe or upload, review sheet versions, save.
type AppStep = 'mode-select' | 'text-input' | 'image-input' | 'sheet-preview' | 'save-character' | 'saved';

interface CharacterMetadata {
  name: string;
  description: string;
  role: string;
}

/** What the last sheet was generated from, so another version can reuse it. */
interface SheetInputs {
  prompt: string;
  references: CharacterSheetReference[];
}

const CHARACTER_DESCRIPTION_PROMPT = `A heroic knight in her thirties with glowing blue plate armor, a weathered navy cape, and a silver longsword at her hip. Short dark hair, a thin scar through the left eyebrow, a determined expression, practical leather boots, high-detail fantasy concept-art styling.`;

const backButtonClass = 'flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 hover:border-zinc-700 transition-colors';

function CharacterCreatorContent() {
  const searchParams = useSearchParams();
  const intent = searchParams.get('intent');
  const initialName = searchParams.get('name') || '';
  const initialRole = searchParams.get('role') || '';
  const queryProjectId = searchParams.get('projectId') || searchParams.get('project_id');
  const { projects, listProjects } = useProject();
  const referenceDrafts = useReferenceDrafts();

  const [step, setStep] = useState<AppStep>(intent === 'scene-extraction' ? 'text-input' : 'mode-select');
  const [prompt, setPrompt] = useState(
    intent === 'scene-extraction'
      ? `${initialName}, who acts as the ${initialRole} in the story.`
      : ''
  );
  const [guidancePrompt, setGuidancePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | Error>('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [sheets, setSheets] = useState<DraftCharacterSheetResponse[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [lastInputs, setLastInputs] = useState<SheetInputs | null>(null);
  const [adjustment, setAdjustment] = useState('');
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [saveError, setSaveError] = useState<string | Error>('');
  const [savedCharacter, setSavedCharacter] = useState<CharacterSheetResponse | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(queryProjectId);
  const [sheetModel, setSheetModel] = useSheetModel(projectId);
  const [charData, setCharData] = useState<CharacterMetadata>({ name: initialName, description: '', role: initialRole });

  const selectedSheet = sheets.find((sheet) => sheet.sheet_asset_id === selectedSheetId) ?? sheets[0] ?? null;

  useEffect(() => {
    void listProjects();
  }, [listProjects]);

  // Progress estimate while the single sheet request runs.
  useEffect(() => {
    if (!isGenerating) {
      setGenerationProgress(0);
      return;
    }
    let currentProgress = 0;
    const progressInterval = setInterval(() => {
      const remaining = 100 - currentProgress;
      const increment = remaining > 70 ? Math.random() * 6 + 2 : remaining > 30 ? Math.random() * 3 + 1 : 0.4;
      currentProgress = Math.min(currentProgress + increment, 95);
      setGenerationProgress(Math.round(currentProgress));
    }, 500);
    return () => clearInterval(progressInterval);
  }, [isGenerating]);

  const selectCreationMode = (nextStep: 'text-input' | 'image-input') => {
    setGenerationError('');
    setStep(nextStep);
  };

  const runGeneration = async (inputs: SheetInputs) => {
    if (!projectId) {
      setGenerationError('Select a project before generating a character.');
      return;
    }
    setGenerationError('');
    setIsGenerating(true);
    try {
      const sheet = await draftCharacterSheet({
        project_id: projectId,
        prompt: inputs.prompt,
        references: inputs.references,
        model: sheetModel,
      });
      setGenerationProgress(100);
      setLastInputs(inputs);
      setSheets((current) => [sheet, ...current]);
      setSelectedSheetId(sheet.sheet_asset_id);
      setStep('sheet-preview');
    } catch (error) {
      setGenerationError(error instanceof Error ? error : 'Character sheet generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = () => {
    if (step === 'image-input') {
      if (referenceDrafts.references.length === 0) {
        setGenerationError('Add at least one reference image.');
        return;
      }
      void runGeneration({ prompt: guidancePrompt.trim(), references: referenceDrafts.toRequest() });
      return;
    }
    if (!prompt.trim()) {
      setGenerationError('Please enter a character description.');
      return;
    }
    void runGeneration({ prompt: prompt.trim(), references: [] });
  };

  /** Same inputs as the last sheet, plus any adjustment, as a new version to compare. */
  const handleGenerateAnother = () => {
    if (!lastInputs) return;
    const extra = adjustment.trim();
    void runGeneration({
      prompt: extra ? [lastInputs.prompt, `Changes for this version: ${extra}`].filter(Boolean).join('\n\n') : lastInputs.prompt,
      references: lastInputs.references,
    });
    setAdjustment('');
  };

  const handleSaveCharacter = async () => {
    if (!projectId || !selectedSheet) {
      setSaveError('Generate a character sheet before saving.');
      return;
    }
    if (!charData.name.trim()) {
      setSaveError('Character name is required.');
      return;
    }
    setSaveError('');
    setIsSavingCharacter(true);
    try {
      const saved = await createCharacterFromSheet({
        project_id: projectId,
        sheet_asset_id: selectedSheet.sheet_asset_id,
        name: charData.name.trim(),
        role: charData.role.trim() || undefined,
        description: charData.description.trim() || undefined,
      });
      setSavedCharacter(saved);
      setStep('saved');
    } catch (error) {
      setSaveError(error instanceof Error ? error : 'Character save failed');
    } finally {
      setIsSavingCharacter(false);
    }
  };

  const startOver = () => {
    referenceDrafts.clear();
    setPrompt('');
    setGuidancePrompt('');
    setAdjustment('');
    setSheets([]);
    setSelectedSheetId(null);
    setLastInputs(null);
    setSavedCharacter(null);
    setCharData({ name: '', description: '', role: '' });
    setGenerationError('');
    setSaveError('');
    setStep('mode-select');
  };

  const renderError = () => <ErrorBanner error={generationError} onDismiss={() => setGenerationError('')} compact className="rounded-xl px-4 py-3" />;

  const renderProjectSelect = () => (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-3 ml-1">Project</label>
      <select
        value={projectId || ''}
        onChange={(event) => setProjectId(event.target.value || null)}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 focus:outline-none"
      >
        <option value="">Select a project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </div>
  );

  const renderSheetExplainer = () => (
    <div className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <LayoutPanelLeft className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
      <p className="text-xs leading-relaxed text-zinc-400">
        You get <span className="text-zinc-200">one character sheet</span>: a large face close-up and a full-body
        turnaround (front, 3/4, profile, back) on a plain background. Each result is checked for all five parts and redrawn
        if any is missing. Storyboards use it as this character&apos;s reference in every shot.
      </p>
    </div>
  );

  // Generation progress overlay
  const renderGenerationProgress = () => (
    <AnimatePresence>
      {isGenerating && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: 20, scale: 0.95 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="bg-zinc-950 border border-zinc-800 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
          >
            <div className="flex items-center justify-between text-sm font-semibold mb-2" role="status" aria-live="polite">
              <span className="text-zinc-300 flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin text-indigo-400" />
                Generating character sheet...
              </span>
              <span className="text-indigo-400 font-mono text-xs">{generationProgress}%</span>
            </div>
            <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden">
              <motion.div
                className="bg-linear-to-r from-indigo-600 via-indigo-500 to-purple-600 h-full rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: `${generationProgress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="mt-4 text-center text-xs text-zinc-500">
              Drawing the face close-up and every turnaround angle in one image, then checking that all of them are there. A sheet with a missing part is redrawn automatically, so this can take a few tries.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Shared model selector: the same WaveSpeed edit models as storyboard frames.
  const renderModelSelector = () => (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <StoryboardModelPicker value={sheetModel} onChange={setSheetModel} disabled={isGenerating} label="Character model" align="start" />
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">Same WaveSpeed models as storyboard frames, so characters and shots come from one model.</p>
    </div>
  );

  // 1: Choose how to start
  const renderModeSelect = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-4xl mx-auto mt-6">
      <div className="text-center mb-16">
        <div className="uppercase tracking-widest text-indigo-400 text-xs font-semibold mb-3">Creation</div>
        <h1 className="text-4xl md:text-5xl font-display font-medium mb-4">Welcome to Character Area</h1>
        <p className="text-zinc-400 text-lg">Create one character sheet: a face close-up and a full turnaround in a single image.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <button
          onClick={() => selectCreationMode('text-input')}
          className="group flex flex-col items-center justify-center p-12 border border-zinc-800 rounded-3xl bg-zinc-900/50 hover:bg-zinc-800/80 hover:border-zinc-700 transition duration-300"
        >
          <div className="w-20 h-20 rounded-2xl bg-zinc-800 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-500/20 transition-all duration-300">
            <FileText className="w-10 h-10 text-indigo-400" />
          </div>
          <h3 className="text-2xl font-display font-medium text-zinc-100">Describe your character</h3>
          <p className="text-zinc-500 mt-2 text-center">Start from a written description: look, build, costume and style.</p>
          <div className="mt-8 flex items-center gap-2 text-indigo-400 font-medium bg-indigo-500/10 px-6 py-2 rounded-full">
            Create <ArrowRight className="w-4 h-4 ml-1" />
          </div>
        </button>

        <button
          onClick={() => selectCreationMode('image-input')}
          className="group flex flex-col items-center justify-center p-12 border border-zinc-800 rounded-3xl bg-zinc-900/50 hover:bg-zinc-800/80 hover:border-zinc-700 transition duration-300"
        >
          <div className="w-20 h-20 rounded-2xl bg-zinc-800 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-purple-500/20 transition-all duration-300">
            <ImageIcon className="w-10 h-10 text-purple-400" />
          </div>
          <h3 className="text-2xl font-display font-medium text-zinc-100">Reference images + prompt</h3>
          <p className="text-zinc-500 mt-2 text-center">Up to four images for the face, the outfit or the style, plus a prompt.</p>
          <div className="mt-8 flex items-center gap-2 text-purple-400 font-medium bg-purple-500/10 px-6 py-2 rounded-full">
            Create <ArrowRight className="w-4 h-4 ml-1" />
          </div>
        </button>
      </div>
    </motion.div>
  );

  // 2A: Describe
  const renderTextInput = () => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-2xl mx-auto mt-6">
      <button onClick={() => setStep('mode-select')} title="Back to mode selection" aria-label="Back to mode selection" className={cn(backButtonClass, 'mb-8')}>
        <ChevronLeft className="w-5 h-5" />
      </button>

      <h2 className="text-3xl font-display font-medium mb-8">Describe your character</h2>

      <div className="space-y-8 bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl">
        {renderSheetExplainer()}
        <div>
          <div className="flex items-center justify-between gap-3 mb-3 ml-1">
            <label htmlFor="character-description" className="text-sm font-medium text-zinc-300">Character description</label>
            <button
              type="button"
              title="Fill with character description example"
              onClick={() => {
                setPrompt(CHARACTER_DESCRIPTION_PROMPT);
                setGenerationError('');
              }}
              className="shrink-0 flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/10 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              <Sparkles size={14} className="text-indigo-300" />
              Use Example
            </button>
          </div>
          <textarea
            id="character-description"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={4000}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 min-h-40 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 focus:outline-none transition-all resize-none text-zinc-200 placeholder-zinc-600"
            placeholder="Age, build, face, hair, costume, distinguishing marks, and the art style..."
          />
        </div>

        {renderProjectSelect()}
        {renderModelSelector()}
        {renderError()}

        <button
          onClick={handleGenerate}
          disabled={isGenerating || !projectId}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Wand2 className="w-5 h-5" /> {projectId ? 'Generate character sheet' : 'Select a project'}
        </button>
      </div>
    </motion.div>
  );

  // 2B: Reference images + prompt
  const renderImageInput = () => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-2xl mx-auto mt-6">
      <button onClick={() => setStep('mode-select')} title="Back to mode selection" aria-label="Back to mode selection" className={cn(backButtonClass, 'mb-8')}>
        <ChevronLeft className="w-5 h-5" />
      </button>

      <h2 className="text-3xl font-display font-medium mb-8">Reference images + prompt</h2>

      <div className="space-y-8 bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl">
        {renderSheetExplainer()}
        <div>
          <span className="block text-sm font-medium text-zinc-300 mb-3 ml-1">Reference images</span>
          <CharacterReferencePicker drafts={referenceDrafts} disabled={isGenerating} gridClassName="grid-cols-2 sm:grid-cols-4" />
        </div>

        <div>
          <label htmlFor="character-guidance" className="block text-sm font-medium text-zinc-300 mb-3 ml-1">Prompt (optional)</label>
          <textarea
            id="character-guidance"
            value={guidancePrompt}
            onChange={(e) => setGuidancePrompt(e.target.value)}
            maxLength={4000}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 min-h-24 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 focus:outline-none transition-all resize-none text-zinc-200 placeholder-zinc-600"
            placeholder='What to change or add, e.g. "make her older, grey stubble, wear the coat from image 2 open"'
          />
        </div>

        {renderProjectSelect()}
        {renderModelSelector()}
        {renderError()}

        <button
          onClick={handleGenerate}
          disabled={isGenerating || referenceDrafts.references.length === 0 || !projectId}
          className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <ImageIcon className="w-5 h-5" />
          {!projectId ? 'Select a project' : referenceDrafts.references.length === 0 ? 'Add a reference image' : 'Generate character sheet'}
        </button>
      </div>
    </motion.div>
  );

  // 3: Review sheet versions
  const renderSheetPreview = () => selectedSheet && (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-6xl mx-auto mt-6">
      <button
        onClick={() => setStep(lastInputs?.references.length ? 'image-input' : 'text-input')}
        title="Back to inputs"
        aria-label="Back to inputs"
        className={cn(backButtonClass, 'mb-6')}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6 md:p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-display font-medium text-zinc-100 flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-indigo-400" />
            Character sheet
          </h3>
          <div className="text-sm font-medium px-3 py-1 rounded-full bg-zinc-800/50 border border-zinc-700/50 text-zinc-400">
            {sheets.length} version{sheets.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          <div className="flex-1 min-w-0">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
              <Image src={selectedSheet.sheet_url} alt="Generated character sheet" fill sizes="(max-width: 1024px) 100vw, 760px" unoptimized className="object-contain" />
            </div>
            <SheetReviewBadge review={selectedSheet.review} className="mt-3" />
            {sheets.length > 1 && (
              <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-2">
                {sheets.map((sheet, index) => {
                  const active = sheet.sheet_asset_id === selectedSheet.sheet_asset_id;
                  return (
                    <button
                      key={sheet.sheet_asset_id}
                      onClick={() => setSelectedSheetId(sheet.sheet_asset_id)}
                      aria-pressed={active}
                      title={`Version ${sheets.length - index}`}
                      className={cn('relative aspect-video overflow-hidden rounded-lg border-2 bg-zinc-950 transition-all', active ? 'border-indigo-500' : 'border-transparent hover:border-zinc-700')}
                    >
                      <Image src={sheet.sheet_url} alt={`Character sheet version ${sheets.length - index}`} fill sizes="160px" unoptimized className="object-cover" />
                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-white">v{sheets.length - index}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="w-full lg:w-80 flex flex-col gap-5">
            <div>
              <label htmlFor="sheet-adjustment" className="text-xs text-zinc-500 uppercase tracking-widest font-semibold block mb-3">Adjust for another version</label>
              <textarea
                id="sheet-adjustment"
                value={adjustment}
                onChange={(event) => setAdjustment(event.target.value)}
                maxLength={2000}
                placeholder="Optional, e.g. longer hair, darker coat, more weathered face."
                className="w-full min-h-24 resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-relaxed text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleGenerateAnother}
                disabled={isGenerating}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/50 bg-indigo-500/10 py-3 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
              >
                <RefreshCw className="h-4 w-4" />
                Generate another version
              </button>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">Uses the same description and reference images. Earlier versions stay here so you can compare.</p>
            </div>
            {renderError()}
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="w-full py-3 rounded-2xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm font-medium text-zinc-100 flex items-center justify-center gap-2 transition-colors"
            >
              <Expand className="w-4 h-4" /> Preview character
            </button>
            <button
              onClick={() => setStep('save-character')}
              className="mt-auto w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-medium shadow-lg shadow-indigo-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              Use this version <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // 4: Save
  const renderSaveCharacter = () => selectedSheet && (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-6xl mx-auto mt-6">
      <button onClick={() => setStep('sheet-preview')} title="Back to versions" aria-label="Back to versions" className={cn(backButtonClass, 'mb-6')}>
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl overflow-hidden shadow-2xl flex flex-col lg:flex-row">
        <div className="relative w-full lg:w-3/5 bg-zinc-950 shrink-0">
          <div className="relative aspect-video w-full">
            <Image src={selectedSheet.sheet_url} alt="Selected character sheet" fill sizes="(max-width: 1024px) 100vw, 60vw" unoptimized className="object-contain" />
          </div>
        </div>

        <div className="w-full lg:w-2/5 p-8 flex flex-col">
          <div className="mb-6">
            <div className="uppercase tracking-widest text-indigo-400 text-xs font-semibold mb-2">Last Step</div>
            <h2 className="text-3xl font-display font-medium text-zinc-100">Save your character</h2>
          </div>

          <div className="space-y-5 flex-1 flex flex-col">
            <div>
              <label htmlFor="character-name" className="text-xs text-zinc-500 uppercase tracking-widest font-semibold ml-1 mb-2 block">Character Name</label>
              <input
                id="character-name"
                type="text"
                placeholder="e.g. Sir Alarick"
                value={charData.name}
                onChange={(e) => setCharData({ ...charData, name: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
              />
            </div>
            <div>
              <label htmlFor="character-short-description" className="text-xs text-zinc-500 uppercase tracking-widest font-semibold ml-1 mb-2 block">Short Description</label>
              <textarea
                id="character-short-description"
                placeholder="A fierce warrior with a hidden past..."
                value={charData.description}
                onChange={(e) => setCharData({ ...charData, description: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none min-h-28"
              />
            </div>
            <div>
              <label htmlFor="character-role" className="text-xs text-zinc-500 uppercase tracking-widest font-semibold ml-1 mb-2 block">Role</label>
              <input
                id="character-role"
                type="text"
                placeholder="e.g. Protagonist / NPC"
                value={charData.role}
                onChange={(e) => setCharData({ ...charData, role: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <div className="mt-auto pt-4">
              <ErrorBanner error={saveError} onDismiss={() => setSaveError('')} compact className="mb-3" />
              <button
                onClick={handleSaveCharacter}
                disabled={isSavingCharacter}
                className="w-full py-4 shadow-lg shadow-indigo-900/20 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-400 rounded-xl font-medium flex items-center justify-center gap-2 text-white transition-transform hover:scale-[1.02] active:scale-100"
              >
                <Save className="w-5 h-5" /> {isSavingCharacter ? 'Saving...' : 'Save Character'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // 5: Saved
  const renderSaved = () => savedCharacter && (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-4xl mx-auto mt-10">
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          <div>
            <h2 className="text-2xl font-display font-medium text-zinc-100">{charData.name.trim()} is saved</h2>
            <p className="text-sm text-zinc-400">Storyboards in this project now use this sheet and its face close-up for {charData.name.trim()}.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          {savedCharacter.face_closeup_url && (
            <div className="relative aspect-3/4 w-full sm:w-40 shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
              <Image src={savedCharacter.face_closeup_url} alt={`${charData.name.trim()} face close-up`} fill sizes="160px" unoptimized className="object-cover" />
            </div>
          )}
          <div className="relative aspect-video flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <Image src={savedCharacter.sheet_url} alt={`${charData.name.trim()} character sheet`} fill sizes="(max-width: 640px) 100vw, 600px" unoptimized className="object-contain" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsPreviewOpen(true)}
          className="mt-8 w-full py-3 rounded-2xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm font-medium text-zinc-100 flex items-center justify-center gap-2 transition-colors"
        >
          <Expand className="w-4 h-4" /> Preview character
        </button>
        <button
          onClick={startOver}
          className="mt-3 w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Wand2 className="w-5 h-5" /> Create another character
        </button>
      </div>
    </motion.div>
  );

  return (
    <div className="min-h-screen bg-black text-zinc-50 font-sans selection:bg-purple-500/30">
      <AnimatePresence mode="wait">
        {step === 'mode-select' && <div key="mode">{renderModeSelect()}</div>}
        {step === 'text-input' && <div key="text">{renderTextInput()}</div>}
        {step === 'image-input' && <div key="image">{renderImageInput()}</div>}
        {step === 'sheet-preview' && <div key="sheet-preview" className="h-full">{renderSheetPreview()}</div>}
        {step === 'save-character' && <div key="save-character" className="h-full">{renderSaveCharacter()}</div>}
        {step === 'saved' && <div key="saved" className="h-full">{renderSaved()}</div>}
      </AnimatePresence>

      {renderGenerationProgress()}
      <CharacterSheetModal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        name={charData.name.trim() || 'New character'}
        subtitle={charData.role.trim() || (savedCharacter ? null : 'Not saved yet')}
        badges={savedCharacter ? ['Saved', 'Used in storyboards'] : [`${sheets.length} version${sheets.length === 1 ? '' : 's'}`]}
        sheetUrl={savedCharacter?.sheet_url ?? selectedSheet?.sheet_url ?? null}
        faceUrl={savedCharacter?.face_closeup_url}
        review={savedCharacter?.review ?? selectedSheet?.review}
        facts={[
          ...(charData.description.trim() ? [{ label: 'Description', value: charData.description.trim() }] : []),
          ...(lastInputs?.prompt ? [{ label: 'Prompt', value: lastInputs.prompt }] : []),
          ...(lastInputs?.references.length ? [{ label: 'Reference images', value: lastInputs.references.map((reference) => reference.tag).join(', ') }] : []),
        ]}
        versions={savedCharacter ? [] : sheets.map((sheet, index) => ({
          id: sheet.sheet_asset_id, url: sheet.sheet_url, label: `v${sheets.length - index}`,
        }))}
        initialUrl={savedCharacter ? null : selectedSheet?.sheet_url}
      />
    </div>
  );
}

export default function CharacterCreator() {
  return (
    <Suspense fallback={<div className="p-8 text-white">Loading Character Creator...</div>}>
      <CharacterCreatorContent />
    </Suspense>
  );
}
