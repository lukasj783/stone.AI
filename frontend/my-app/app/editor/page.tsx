"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useProject } from '@/lib/useProject';
import { AssetTab, UploadedAsset } from '@/components/editor/types';
import { AssetLibrary } from '@/components/editor/AssetLibrary';
import { TimelineFooter } from '@/components/editor/TimelineFooter';
import { DynamicVideoPlayer } from '@/components/editor/DynamicVideoPlayer';
import { DynamicAudioPlayer } from '@/components/editor/DynamicAudioPlayer';
import { TimelineTopNav } from '@/components/editor/TimelineTopNav';
import { isTimelineElementActive, readLocalMediaDuration, MAX_FILE_SIZE, MAX_FILE_SIZE_MB, STORAGE_BUCKET } from '@/components/editor/mediaUtils';
import { useTimeline } from '@/components/editor/useTimeline';
import { INITIAL_TIMELINE_STATE } from '@/lib/types/layers.types';
import { supabase } from '@/lib/supabaseClient';
import { formatTime } from '@/components/editor/utils';

export default function TimelineEditorPage() {
  const [activeTab, setActiveTab] = useState<AssetTab>('music');
  const [assets, setAssets] = useState<Record<AssetTab, UploadedAsset[]>>({
    video: [], image: [], music: [], voice: [], text: [],
  });
  const [uploadStatus, setUploadStatus] = useState<Record<AssetTab, 'idle' | 'uploading' | 'success' | 'error'>>({
    video: 'idle', image: 'idle', music: 'idle', voice: 'idle', text: 'idle',
  });
  const [uploadError, setUploadError] = useState<Record<AssetTab, string | null>>({
    video: null, image: null, music: null, voice: null, text: null,
  });

  const { 
    projectId, projectName, isSaving, isDirty, setIsDirty, 
    loadLastProject, saveProject, newProject, setProjectName,
    projects, loadProject, deleteProject, listProjects 
  } = useProject();
  const { tl, setTl, historyIndex, undo, redo, addElementToTrack, removeElement, splitElement, updateElement } = useTimeline();
  
  const lastSavedTlRef = useRef<string>("initial_loading");

  useEffect(() => {
    (async () => {
      const lastProject = await loadLastProject();
      if (lastProject?.timelineState) {
        setTl(lastProject.timelineState);
        lastSavedTlRef.current = JSON.stringify(lastProject.timelineState.tracks);
    } else {
        lastSavedTlRef.current = JSON.stringify(tl.tracks);
      }
    })();
  }, [loadLastProject, setTl, tl.tracks]);

  useEffect(() => {
    if (lastSavedTlRef.current === "initial_loading") return;
    const currentTracks = JSON.stringify(tl.tracks);
    if (currentTracks !== lastSavedTlRef.current) {
        setIsDirty(true);
    }
  }, [tl.tracks, tl.totalDuration, setIsDirty]);

  const handleSave = useCallback(async () => {
    const success = await saveProject(projectId, projectName, tl);
    if (success) {
      lastSavedTlRef.current = JSON.stringify(tl.tracks);
      setIsDirty(false);
    }
  }, [saveProject, projectId, projectName, tl, setIsDirty]);

  const handleNewProject = useCallback(() => {
    newProject();
    setTl(INITIAL_TIMELINE_STATE);
    lastSavedTlRef.current = JSON.stringify(INITIAL_TIMELINE_STATE.tracks);
    setIsDirty(false);
  }, [newProject, setTl, setIsDirty]);

  const handleProjectNameChange = useCallback((name: string) => {
    setProjectName(name);
  }, [setProjectName]);

  const togglePlay = useCallback(() => {
    setTl((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
  }, [setTl]);

  const seek = useCallback((time: number) => {
    setTl((prev) => ({ ...prev, currentTime: Math.max(0, Math.min(time, prev.totalDuration)) }));
  }, [setTl]);

  const seekToStart = useCallback(() => seek(0), [seek]);
  const zoomIn = useCallback(() => setTl((prev) => ({ ...prev, zoomLevel: Math.min(1000, prev.zoomLevel + 20) })), [setTl]);
  const zoomOut = useCallback(() => setTl((prev) => ({ ...prev, zoomLevel: Math.max(0.1, prev.zoomLevel - 20) })), [setTl]);

  const handleUpload = async (tab: AssetTab, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const validFiles = Array.from(files).filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        setUploadError((prev) => ({ ...prev, [tab]: `File "${f.name}" exceeds ${MAX_FILE_SIZE_MB}MB limit` }));
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setUploadStatus((prev) => ({ ...prev, [tab]: 'uploading' }));
    setUploadError((prev) => ({ ...prev, [tab]: null }));

    const newAssets: UploadedAsset[] = [];
    for (const file of validFiles) {
      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, file);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
        let assetType: 'video' | 'image' | 'audio' | 'text' = 'image';
        if (file.type.startsWith('video/')) assetType = 'video';
        else if (file.type.startsWith('audio/')) assetType = 'audio';
        else if (file.type.startsWith('text/') || file.name.endsWith('.txt') || tab === 'text') assetType = 'text';

        const duration = (assetType === 'video' || assetType === 'audio') ? await readLocalMediaDuration(file, assetType) : undefined;
        let textContent: string | undefined = undefined;
        if (assetType === 'text') { try { textContent = await file.text(); } catch (e) { console.error(e); } }

        newAssets.push({
          id: `${Date.now()}-${Math.random().toString(36).substring(2)}`,
          name: file.name,
          url: publicUrlData.publicUrl,
          type: assetType,
          size: file.size,
          duration,
          uploadedAt: Date.now(),
          textContent,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setUploadError((prev) => ({ ...prev, [tab]: message }));
        setUploadStatus((prev) => ({ ...prev, [tab]: 'error' }));
        return;
      }
    }
    setAssets((prev) => ({ ...prev, [tab]: [...prev[tab], ...newAssets] }));
    setUploadStatus((prev) => ({ ...prev, [tab]: 'success' }));
    setTimeout(() => setUploadStatus((prev) => ({ ...prev, [tab]: 'idle' })), 3000);
  };

  const handleRemoveAsset = (tab: AssetTab, assetId: string) => {
    setAssets((prev) => ({ ...prev, [tab]: prev[tab].filter((a) => a.id !== assetId) }));
  };

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-300 font-sans selection:bg-blue-500/30 overflow-hidden">
      <TimelineTopNav
        isPlaying={tl.isPlaying}
        onTogglePlay={togglePlay}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyIndex >= 0}
        canRedo={historyIndex + 1 < historyIndex + 10}
        projectName={projectName}
        onProjectNameChange={handleProjectNameChange}
        onSave={handleSave}
        isSaving={isSaving}
        isDirty={isDirty}
        onNewProject={handleNewProject}
        projects={projects}
        onLoadProject={loadProject}
        onDeleteProject={deleteProject}
        onListProjects={listProjects}
      />
      
      <main className="flex-1 flex gap-4 p-4 min-h-0 bg-[#09090b]">
        <AssetLibrary
          activeTab={activeTab}
          assets={assets}
          uploadStatus={uploadStatus}
          uploadError={uploadError}
          setActiveTab={setActiveTab}
          handleUpload={handleUpload}
          handleRemoveAsset={handleRemoveAsset}
          handleDragStart={(e, asset) => e.dataTransfer.setData('application/json', JSON.stringify(asset))}
          handleAddToTimeline={(asset) => addElementToTrack(tl.tracks[0].id, asset)}
        />

        <section className="flex-1 bg-[#18181b] rounded-xl border border-zinc-800 flex flex-col items-center justify-center relative overflow-hidden min-w-0">
          <div className="w-[320px] h-137.5 bg-black shadow-2xl relative overflow-hidden border border-zinc-900 flex flex-col justify-between">
            <div className="absolute inset-0 z-0">
              {tl.tracks.map(track => track.elements.filter((el) => isTimelineElementActive(el, tl.currentTime)).map(el => {
                if (track.type === 'video' || el.assetType === 'video') return <DynamicVideoPlayer key={el.id} element={el} isPlaying={tl.isPlaying} currentTime={tl.currentTime} />;
                if (track.type === 'image' || el.assetType === 'image') return <div key={el.id} className="absolute inset-0 z-10 pointer-events-none" style={{ opacity: el.opacity / 100 }}><Image src={el.assetUrl} alt={el.assetName} fill className="object-cover" unoptimized /></div>;
                if (track.type === 'audio' || el.assetType === 'audio') return <DynamicAudioPlayer key={el.id} element={el} isPlaying={tl.isPlaying} currentTime={tl.currentTime} />;
                if (track.type === 'text' || track.type === 'caption' || el.assetType === 'text') return <div key={el.id} className="absolute inset-x-4 bottom-16 z-50 pointer-events-none flex flex-col items-center justify-end h-full"><div className="bg-black/80 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/20 shadow-2xl mb-12"><p className="text-white font-black text-center text-lg">{el.textContent || el.assetName}</p></div></div>;
                return null;
              }))}
            </div>
            <div className="absolute bottom-4 left-4 bg-black/70 px-3 py-1.5 rounded text-xs font-mono text-zinc-300 border border-zinc-700 z-50 shadow-md">
              {formatTime(tl.currentTime)} / {formatTime(tl.totalDuration)}
            </div>
          </div>
        </section>
      </main>

      <TimelineFooter
        tl={tl}
        setTl={setTl}
        seekToStart={seekToStart}
        togglePlay={togglePlay}
        seek={seek}
        splitElement={splitElement}
        zoomOut={zoomOut}
        zoomIn={zoomIn}
        toggleTrackMute={() => {}}
        toggleTrackLock={() => {}}
        handleTimelineDrop={(e, trackId) => {
          const assetData = e.dataTransfer.getData('application/json');
          if (assetData) {
            addElementToTrack(trackId, JSON.parse(assetData));
          }
        }}
        updateElement={updateElement}
        removeElement={removeElement}
        moveElementToTrack={() => {}}
        duplicateElement={() => {}}
      />
    </div>
  );
}
