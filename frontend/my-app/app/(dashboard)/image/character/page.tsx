'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  ArrowRight,
  Save,
  Image as ImageIcon,
  Wand2,
  UploadCloud,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Sparkles,
  X,
  RefreshCw,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useProject } from '@/lib/useProject';
import {
  CharacterKeyframe,
  CharacterView,
  ImageModel as ApiImageModel,
  CreateImageRequest,
} from '@/lib/types/image-generation';
import {
  finalizeCharacter,
  generateCharacterImages,
  generateImageFromUpload,
  regenerateCharacterKeyframe,
} from '@/lib/api/image-generation';

// Workflow Steps
type AppStep = 'mode-select' | 'text-input' | 'image-input' | 'grid-preview' | 'save-character';

interface CharacterMetadata {
  name: string;
  description: string;
  role: string;
}

const characterViewLabels: Record<CharacterView, string> = {
  front: 'Front View',
  left_three_quarter: 'Left 3/4 View',
  left_profile: 'Left Profile',
  back: 'Back View',
  right_profile: 'Right Profile',
  right_three_quarter: 'Right 3/4 View',
};

type GenerationModel = {
  id: number;
  apiModel: ApiImageModel | string;
  name: string;
  creator: string;
  tags: string[];
  thumbnail: string;
  provider: 'replicate' | 'wavespeed';
  modes: Array<'text' | 'upload'>;
};

const CHARACTER_DESCRIPTION_PROMPT = `A full-body heroic knight with glowing blue armor, a weathered navy cape, and a silver longsword. The character has short dark hair, a determined expression, practical leather boots, and high-detail fantasy concept-art styling.`;

const characterModels: GenerationModel[] = [
  {
    id: 1,
    apiModel: 'nanobanana',
    name: 'Nanobanana Pro',
    creator: 'Google',
    tags: ['Standard'],
    thumbnail: 'from-fuchsia-900 via-purple-900 to-indigo-900',
    provider: 'replicate',
    modes: ['text', 'upload'],
  },
  {
    id: 101,
    apiModel: 'google/nano-banana-pro/text-to-image-multi',
    name: 'Nanobanana Pro',
    creator: 'Google',
    tags: ['Standard', 'Multi'],
    thumbnail: 'from-fuchsia-900 via-purple-900 to-indigo-900',
    provider: 'wavespeed',
    modes: ['text', 'upload'],
  },
  {
    id: 6,
    apiModel: 'nanobanana2',
    name: 'Nanobanana 2',
    creator: 'Google',
    tags: ['Standard', 'Search'],
    thumbnail: 'from-yellow-900 via-orange-900 to-amber-900',
    provider: 'replicate',
    modes: ['text', 'upload'],
  },
  {
    id: 106,
    apiModel: 'google/nano-banana-2/text-to-image',
    name: 'Nanobanana 2',
    creator: 'Google',
    tags: ['Standard', 'Search'],
    thumbnail: 'from-yellow-900 via-orange-900 to-amber-900',
    provider: 'wavespeed',
    modes: ['text', 'upload'],
  },
  {
    id: 201,
    apiModel: 'openai/gpt-image-2/edit',
    name: 'GPT Image 2 Edit',
    creator: 'OpenAI',
    tags: ['Edit', 'Reference'],
    thumbnail: 'from-emerald-900 via-teal-900 to-cyan-900',
    provider: 'wavespeed',
    modes: ['upload'],
  },
];

