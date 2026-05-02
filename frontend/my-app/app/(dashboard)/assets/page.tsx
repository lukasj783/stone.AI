"use client";
import React, { useState, useEffect } from 'react';
import StorageBanner from '@/components/assets/StorageBanner';
import AssetToolbar from '@/components/assets/AssetToolbar';
import AssetCard from '@/components/assets/AssetCard';
import DeleteConfirmationModal from '@/components/ui/DeleteConfirmationModal';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { batchDeleteImages } from '@/lib/api/image-generation';
import { batchDeleteVideos } from '@/lib/api/video-generation';
import { supabase } from '@/lib/supabaseClient';

interface Asset {
  id: number;
  generationId?: number;
  type: string;
  url: string;
}

interface PendingDeleteItem {
  id: number;
  url: string;
  assetId: number;
}

export default function AssetsPage() {
  const [activeTab, setActiveTab] = useState('Image');
  const [zoom, setZoom] = useState(6);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const toggleSelectionMode = () => {
    setIsSelectionMode(prev => {
      if (prev) {
        setSelectedIds(new Set()); // Clear on exit
      }
      return !prev;
    });
  };

  const [pendingDeleteItems, setPendingDeleteItems] = useState<PendingDeleteItem[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const tabs = ['Image', 'Video', 'Story', 'Audio', 'Albums'];
  
  useEffect(() => {
    setSelectedIds(new Set()); // Reset selection on tab change
    setIsSelectionMode(false); // Reset Selection mode on tab change
    async function fetchAssets() {
      if (activeTab !== 'Image' && activeTab !== 'Video') {
        setAssets([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        if (activeTab === 'Image') {
          const { data, error } = await supabase
            .from('image_generations')
            .select('*')
            .order('created_at', { ascending: false });

          if (error) {
            console.error("Error fetching image assets:", error);
            return;
          }

          if (data) {
            const loadedAssets: Asset[] = [];
            data.forEach((row: any) => {
              if (row.result_images && Array.isArray(row.result_images)) {
                row.result_images.forEach((imgUrl: string, idx: number) => {
                  loadedAssets.push({
                    id: row.id * 1000 + idx, // uniqueish id
                    generationId: row.id,
                    type: 'image',
                    url: imgUrl
                  });
                });
              }
            });
            setAssets(loadedAssets);
          }
        } 
        else if (activeTab === 'Video') {
          const { data, error } = await supabase
            .from('video_generations')
            .select('*')
            .order('created_at', { ascending: false });

          if (error) {
            console.error("Error fetching video assets:", error);
            return;
          }

          if (data) {
            const loadedAssets: Asset[] = [];
            data.forEach((row: any) => {
              if (row.result_video_url) {
                loadedAssets.push({
                  id: row.id,
                  generationId: row.id,
                  type: 'video',
                  url: row.result_video_url
                });
              }
            });
            setAssets(loadedAssets);
          }
        }
      } catch (err) {
        console.error("Error fetching assets:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchAssets();
  }, [activeTab]);

  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const closeDeleteModal = () => {
    if (isDeleting) {
      return;
    }

    setIsDeleteModalOpen(false);
    setPendingDeleteItems([]);
  };

  const handleBatchDelete = async (items: PendingDeleteItem[]) => {
    setIsDeleting(true);
    try {
      if (activeTab === 'Video') {
        await batchDeleteVideos(items.map(item => ({ id: item.id, url: item.url })));
      } else {
        await batchDeleteImages(items.map(item => ({ id: item.id, url: item.url })));
      }

      const deletedAssetIds = new Set(items.map(item => item.assetId));
      setAssets(prev => prev.filter(asset => !deletedAssetIds.has(asset.id)));
      
      setSelectedIds(prev => {
        const next = new Set(prev);
        deletedAssetIds.forEach(id => next.delete(id));
        return next;
      });

      setIsDeleteModalOpen(false);
      setPendingDeleteItems([]);
    } catch (err) {
      console.error("Error during batch delete", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSingle = (assetId: number, generationId: number, url: string) => {
    setPendingDeleteItems([{ id: generationId, url, assetId }]);
    setIsDeleteModalOpen(true);
  };

  const handleDeleteSelected = () => {
    const itemsToDelete = assets
      .filter(asset => selectedIds.has(asset.id) && asset.generationId && asset.url)
      .map(asset => ({ id: asset.generationId!, url: asset.url, assetId: asset.id }));
    
    if (itemsToDelete.length > 0) {
      setPendingDeleteItems(itemsToDelete);
      setIsDeleteModalOpen(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (pendingDeleteItems.length === 0) {
      return;
    }

    await handleBatchDelete(pendingDeleteItems);
  };

  const pendingDeleteCount = pendingDeleteItems.length;
  const assetTypeLabel = activeTab.toLowerCase();
  
  const deleteTitle = pendingDeleteCount > 1
    ? `Delete ${pendingDeleteCount} ${assetTypeLabel}s?`
    : `Delete this ${assetTypeLabel}?`;

  const deleteMessage = pendingDeleteCount > 1
    ? `Are you sure you want to delete these ${pendingDeleteCount} ${assetTypeLabel}s? They will be deleted permanently.`
    : `Are you sure you want to delete this ${assetTypeLabel}? It will be deleted permanently.`;

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="space-y-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-2 border-b border-zinc-900/50">
            <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Assets</h1>
            
            {/* Asset Tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-900/50 relative">
              {tabs.map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "relative px-7 py-3 rounded-lg text-sm font-bold tracking-tight transition-all duration-300 active:scale-95",
                      isActive ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {isActive && (
                      <motion.div 
                        layoutId="activeAssetTab"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full shadow-[0_0_12px_rgba(59,130,246,0.5)]"
                      />
                    )}
                    <span className="relative z-10">{tab}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Storage Banner */}
          <StorageBanner />
        </header>

        {/* Sticky Toolbar Area */}
        <AssetToolbar 
          zoom={zoom} 
          setZoom={setZoom} 
          view={view} 
          setView={setView} 
          isSelectionMode={isSelectionMode}
          toggleSelectionMode={toggleSelectionMode}
          selectedCount={selectedIds.size}
          handleDeleteSelected={handleDeleteSelected}
          activeTab={activeTab}
        />

        {/* Assets Grid */}
        <motion.section 
          layout
          className={cn(
            "grid gap-4 transition-all duration-500",
            `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-${zoom} xl:grid-cols-${zoom + 1}`
          )}
        >
          <AnimatePresence mode="popLayout">
            {assets.map((asset) => (
              <AssetCard 
                key={`${activeTab}-${asset.id}`} 
                {...asset} 
                isSelected={selectedIds.has(asset.id)}
                isSelectionMode={isSelectionMode}
                onToggleSelect={() => handleToggleSelect(asset.id)}
                onDelete={handleDeleteSingle}
              />
            ))}
          </AnimatePresence>
        </motion.section>

        {/* Empty State / Loading simulation */}
        {assets.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-32 space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800 text-zinc-600">
              ?
            </div>
            <div className="space-y-1">
              <div className="text-zinc-200 font-bold tracking-tight">No {activeTab}s yet</div>
              <div className="text-sm text-zinc-500">Generate something to see it appear here.</div>
            </div>
          </div>
        )}
        
        {loading && (
          <div className="flex flex-col items-center justify-center py-32 space-y-4 text-center">
             <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
             <div className="text-sm text-zinc-500">Loading {activeTab.toLowerCase()}s...</div>
          </div>
        )}

        <DeleteConfirmationModal
          isOpen={isDeleteModalOpen}
          title={deleteTitle}
          message={deleteMessage}
          confirmLabel="Yes"
          cancelLabel="No"
          isPending={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={closeDeleteModal}
        />
      </div>
  );
}