function CharacterCreatorContent() {
  const searchParams = useSearchParams();
  const intent = searchParams.get('intent');
  const initialName = searchParams.get('name') || '';
  const initialRole = searchParams.get('role') || '';
  const queryProjectId = searchParams.get('projectId') || searchParams.get('project_id');
  const { projects, listProjects } = useProject();

  // File upload ref (following editor component pattern)
  const fileInputRef = useRef<HTMLInputElement>(null);  const [step, setStep] = useState<AppStep>(intent === 'scene-extraction' ? 'text-input' : 'mode-select');
  const [prompt, setPrompt] = useState(
    intent === 'scene-extraction'
      ? `A high quality concept art character portrait of ${initialName}, who acts as the ${initialRole} in the story.`
      : 'A heroic knight with glowing blue armor standing in a moonlit forest.'
  );
  const [selectedModel, setSelectedModel] = useState<GenerationModel>(characterModels[0]);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generatedKeyframes, setGeneratedKeyframes] = useState<CharacterKeyframe[]>([]);
  const [generationJobId, setGenerationJobId] = useState<string | null>(null);
  const [isHoveringCarousel, setIsHoveringCarousel] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFilePreview, setUploadedFilePreview] = useState<string>('');
  const [guidancePrompt, setGuidancePrompt] = useState('');
  const [lastGenerationPrompt, setLastGenerationPrompt] = useState(prompt);
  const [repairGuidance, setRepairGuidance] = useState('');
  const [isRegeneratingKeyframe, setIsRegeneratingKeyframe] = useState(false);
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [projectId, setProjectId] = useState<string | null>(queryProjectId);

  const [charData, setCharData] = useState<CharacterMetadata>({
    name: initialName,
    description: '',
    role: initialRole,
  });

  useEffect(() => {
    if (step !== 'save-character' || isHoveringCarousel) return;
    const interval = setInterval(() => {
      setSelectedImageIndex((prev) => (prev < generatedImages.length - 1 ? prev + 1 : 0));
    }, 3000);
    return () => clearInterval(interval);
  }, [step, isHoveringCarousel, generatedImages.length]);

  // Cleanup object URL on unmount or preview change
  useEffect(() => {
    return () => {
      if (uploadedFilePreview) {
        URL.revokeObjectURL(uploadedFilePreview);
      }
    };
  }, [uploadedFilePreview]);

  useEffect(() => {
    void listProjects();
  }, [listProjects]);

  // Progress tracking effect
  useEffect(() => {
    if (!isGenerating) {
      setGenerationProgress(0);
      return;
    }

    let currentProgress = 0;

    const incrementProgress = () => {
      // Exponential backoff: faster at start, slower towards 100%
      const remaining = 100 - currentProgress;
      const increment = remaining > 70 ? Math.random() * 8 + 3 : remaining > 30 ? Math.random() * 4 + 1 : 0.5;
      currentProgress = Math.min(currentProgress + increment, 95); // Cap at 95% until complete
      setGenerationProgress(Math.round(currentProgress));
    };

    const progressInterval = setInterval(incrementProgress, 400);
    return () => clearInterval(progressInterval);
  }, [isGenerating]);

  const selectCreationMode = (nextStep: 'text-input' | 'image-input') => {
    const requiredMode = nextStep === 'text-input' ? 'text' : 'upload';
    if (!selectedModel.modes.includes(requiredMode)) {
      setSelectedModel(characterModels.find((model) => model.modes.includes(requiredMode))!);
    }
    setStep(nextStep);
  };

  const handleGenerate = async () => {
    // For image-input mode, check if file is uploaded
    if (step === 'image-input' && !uploadedFile) {
      setGenerationError('Please upload an image first');
      return;
    }

    // For text-input mode, check if prompt is present
    if (step === 'text-input' && !prompt.trim()) {
      setGenerationError('Please enter a character description');
      return;
    }

    if (!projectId) {
      setGenerationError('Select a project before generating a character.');
      return;
    }

    setGenerationError('');
    setIsGenerating(true);
    setGenerationProgress(0);
    try {
      if (step === 'image-input' && uploadedFile) {
        // Image-to-image mode
        const response = await generateImageFromUpload(
          uploadedFile,
          guidancePrompt,
          selectedModel.apiModel as string,
          selectedModel.provider,
          projectId
        );
        if (!response.keyframes?.length || !response.generation_job_id) {
          throw new Error('Character generation returned incomplete keyframes');
        }
        setGenerationProgress(100);
        setLastGenerationPrompt(guidancePrompt);
        setGeneratedImages(response.images);
        setGeneratedKeyframes(response.keyframes);
        setGenerationJobId(response.generation_job_id);
        setSelectedImageIndex(0);
        setStep('grid-preview');
      } else {
        // Text-to-image mode (character description)
        const payload: CreateImageRequest = {
          model: selectedModel.apiModel,
          provider: selectedModel.provider,
          prompt,
          aspect_ratio: '1:1',
          num_images: 1,
          project_id: projectId || undefined,
        };

        const response = await generateCharacterImages(payload);
        if (!response.keyframes?.length || !response.generation_job_id) {
          throw new Error('Character generation returned incomplete keyframes');
        }
        setGenerationProgress(100);
        setLastGenerationPrompt(prompt);
        setGeneratedImages(response.images);
        setGeneratedKeyframes(response.keyframes);
        setGenerationJobId(response.generation_job_id);
        setSelectedImageIndex(0);
        setStep('grid-preview');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Character generation failed';
      setGenerationError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const resetImageInputState = () => {
    setUploadedFile(null);
    setUploadedFilePreview('');
    setGuidancePrompt('');
    setGenerationError('');
  };

  const handleRegenerateSelectedKeyframe = async () => {
    const selectedKeyframe = generatedKeyframes[selectedImageIndex];
    if (!selectedKeyframe || !generationJobId || !projectId) {
      setGenerationError('Select a generated character view before regenerating it.');
      return;
    }

    setGenerationError('');
    setIsRegeneratingKeyframe(true);
    try {
      const replacement = await regenerateCharacterKeyframe(
        generationJobId,
        selectedKeyframe.view,
        projectId,
        repairGuidance.trim()
      );
      setGeneratedKeyframes((keyframes) => keyframes.map((keyframe) => (
        keyframe.view === replacement.view ? replacement : keyframe
      )));
      setGeneratedImages((images) => images.map((image, index) => (
        index === selectedImageIndex ? replacement.image_url : image
      )));
      setRepairGuidance('');
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Character keyframe regeneration failed');
    } finally {
      setIsRegeneratingKeyframe(false);
    }
  };

  const handleSaveCharacter = async () => {
    if (!projectId || !generationJobId || !generatedKeyframes.length) {
      setSaveError('Generate a complete character keyframe set before saving.');
      return;
    }
    if (!charData.name.trim()) {
      setSaveError('Character name is required.');
      return;
    }

    const selectedKeyframe = generatedKeyframes[selectedImageIndex];
    if (!selectedKeyframe) {
      setSaveError('Select a character keyframe to use as the primary image.');
      return;
    }

    setSaveError('');
    setIsSavingCharacter(true);
    try {
      await finalizeCharacter({
        project_id: projectId,
        generation_job_id: generationJobId,
        name: charData.name.trim(),
        role: charData.role.trim() || undefined,
        description: charData.description.trim() || undefined,
        primary_view: selectedKeyframe.view,
      });
      setStep('grid-preview');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Character save failed');
    } finally {
      setIsSavingCharacter(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Generation Progress Overlay
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
            <div className="flex items-center justify-center mb-6">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-zinc-700" />
                <div 
                  className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 border-r-indigo-500 animate-spin"
                  style={{ animation: 'spin 2s linear infinite' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-bold text-indigo-400">{generationProgress}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm font-semibold mb-2">
                  <span className="text-zinc-300 flex items-center gap-2">
                    <RefreshCw size={14} className="animate-spin text-indigo-400" />
                    Generating Character...
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
              </div>

              <div className="text-center">
                <p className="text-xs text-zinc-500">
                  {generationProgress < 30
                    ? 'Processing your prompt...'
                    : generationProgress < 60
                    ? 'Initializing model...'
                    : generationProgress < 90
                    ? 'Generating image...'
                    : 'Finalizing results...'}
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Shared Model Selector Section
  const renderModelSelector = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
        <span>Model Selection</span>
        <ChevronDown size={14} className="text-zinc-600" />
      </div>
      <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-linear-to-r from-purple-900/40 via-indigo-900/30 to-zinc-900 p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-linear-to-br flex items-center justify-center',
              selectedModel.thumbnail
            )}
          >
            <ImageIcon size={20} className="text-white/50" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-white truncate">{selectedModel.name}</p>
              <span
                className={cn(
                  'text-[8px] font-bold px-1.5 py-0.5 flex items-center justify-center rounded-sm uppercase tracking-wider',
                  selectedModel.provider === 'wavespeed'
                    ? 'bg-cyan-900/50 text-cyan-400'
                    : 'bg-purple-900/50 text-purple-400'
                )}
              >
                {selectedModel.provider}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500">{selectedModel.creator}</p>
          </div>
        </div>
        <button
          onClick={() => setModelSelectorOpen(true)}
          className="shrink-0 flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
        >
          Switch
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );

  // Model Selection Modal
  const renderModelSelectorModal = () => (
    <AnimatePresence>
      {modelSelectorOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setModelSelectorOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ y: 20, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 20, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl h-[80vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 shrink-0">
              <div className="flex items-center gap-2">
                <ImageIcon size={18} className="text-zinc-400" />
                <span className="text-sm font-bold text-white">Select Model</span>
              </div>
              <button
                title="Close"
                aria-label="Close"
                onClick={() => setModelSelectorOpen(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xl"
              >
                <X size={18} />
              </button>
            </div>

            {/* Models Grid */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {characterModels.filter((model) => model.modes.includes(step === 'image-input' ? 'upload' : 'text')).map((model) => (
                  <motion.div
                    key={model.id}
                    whileHover={{ y: -4 }}
                    onClick={() => {
                      setSelectedModel(model);
                      setModelSelectorOpen(false);
                    }}
                    className={cn(
                      'group cursor-pointer rounded-xl border bg-zinc-900 overflow-hidden transition-all hover:border-zinc-700',
                      selectedModel.id === model.id
                        ? 'border-blue-500 ring-2 ring-blue-500/30'
                        : 'border-zinc-800'
                    )}
                  >
                    <div
                      className={cn(
                        'aspect-4/3 bg-linear-to-br flex items-center justify-center relative',
                        model.thumbnail
                      )}
                    >
                      <ImageIcon size={32} className="text-white/20" />
                      <div className="absolute top-2 left-2 flex gap-1">
                        {model.tags.map((tag) => (
                          <span
                            key={tag}
                            className="bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 space-y-1">
                      <h3 className="text-sm font-bold text-white truncate">{model.name}</h3>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-xs text-zinc-500 truncate">{model.creator}</p>
                        <span
                          className={cn(
                            'text-[9px] font-bold px-1.5 py-0.5 flex items-center justify-center rounded-sm uppercase tracking-wider shrink-0',
                            model.provider === 'wavespeed'
                              ? 'bg-cyan-900/50 text-cyan-400'
                              : 'bg-purple-900/50 text-purple-400'
                          )}
                        >
                          {model.provider}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 1: The Initial Branching Workflow
  const renderModeSelect = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto mt-6"
    >
      <div className="text-center mb-16">
        <div className="uppercase tracking-widest text-indigo-400 text-xs font-semibold mb-3">
          Creation
        </div>
        <h1 className="text-4xl md:text-5xl font-display font-medium mb-4">Welcome to Character Area</h1>
        <p className="text-zinc-400 text-lg">Choose a method and create your character now.</p>
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
          <p className="text-zinc-500 mt-2 text-center">
            Start from scratch using a detailed text prompt outlining the traits.
          </p>
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
          <h3 className="text-2xl font-display font-medium text-zinc-100">Upload reference images</h3>
          <p className="text-zinc-500 mt-2 text-center">
            Base your creation on existing sketches or images for better accuracy.
          </p>
          <div className="mt-8 flex items-center gap-2 text-purple-400 font-medium bg-purple-500/10 px-6 py-2 rounded-full">
            Create <ArrowRight className="w-4 h-4 ml-1" />
          </div>
        </button>
      </div>
    </motion.div>
  );

  // 2A: Text Input Form
  const renderTextInput = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-2xl mx-auto mt-6"
    >
      <button
        onClick={() => setStep('mode-select')}
        title="Back to mode selection"
        aria-label="Back to mode selection"
        className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 hover:border-zinc-700 transition-colors mb-8"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <h2 className="text-3xl font-display font-medium mb-8">Describe your character</h2>

      <div className="space-y-8 bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl">
        <div>
          <div className="flex items-center justify-between gap-3 mb-3 ml-1">
            <label className="text-sm font-medium text-zinc-300">Prompt Area</label>
            <button
              type="button"
              title="Fill with character description example"
              aria-label="Fill with character description example"
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
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 min-h-40 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 focus:outline-none transition-all resize-none text-zinc-200"
            placeholder="Enter detailed character description..."
          />
        </div>

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

        {renderModelSelector()}

        {generationError && (
          <div className="text-xs text-red-400 font-semibold bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3">
            {generationError}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
        >
          {isGenerating ? (
            <span className="animate-pulse">Generating character variations...</span>
          ) : (
            <>
              <Wand2 className="w-5 h-5" /> Create Character
            </>
          )}
        </button>
      </div>
    </motion.div>
  );

  // 2B: Image Input Form
  const renderImageInput = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-2xl mx-auto mt-6"
    >
      <button
        onClick={() => {
          resetImageInputState();
          setStep('mode-select');
        }}
        title="Back to mode selection"
        aria-label="Back to mode selection"
        className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 hover:border-zinc-700 transition-colors mb-8"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <h2 className="text-3xl font-display font-medium mb-8">Upload Reference Images</h2>

      <div className="space-y-8 bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl">
        {/* Hidden File Input (follows editor component pattern) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Upload reference image"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setUploadedFile(file);
              setUploadedFilePreview(URL.createObjectURL(file));
              setGenerationError('');
            }
          }}
        />

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-3 ml-1">Reference Image</label>
          <button
            onClick={triggerFileInput}
            disabled={isGenerating}
            className="w-full border-2 border-dashed border-zinc-700 bg-zinc-950/50 hover:bg-zinc-900 hover:border-zinc-500 rounded-2xl p-4 flex flex-col items-center justify-center text-zinc-500 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
          >
            {uploadedFilePreview ? (
              <div className="w-full h-72 relative rounded-lg overflow-hidden border border-zinc-700 flex items-center justify-center bg-black/50">
                {/* Using img for local file preview (URL.createObjectURL) - optimization not needed */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={uploadedFilePreview} 
                  alt="Uploaded preview" 
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <>
                <UploadCloud className="w-10 h-10 mb-4" />
                <p>Click to browse or drag and drop an image</p>
              </>
            )}
          </button>
        </div>

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

        {renderModelSelector()}

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-3 ml-1">
            Guidance Prompt (Optional)
          </label>
          <textarea
            value={guidancePrompt}
            onChange={(e) => setGuidancePrompt(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 min-h-24 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 focus:outline-none transition-all resize-none text-zinc-200 placeholder-zinc-600"
            placeholder="Describe clothing, lighting, expression, style, or details to preserve across all six views."
          />
        </div>

        {generationError && (
          <div className="text-xs text-red-400 font-semibold bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3">
            {generationError}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={isGenerating || !uploadedFile || !projectId}
          className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
        >
          {isGenerating ? (
            <span className="animate-pulse">Analyzing and generating...</span>
          ) : uploadedFile && projectId ? (
            <>
              <ImageIcon className="w-5 h-5" /> Generate Character Views
            </>
          ) : (
            <>
              <ImageIcon className="w-5 h-5" /> Select Project and Image
            </>
          )}
        </button>
      </div>
    </motion.div>
  );

  // 3: Grid Preview
  const renderGridPreview = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-5xl mx-auto mt-6"
    >
      <button
        onClick={() => setStep('mode-select')}
        title="Back to start"
        aria-label="Back to start"
        className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 hover:border-zinc-700 transition-colors mb-6"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-8 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-display font-medium text-zinc-100 flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-indigo-400" />
            Image Variations
          </h3>
          <div className="text-sm font-medium px-3 py-1 rounded-full bg-zinc-800/50 border border-zinc-700/50 text-zinc-400">
            {generatedImages.length} results
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          {/* Left: Image Grid */}
          <div className="flex-1 overflow-y-auto max-h-125 pr-2 scrollbar-hover-only">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 shrink-0">
              {(generatedKeyframes.length ? generatedKeyframes : generatedImages.map((image_url) => ({
                image_url,
                view: undefined,
              }))).map((frame, i) => (
                <button
                  key={frame.image_url}
                  onClick={() => setSelectedImageIndex(i)}
                  className={`aspect-4/5 relative rounded-xl overflow-hidden border-2 text-left transition-all bg-zinc-900 ${
                    selectedImageIndex === i
                      ? 'border-indigo-500 scale-100 shadow-[0_0_20px_rgba(99,102,241,0.25)]'
                      : 'border-transparent hover:border-zinc-700 scale-[0.98]'
                  }`}
                >
                  <Image
                    src={frame.image_url}
                    alt={frame.view ? characterViewLabels[frame.view] : `Variant ${i + 1}`}
                    fill
                    sizes="(max-width: 768px) 33vw, 200px"
                    className="object-cover"
                    referrerPolicy="no-referrer"
                  />
                  {frame.view && (
                    <span className="absolute inset-x-0 bottom-0 bg-black/75 px-3 py-2 text-xs font-semibold text-white">
                      {characterViewLabels[frame.view]}
                    </span>
                  )}
                  {/* Active indicator badge */}
                  {selectedImageIndex === i && (
                    <div className="absolute top-2 right-2 bg-indigo-500 rounded-full p-1.5 shadow-lg">
                      <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Prompt Form & Next */}
          <div className="w-full lg:w-80 flex flex-col justify-between">
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-widest font-semibold block mb-3">
                Prompt Used
              </label>
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 text-sm text-zinc-300 leading-relaxed min-h-32 flex items-start">
                {generatedKeyframes[selectedImageIndex]?.prompt || lastGenerationPrompt}
              </div>
            </div>

            <div className="mt-5">
              <label className="text-xs text-zinc-500 uppercase tracking-widest font-semibold block mb-3">
                Repair Guidance
              </label>
              <textarea
                value={repairGuidance}
                onChange={(event) => setRepairGuidance(event.target.value)}
                placeholder="e.g. Face right, camera on the character's left side."
                className="w-full min-h-24 resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-relaxed text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleRegenerateSelectedKeyframe}
                disabled={isRegeneratingKeyframe || !generatedKeyframes[selectedImageIndex]}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/50 bg-indigo-500/10 py-3 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
              >
                <RefreshCw className={`h-4 w-4 ${isRegeneratingKeyframe ? 'animate-spin' : ''}`} />
                {isRegeneratingKeyframe ? 'Regenerating View...' : 'Regenerate View'}
              </button>
            </div>

            <div className="mt-5">
              <button
                onClick={() => setStep('save-character')}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-medium shadow-lg shadow-indigo-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                Next Step <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // 4: Save Character Panel
  const renderSaveCharacter = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-5xl mx-auto mt-6"
    >
      <button
        onClick={() => setStep('grid-preview')}
        title="Back to variations"
        aria-label="Back to variations"
        className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 hover:border-zinc-700 transition-colors mb-6"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row">
        {/* Left: Image Side (Carousel) */}
        <div
          className="relative w-full md:w-1/2 bg-zinc-900 shrink-0 group"
          onMouseEnter={() => setIsHoveringCarousel(true)}
          onMouseLeave={() => setIsHoveringCarousel(false)}
        >
          <div className="aspect-4/5 md:aspect-auto relative w-full h-full min-h-100 overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={selectedImageIndex}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0"
              >
                <Image
                  src={generatedImages[selectedImageIndex]}
                  alt={`Selected Character Variant ${selectedImageIndex + 1}`}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                  unoptimized={false}
                  referrerPolicy="no-referrer"
                />
              </motion.div>
            </AnimatePresence>
            <div className="absolute top-6 left-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider border border-white/10 z-10 text-white shadow-xl transition-all">
              Final Selection ({selectedImageIndex + 1}/{generatedImages.length})
            </div>

            {/* Carousel Controls */}
            <button
              title="Previous image"
              aria-label="Previous image"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImageIndex((prev) => (prev > 0 ? prev - 1 : generatedImages.length - 1));
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all hover:bg-black/70 hover:scale-110 z-10"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              title="Next image"
              aria-label="Next image"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImageIndex((prev) => (prev < generatedImages.length - 1 ? prev + 1 : 0));
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all hover:bg-black/70 hover:scale-110 z-10"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Right: Form Side */}
        <div className="w-full md:w-1/2 p-8 lg:p-12 flex flex-col">
          <div className="mb-8">
            <div className="uppercase tracking-widest text-indigo-400 text-xs font-semibold mb-2">
              Last Step
            </div>
            <h2 className="text-3xl font-display font-medium text-zinc-100">Save your character</h2>
          </div>

          <div className="space-y-6 flex-1 flex flex-col">
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-widest font-semibold ml-1 mb-2 block">
                Character Name
              </label>
              <input
                type="text"
                placeholder="e.g. Sir Alarick"
                value={charData.name}
                onChange={(e) => setCharData({ ...charData, name: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-widest font-semibold ml-1 mb-2 block">
                Short Description
              </label>
              <textarea
                placeholder="A fierce warrior with a hidden past..."
                value={charData.description}
                onChange={(e) => setCharData({ ...charData, description: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none min-h-35"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-widest font-semibold ml-1 mb-2 block">
                Role
              </label>
              <input
                type="text"
                placeholder="e.g. Protagonist / NPC"
                value={charData.role}
                onChange={(e) => setCharData({ ...charData, role: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <div className="mt-auto pt-6">
              {saveError && <p className="mb-3 text-sm text-red-400">{saveError}</p>}
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

  return (
    <div className="min-h-screen bg-black text-zinc-50 font-sans selection:bg-purple-500/30">
      <AnimatePresence mode="wait">
        {step === 'mode-select' && <div key="mode">{renderModeSelect()}</div>}
        {step === 'text-input' && <div key="text">{renderTextInput()}</div>}
        {step === 'image-input' && <div key="image">{renderImageInput()}</div>}
        {step === 'grid-preview' && (
          <div key="grid-preview" className="h-full">
            {renderGridPreview()}
          </div>
        )}
        {step === 'save-character' && (
          <div key="save-character" className="h-full">
            {renderSaveCharacter()}
          </div>
        )}
      </AnimatePresence>

      {renderGenerationProgress()}
      {renderModelSelectorModal()}
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