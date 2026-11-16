"use client";

import React, { useEffect, useState, useRef } from 'react';
import { Bot, Play, RefreshCw, Trash2, Edit2, Check, X, Eye, BookOpen } from 'lucide-react';
import { supabase } from "@/lib/supabaseClient";
import { characterMatchesLabel, characterTags, characterTheme } from '@/lib/characterTheme';
import AlertModal from '@/components/ui/AlertModal';

interface ScriptProps {
  projectId: string | null;
}

interface ScriptScene {
  id: string;
  slugline_raw: string;
  location_type?: string;
  location?: string;
  time_of_day?: string;
  summary?: string;
  status: string;
  scene_order: number;
}

interface ScriptBlock {
  id: string;
  scene_id: string;
  block_type: "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition";
  content: string;
  character_name?: string;
  parenthetical?: string;
  block_order: number;
}

interface ScriptCharacter {
  id: string;
  name: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
}

export function ScriptEditor({ projectId }: ScriptProps) {
  const [scenes, setScenes] = useState<ScriptScene[]>([]);
  const [blocks, setBlocks] = useState<ScriptBlock[]>([]);
  const [characters, setCharacters] = useState<ScriptCharacter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'full'>('single');
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  
  // Track activeSceneId inside a ref to bypass useEffect dependency and prevent HMR discrepancies or waste
  const activeSceneIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSceneIdRef.current = activeSceneId;
  }, [activeSceneId]);

  // Scroll to active scene in full script view mode
  useEffect(() => {
    if (activeSceneId && viewMode === 'full' && canvasContainerRef.current) {
      const element = canvasContainerRef.current.querySelector(`#scene-${activeSceneId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [activeSceneId, viewMode]);

  // Editing and Deletion states
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editedBlockContent, setEditingBlockContent] = useState<string>("");
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [isDeletingScript, setIsDeletingScript] = useState(false);
  const [isRewritingIncomplete, setIsRewritingIncomplete] = useState(false);

  // Format Check states
  interface FormatIssue {
    blockId: string;
    type: 'error' | 'warning';
    message: string;
    rule: string;
    isSceneId?: boolean; // Indicator if the blockId is actually a scene.id rather than script_block.id
  }
  const [formatIssues, setFormatIssues] = useState<FormatIssue[]>([]);
  const [hasCheckedFormat, setHasCheckedFormat] = useState(false);
  const [isFixingIssueId, setIsFixingIssueId] = useState<string | null>(null);
  const [isFixingAll, setIsFixingAll] = useState(false);

  // Custom Alert / Confirmation state
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    type?: 'info' | 'warning' | 'error' | 'success' | 'confirm';
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info') => {
    setAlertState({
      isOpen: true,
      type,
      title,
      message,
    });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmLabel = 'Confirm') => {
    setAlertState({
      isOpen: true,
      type: 'confirm',
      title,
      message,
      confirmLabel,
      onConfirm,
    });
  };

  // Quick drafting states & handlers
  const [draftContent, setDraftContent] = useState("");
  const [draftType, setDraftType] = useState<"action" | "dialogue" | "character" | "parenthetical">("action");
  const [isAppendingDraft, setIsAppendingDraft] = useState(false);

  const handleAppendDraft = async (overrideType?: "action" | "dialogue" | "character" | "parenthetical") => {
    if (!projectId || !activeSceneId) {
      showAlert("Scene Required", "Please select an active scene from the sidebar first.", "warning");
      return;
    }

    const trimmed = draftContent.trim();
    if (!trimmed) return;

    setIsAppendingDraft(true);
    try {
      const activeSceneBlocks = blocksByScene[activeSceneId] || [];
      const nextSortOrder = activeSceneBlocks.length;
      const typeToUse = overrideType || draftType;

      let content = trimmed;
      let characterName: string | null = null;
      const parentheticalValue: string | null = null;

      if (typeToUse === 'character') {
        content = "";
        characterName = trimmed.toUpperCase();
      } else if (typeToUse === 'dialogue') {
        const lastBlock = activeSceneBlocks[activeSceneBlocks.length - 1];
        const inheritedName = lastBlock?.character_name || (lastBlock?.block_type === 'character' ? lastBlock?.content : undefined) || "SPEAKER";
        characterName = inheritedName.toUpperCase();
      } else if (typeToUse === 'parenthetical') {
        content = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed : `(${trimmed})`;
      }

      const { data, error: insertError } = await supabase
        .from("script_blocks")
        .insert({
          project_id: projectId,
          scene_id: activeSceneId,
          block_type: typeToUse === 'character' ? 'dialogue' : typeToUse,
          content: content,
          character_name: characterName,
          parenthetical: parentheticalValue,
          sort_order: nextSortOrder
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (data) {
        const newBlock: ScriptBlock = {
          id: data.id as string,
          scene_id: data.scene_id as string,
          block_type: data.block_type as "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition",
          content: data.content as string,
          character_name: data.character_name as string | undefined,
          parenthetical: data.parenthetical as string | undefined,
          block_order: (data.sort_order ?? 0) as number
        };

        setBlocks((prev) => [...prev, newBlock]);
        setDraftContent("");
      }
    } catch (e) {
      showAlert("Draft Append Failed", e instanceof Error ? e.message : "Failed to add draft line.", "error");
    } finally {
      setIsAppendingDraft(false);
    }
  };

  const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAppendDraft();
    }
  };

  const handleAddBlock = async (type: "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition") => {
    if (!projectId || !activeSceneId) {
      showAlert("Scene Required", "Please select an active scene from the left panel first.", "warning");
      return;
    }

    try {
      const activeSceneBlocks = blocksByScene[activeSceneId] || [];
      const nextSortOrder = activeSceneBlocks.length;

      let defaultContent = "";
      let defaultCharName = "";
      const defaultParenthetical = "";

      switch(type) {
        case "scene_heading":
          defaultContent = "INT. NEW LOCATION - DAY";
          break;
        case "action":
          defaultContent = "Insert action description here describing what is happening...";
          break;
        case "character":
          defaultContent = "CHARACTER NAME";
          break;
        case "parenthetical":
          defaultContent = "(whispering)";
          break;
        case "dialogue":
          const lastBlock = activeSceneBlocks[activeSceneBlocks.length - 1];
          const inheritedName = lastBlock?.character_name || (lastBlock?.block_type === 'character' ? lastBlock?.content : undefined) || "SPEAKER";
          defaultContent = "Insert dialogue text...";
          defaultCharName = inheritedName.toUpperCase();
          break;
        case "transition":
          defaultContent = "FADE OUT.";
          break;
      }

      const { data, error: insertError } = await supabase
        .from("script_blocks")
        .insert({
          project_id: projectId,
          scene_id: activeSceneId,
          block_type: type === "character" ? "dialogue" : type,
          content: type === "character" ? "" : defaultContent,
          character_name: type === "character" ? defaultContent : (defaultCharName || null),
          parenthetical: defaultParenthetical || null,
          sort_order: nextSortOrder
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (data) {
        const newBlock: ScriptBlock = {
          id: data.id as string,
          scene_id: data.scene_id as string,
          block_type: data.block_type as "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition",
          content: data.content as string,
          character_name: data.character_name as string | undefined,
          parenthetical: data.parenthetical as string | undefined,
          block_order: (data.sort_order ?? 0) as number
        };

        setBlocks((prev) => [...prev, newBlock]);
        
        // Focus the editor immediately
        setEditingBlockId(newBlock.id);
        setEditingBlockContent(newBlock.content || newBlock.character_name || "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add script element.");
    }
  };

  // Apply fixes to blocks locally and update database in bulk or iteratively
  const applyFixToBlock = async (issue: FormatIssue, currentBlocks: ScriptBlock[]) => {
    if (issue.isSceneId) return null; // Cannot auto-fix unwritten scenes without generating them first

    const targetBlock = currentBlocks.find((b) => b.id === issue.blockId);
    if (!targetBlock) return null;

    let updatedFields: Partial<ScriptBlock> = {};

    if (issue.rule === 'No Empty Elements') {
      const { error: delError } = await supabase
        .from("script_blocks")
        .delete()
        .eq("id", issue.blockId);
      if (delError) throw delError;

      return { action: 'delete', blockId: issue.blockId };
    }

    if (issue.rule === 'Capitalization' && targetBlock.character_name) {
      const fixedName = targetBlock.character_name.toUpperCase();
      const { error: upError } = await supabase
        .from("script_blocks")
        .update({ character_name: fixedName })
        .eq("id", issue.blockId);
      if (upError) throw upError;

      updatedFields = { character_name: fixedName };
    }

    if (issue.rule === 'Parenthetical Brackets') {
      let fixedContent = targetBlock.content.trim();
      if (!fixedContent.startsWith('(')) fixedContent = '(' + fixedContent;
      if (!fixedContent.endsWith(')')) fixedContent = fixedContent + ')';

      const { error: upError } = await supabase
        .from("script_blocks")
        .update({ content: fixedContent })
        .eq("id", issue.blockId);
      if (upError) throw upError;

      updatedFields = { content: fixedContent };
    }

    if (issue.rule === 'Slugline Standard') {
      const fixedContent = 'INT. ' + targetBlock.content.trim();
      const { error: upError } = await supabase
        .from("script_blocks")
        .update({ content: fixedContent })
        .eq("id", issue.blockId);
      if (upError) throw upError;

      updatedFields = { content: fixedContent };
    }

    if (issue.rule === 'Orphaned Dialogue') {
      const defaultSpeaker = "CHARACTER";
      const { error: upError } = await supabase
        .from("script_blocks")
        .update({ character_name: defaultSpeaker })
        .eq("id", issue.blockId);
      if (upError) throw upError;

      updatedFields = { character_name: defaultSpeaker };
    }

    return { action: 'update', blockId: issue.blockId, fields: updatedFields };
  };

  const handleFixAllIssues = async () => {
    if (!projectId || formatIssues.length === 0) return;
    
    showConfirm(
      "Auto-Fix All Issues",
      `Are you sure you want to automatically fix all ${formatIssues.length} formatting issues found across the script?`,
      async () => {
        setIsFixingAll(true);
        let successfullyFixedCount = 0;
        let localBlocks = [...blocks];

        try {
          // Create a copy of the issues to iterate through safely
          const fixableIssues = formatIssues.filter(i => !i.isSceneId);

          for (const issue of fixableIssues) {
            try {
              const result = await applyFixToBlock(issue, localBlocks);
              if (result) {
                if (result.action === 'delete') {
                  localBlocks = localBlocks.filter(b => b.id !== result.blockId);
                } else if (result.action === 'update' && result.fields) {
                  localBlocks = localBlocks.map(b => b.id === result.blockId ? { ...b, ...result.fields } : b);
                }
                successfullyFixedCount++;
              }
            } catch (individualError) {
              console.error(`Failed to automatically fix issue for block ${issue.blockId}:`, individualError);
            }
          }

          // Update React state after processing all fixes
          setBlocks(localBlocks);
          // Filter out completed issues from formatIssues report panel
          setFormatIssues(prev => prev.filter(i => i.isSceneId || !fixableIssues.some(fi => fi.blockId === i.blockId)));
          
          showAlert("Auto-Fix Completed", `Auto-Fix All Completed! Successfully fixed ${successfullyFixedCount} formatting occurrences.`, "success");
        } catch (e) {
          showAlert("Auto-Fix Failed", e instanceof Error ? e.message : "Bulk formatting failed.", "error");
        } finally {
          setIsFixingAll(false);
        }
      },
      "Fix All"
    );
  };

  const handleAutoFix = async (issue: FormatIssue) => {
    if (!projectId) return;
    setIsFixingIssueId(issue.blockId);
    try {
      if (issue.isSceneId) {
        // These can only be edited manually or by using "AI Rewrite" since it has no content blocks yet.
        showAlert(
          "Unwritten Scene",
          "This scene is currently unwritten. Click the purple \"AI Rewrite\" button to automatically generate content blocks for it.",
          "info"
        );
        return;
      }

      const result = await applyFixToBlock(issue, blocks);
      if (result) {
        if (result.action === 'delete') {
          setBlocks((prev) => prev.filter((b) => b.id !== issue.blockId));
        } else if (result.action === 'update' && result.fields) {
          setBlocks((prev) =>
            prev.map((b) => (b.id === issue.blockId ? { ...b, ...result.fields } : b))
          );
        }
        setFormatIssues((prev) => prev.filter((i) => i.blockId !== issue.blockId));
      }
    } catch (e) {
      showAlert("Auto-Fix Failed", e instanceof Error ? e.message : "Failed to apply auto-fix.", "error");
    } finally {
      setIsFixingIssueId(null);
    }
  };

  const handleFormatCheck = (forceScanAll = false) => {
    if (scenes.length === 0) return;
    
    const issues: FormatIssue[] = [];
    
    // If forceScanAll === true, check ALL scenes irrespective of activeView selection.
    const targetScenes = (forceScanAll || viewMode === 'full') 
      ? scenes 
      : (activeSceneId ? scenes.filter((s) => s.id === activeSceneId) : scenes);

    targetScenes.forEach((scene) => {
      const sceneBlocks = blocksByScene[scene.id] || [];
      
      if (sceneBlocks.length === 0) {
        issues.push({
          blockId: scene.id,
          type: 'warning',
          message: `Scene "${scene.slugline_raw}" has no screenplay content blocks.`,
          rule: 'Empty Scene',
          isSceneId: true
        });
        return;
      }

      sceneBlocks.forEach((block) => {
        // 1. Content check
        if (!block.content || block.content.trim() === '') {
          issues.push({
            blockId: block.id,
            type: 'warning',
            message: `Empty ${block.block_type} block in scene "${scene.slugline_raw}".`,
            rule: 'No Empty Elements'
          });
        }

        // 2. Slugline Prefix checking
        if (block.block_type === 'scene_heading') {
          const upperContent = block.content.toUpperCase();
          if (!upperContent.startsWith('INT.') && !upperContent.startsWith('EXT.') && !upperContent.startsWith('INT./EXT.') && !upperContent.startsWith('INT/EXT')) {
            issues.push({
              blockId: block.id,
              type: 'error',
              message: `Slugline heading "${block.content}" does not start with INT., EXT., or INT./EXT.`,
              rule: 'Slugline Standard'
            });
          }
        }

        // 3. Dialogue speaker checks
        if (block.block_type === 'dialogue') {
          if (!block.character_name || block.character_name.trim() === '') {
            issues.push({
              blockId: block.id,
              type: 'error',
              message: `Dialogue element is missing character name in scene "${scene.slugline_raw}".`,
              rule: 'Orphaned Dialogue'
            });
          } else if (block.character_name !== block.character_name.toUpperCase()) {
            issues.push({
              blockId: block.id,
              type: 'warning',
              message: `Character name "${block.character_name}" in scene "${scene.slugline_raw}" should be in ALL CAPS.`,
              rule: 'Capitalization'
            });
          }
        }

        // 4. Parenthetical wrapped brackets checks
        if (block.block_type === 'parenthetical') {
          if (!block.content.startsWith('(') || !block.content.endsWith(')')) {
            issues.push({
              blockId: block.id,
              type: 'warning',
              message: `Parenthetical text "${block.content}" in scene "${scene.slugline_raw}" should be wrapped in parentheses.`,
              rule: 'Parenthetical Brackets'
            });
          }
        }
      });
    });

    setFormatIssues(issues);
    setHasCheckedFormat(true);
  };

  const handleRewriteIncomplete = async () => {
    if (!projectId) return;

    setIsRewritingIncomplete(true);
    setError(null);

    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    try {
      const response = await fetch(`${API_URL}/api/story/rewrite-incomplete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "Failed to trigger AI Rewrite.");
      }
      
      // Let user know the background worker has successfully started
      showAlert("AI Rewrite", data.message || "AI Rewrite kicked off successfully for incomplete scenes!", "success");
    } catch (e) {
      showAlert("AI Rewrite Failed", e instanceof Error ? e.message : "AI Rewrite failed.", "error");
    } finally {
      setIsRewritingIncomplete(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;

    const fetchScript = async (isSilent = false) => {
      if (!isSilent) setIsLoading(true);
      setError(null);
      try {
        const { data: scenesData, error: scenesError } = await supabase
          .from("scenes")
          .select("*")
          .eq("project_id", projectId)
          .order("sort_order", { ascending: true });

        if (scenesError) throw scenesError;

        if (scenesData) {
          const fetchedScenes = (scenesData as Record<string, unknown>[]).map((s) => ({
            ...s,
            id: s.id as string,
            slugline_raw: s.slugline_raw as string,
            location_type: s.location_type as string | undefined,
            location: s.location as string | undefined,
            time_of_day: s.time_of_day as string | undefined,
            summary: s.summary as string | undefined,
            status: s.status as string,
            scene_order: (s.sort_order ?? s.scene_order ?? 0) as number
          })) as ScriptScene[];
          
          setScenes(fetchedScenes);
          
          if (fetchedScenes.length > 0 && !activeSceneIdRef.current) {
            setActiveSceneId(fetchedScenes[0].id);
          }

          const sceneIds = fetchedScenes.map((s) => s.id);

          if (sceneIds.length > 0) {
            // Query utilizing "sort_order" instead of undefined "block_order"
            const { data: blocksData, error: blocksError } = await supabase
              .from("script_blocks")
              .select("*")
              .in("scene_id", sceneIds)
              .order("sort_order", { ascending: true });

            if (blocksError) throw blocksError;

            if (blocksData) {
              // Map database "sort_order" values to typed "block_order" properties gracefully without using implicit any
              const mappedBlocks = (blocksData as Record<string, unknown>[]).map((b) => ({
                ...b,
                id: b.id as string,
                scene_id: b.scene_id as string,
                block_type: b.block_type as "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition",
                content: b.content as string,
                character_name: b.character_name as string | undefined,
                parenthetical: b.parenthetical as string | undefined,
                block_order: (b.sort_order ?? b.block_order ?? 0) as number
              })) as ScriptBlock[];
              
              setBlocks(mappedBlocks);
            }
          }
        }

        const { data: characterRows } = await supabase
          .from("characters")
          .select("id, name, tags, metadata")
          .eq("project_id", projectId);

        if (isMounted && characterRows) {
          setCharacters((characterRows as Record<string, unknown>[]).map((row) => ({
            id: row.id as string,
            name: (row.name as string) ?? "",
            tags: (row.tags as string[] | null) ?? [],
            metadata: (row.metadata as Record<string, unknown> | null) ?? null,
          })));
        }
      } catch (e) {
        if (isMounted) {
          setError(e instanceof Error ? e.message : "Failed to load script data.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchScript(false);
    
    // Setup polling to watch progressive generation updates in background
    const pollInterval = setInterval(() => {
      fetchScript(true);
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [projectId]); // Fixed: explicitly keeping dependency array constant

  const startEditingBlock = (block: ScriptBlock) => {
    setEditingBlockId(block.id);
    setEditingBlockContent(block.content);
  };

  const cancelEditingBlock = () => {
    setEditingBlockId(null);
    setEditingBlockContent("");
  };

  const saveEditedBlock = async (blockId: string) => {
    try {
      const { error: updateError } = await supabase
        .from("script_blocks")
        .update({ content: editedBlockContent })
        .eq("id", blockId);

      if (updateError) throw updateError;

      // Update locally
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, content: editedBlockContent } : b))
      );
      setEditingBlockId(null);
      setEditingBlockContent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save block update.");
    }
  };

  const deleteBlock = async (blockId: string) => {
    showConfirm(
      "Delete Line",
      "Are you sure you want to delete this script line?",
      async () => {
        try {
          const { error: deleteError } = await supabase
            .from("script_blocks")
            .delete()
            .eq("id", blockId);

          if (deleteError) throw deleteError;

          // Update locally
          setBlocks((prev) => prev.filter((b) => b.id !== blockId));
        } catch (e) {
          showAlert("Delete Failed", e instanceof Error ? e.message : "Failed to delete line.", "error");
        }
      },
      "Delete"
    );
  };

  const handleClearScript = async () => {
    if (!projectId) return;

    showConfirm(
      "⚠️ Clear Script",
      "WARNING: This will permanently delete the entire script and all of its scenes. This action CANNOT be undone. Proceed?",
      async () => {
        setIsDeletingScript(true);
        setError(null);
        try {
          // 1. Delete matching scenes from database (This cascade deletes matching script_blocks automatically as defined by ON DELETE CASCADE in scenes)
          const { error: deleteScenesError } = await supabase
            .from("scenes")
            .delete()
            .eq("project_id", projectId);

          if (deleteScenesError) throw deleteScenesError;

          // 2. Delete primary project screenplay document 
          const { error: deleteDocError } = await supabase
            .from("project_documents")
            .delete()
            .eq("project_id", projectId)
            .eq("type", "script");

          if (deleteDocError) throw deleteDocError;

          // 3. Reset local client UI states
          setScenes([]);
          setBlocks([]);
          setActiveSceneId(null);
          showAlert("Clear Script", "The script has been cleared successfully.", "success");
        } catch (e) {
          showAlert("Deletion Failed", e instanceof Error ? e.message : "Failed to delete script data.", "error");
        } finally {
          setIsDeletingScript(false);
        }
      },
      "Delete Everything"
    );
  };

  // Group blocks by scene for rendering
  const blocksByScene = blocks.reduce((acc, block) => {
    if (!acc[block.scene_id]) {
      acc[block.scene_id] = [];
    }
    acc[block.scene_id].push(block);
    return acc;
  }, {} as Record<string, ScriptBlock[]>);

  // Compute progressive generation states
  const totalScenes = scenes.length;
  const completedScenes = scenes.filter((s) => s.status === 'complete').length;
  const inProgressScene = scenes.find((s) => s.status === 'in_progress');
  const isGenerating = scenes.some((s) => s.status === 'in_progress' || s.status === 'pending');
  const progressPercent = totalScenes > 0 ? Math.round((completedScenes / totalScenes) * 100) : 0;
  const activeScene = scenes.find((s) => s.id === activeSceneId);

  // Resolve a screenplay name to its character record so its color and tags stay consistent.
  const findCharacter = (label?: string | null): ScriptCharacter | null => {
    const target = (label ?? "").trim();
    if (!target) return null;
    const exact = characters.find((character) => characterMatchesLabel(character, target));
    if (exact) return exact;
    const firstName = target.split(" ")[0].toLowerCase();
    return characters.find((character) => character.name.trim().toLowerCase().split(" ")[0] === firstName) ?? null;
  };

  const renderBlock = (block: ScriptBlock) => {
    const isEditing = editingBlockId === block.id;
    const isHovered = hoveredBlockId === block.id;

    const renderActionRow = (contentElement: React.ReactNode) => {
      return (
        <div 
          key={block.id}
          onMouseEnter={() => setHoveredBlockId(block.id)}
          onMouseLeave={() => setHoveredBlockId(null)}
          className="group relative px-4 py-1.5 rounded-lg border border-transparent hover:border-zinc-800 hover:bg-zinc-800/20 transition-all"
        >
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={editedBlockContent}
                title="Edit script element"
                placeholder="Write your line..."
                onChange={(e) => setEditingBlockContent(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-100 font-mono focus:outline-none focus:border-violet-500"
                rows={3}
              />
              <div className="flex gap-2 justify-end">
                <button 
                  onClick={cancelEditingBlock}
                  className="px-3 py-1 text-xs border border-zinc-700 hover:bg-zinc-800 rounded text-zinc-400"
                >
                  <X className="w-3.5 h-3.5 inline mr-1" /> Cancel
                </button>
                <button 
                  onClick={() => saveEditedBlock(block.id)}
                  className="px-3 py-1 text-xs bg-violet-600 hover:bg-violet-500 rounded text-white font-medium"
                >
                  <Check className="w-3.5 h-3.5 inline mr-1" /> Save
                </button>
              </div>
            </div>
          ) : (
            <>
              {contentElement}
              {isHovered && !isEditing && (
                <div className="absolute top-1/2 -translate-y-1/2 right-3 flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-md p-1 shadow-md z-10">
                  <button 
                    onClick={() => startEditingBlock(block)}
                    className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded"
                    title="Edit block"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={() => deleteBlock(block.id)}
                    className="p-1 text-red-400 hover:text-red-300 hover:bg-zinc-800 rounded"
                    title="Delete block"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      );
    };

    switch (block.block_type) {
      case "scene_heading":
        return renderActionRow(
          <h3 className="text-zinc-100 font-bold uppercase tracking-wider mt-2 mb-2 text-left">
            {block.content}
          </h3>
        );
      case "action":
        return renderActionRow(
          <p className="mb-2 text-left text-zinc-300">
            {block.content}
          </p>
        );
      case "character": {
        const character = findCharacter(block.content);
        const theme = character ? characterTheme(character) : null;
        const tags = character ? characterTags(character) : [];
        return renderActionRow(
          <div className="max-w-100 mx-auto mt-2">
            <h4
              className="text-center text-zinc-100 font-bold uppercase w-50 mx-auto"
              style={theme ? { color: theme.accent } : undefined}
            >
              {block.content}
            </h4>
            {theme && tags.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
                    style={{ borderColor: theme.border, backgroundColor: theme.soft, color: theme.accent }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      }
      case "parenthetical":
        return renderActionRow(
          <div className="max-w-100 mx-auto text-center italic text-zinc-400">
            {block.content.startsWith('(') ? block.content : `(${block.content})`}
          </div>
        );
      case "dialogue": {
        const speakerName = block.character_name;
        const speaker = speakerName ? findCharacter(speakerName) : null;
        const speakerTheme = speaker ? characterTheme(speaker) : null;
        const speakerTags = speaker ? characterTags(speaker) : [];
        return renderActionRow(
          <div className="max-w-87.5 mx-auto mb-2 text-left">
            {speakerName && (
              <h4
                className="text-center text-zinc-100 font-bold uppercase w-50 mx-auto mb-1"
                style={speakerTheme ? { color: speakerTheme.accent } : undefined}
                title={speakerTags.length > 0 ? `Tags: ${speakerTags.join(', ')}` : undefined}
              >
                {speakerName}
              </h4>
            )}
            {block.parenthetical && (
               <div className="text-center italic text-zinc-400 mb-1 w-50 mx-auto font-mono">
                 {block.parenthetical.startsWith('(') ? block.parenthetical : `(${block.parenthetical})`}
               </div>
            )}
            <p className="text-center md:px-12 text-zinc-200">{block.content}</p>
          </div>
        );
      }
      case "transition":
        return renderActionRow(
          <p className="text-right uppercase font-bold text-zinc-400 mt-3 mb-3 px-16">
            {block.content}
          </p>
        );
      default:
        return renderActionRow(<p className="mb-2">{block.content}</p>);
    }
  };

  return (
    <div className="flex h-full">
      {/* Scene List */}
      <div className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Scenes</h2>
          <button title="New Scene" className="text-xs text-violet-400 hover:text-violet-300 font-medium">
            + New
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {scenes.length === 0 && !isLoading && (
            <div className="text-zinc-500 text-xs text-center p-4">No scenes generated yet.</div>
          )}
          {scenes.map((scene, i) => (
            <button 
              key={scene.id}
              onClick={() => setActiveSceneId(scene.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                activeSceneId === scene.id 
                  ? 'bg-zinc-800 text-zinc-100' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <div className="truncate flex-1">
                <span className="font-mono text-[10px] text-zinc-500 mr-2">{i + 1}</span>
                <span className="font-medium truncate">{scene.slugline_raw}</span>
              </div>
              {scene.status === 'in_progress' && (
                <RefreshCw className="h-3 w-3 animate-spin text-violet-400 shrink-0 ml-2" />
              )}
              {scene.status === 'pending' && (
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0 ml-2"></div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Editor Main */}
      <div className="flex-1 flex flex-col bg-[#0A0A0B]">
        {/* Editor Toolbar */}
        <div className="min-h-12 py-2 border-b border-zinc-800 flex flex-wrap items-center justify-between px-4 gap-3 bg-zinc-900/40 select-none">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider select-none shrink-0 mr-1">Insert Block:</span>
            <button 
              type="button"
              onClick={() => handleAddBlock('scene_heading')}
              className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-md hover:border-violet-500 hover:text-white transition-all text-xs font-semibold text-zinc-400 shrink-0"
              title="Insert Scene Heading (Slugline)"
            >
              🎬 Heading
            </button>
            <button 
              type="button"
              onClick={() => handleAddBlock('action')}
              className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-md hover:border-violet-500 hover:text-white transition-all text-xs font-semibold text-zinc-400 shrink-0"
              title="Insert Action physical description"
            >
              📝 Action
            </button>
            <button 
              type="button"
              onClick={() => handleAddBlock('character')}
              className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-md hover:border-violet-500 hover:text-white transition-all text-xs font-semibold text-zinc-400 shrink-0"
              title="Insert Character Speaker bubble"
            >
              👤 Character
            </button>
            <button 
              type="button"
              onClick={() => handleAddBlock('parenthetical')}
              className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-md hover:border-violet-500 hover:text-white transition-all text-xs font-semibold text-zinc-400 shrink-0"
              title="Insert Parenthetical modifier instruction"
            >
              🎭 Parenthetic
            </button>
            <button 
              type="button"
              onClick={() => handleAddBlock('dialogue')}
              className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-md hover:border-violet-500 hover:text-white transition-all text-xs font-semibold text-zinc-400 shrink-0"
              title="Insert Dialog speech block"
            >
              💬 Dialogue
            </button>
            <button 
              type="button"
              onClick={() => handleAddBlock('transition')}
              className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-md hover:border-violet-500 hover:text-white transition-all text-xs font-semibold text-zinc-400 shrink-0"
              title="Insert Transition (eg FADE OUT.)"
            >
              🏁 Transition
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {scenes.length > 0 && (
              <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-850 shrink-0 select-none mr-2">
                <button
                  type="button"
                  onClick={() => setViewMode('single')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-all duration-150 ${
                    viewMode === 'single'
                      ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700/50 shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                  }`}
                  title="Only show the currently selected active scene"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Active Scene</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('full')}
                  className={`flex items-all gap-1.5 px-3 py-1 rounded text-xs transition-all duration-150 ${
                    viewMode === 'full'
                      ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700/50 shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                  }`}
                  title="Show continuous script view with auto-scrolling"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Full Script</span>
                </button>
              </div>
            )}
            
            {scenes.length > 0 && (
              <button 
                onClick={handleClearScript}
                disabled={isDeletingScript}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-md transition-colors disabled:opacity-50 shrink-0"
                title="Delete screenplay from project"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeletingScript ? "Deleting..." : "Delete Script"}
              </button>
            )}

            <button 
              type="button"
              onClick={() => handleFormatCheck(false)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors border shrink-0 ${
                hasCheckedFormat 
                  ? formatIssues.length > 0 
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20' 
                    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20'
                  : 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20'
              }`}
              title="Scan format compliance for screenplay blocks in the active view"
            >
              <Play className="w-3.5 h-3.5" />
              {hasCheckedFormat 
                ? formatIssues.length > 0 
                  ? `Format checked (${formatIssues.length} issues)` 
                  : "Format perfect!" 
                : "Format check"}
            </button>
            
            {scenes.length > 0 && (
              <button 
                type="button"
                onClick={() => handleFormatCheck(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border text-cyan-400 bg-cyan-500/10 border-cyan-500/20 hover:bg-cyan-500/20 transition-colors shrink-0"
                title="Scan all scenes and blocks inside the entire screenplay at once"
              >
                Scan All {scenes.length} Scenes
              </button>
            )}
            <button 
              type="button"
              onClick={handleRewriteIncomplete}
              disabled={isRewritingIncomplete || isGenerating}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded-md transition-colors disabled:opacity-50 shrink-0"
              title="Rewrite/generate any incomplete scenes in this script"
            >
              {isRewritingIncomplete ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Bot className="w-3.5 h-3.5" />
              )}
              {isRewritingIncomplete ? "Rewriting Incomplete..." : "AI Rewrite"}
            </button>
          </div>
        </div>

        {/* Script Generation Progress Bar */}
        {isGenerating && (
          <div className="bg-zinc-950/80 border-b border-zinc-800/80 backdrop-blur-md px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in duration-300">
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                <span className="flex items-center gap-2 text-violet-400">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Generating Screenplay...
                </span>
                <span className="font-mono text-zinc-300">{progressPercent}% ({completedScenes}/{totalScenes} Scenes)</span>
              </div>
              <div className="w-full bg-zinc-800/80 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-linear-to-r from-violet-600 via-violet-500 to-fuchsia-600 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {inProgressScene && (
                <p className="mt-1 text-[11px] text-zinc-500 truncate italic">
                  Currently writing: <span className="text-zinc-400 font-mono not-italic">{inProgressScene.slugline_raw}</span>
                </p>
              )}
            </div>
            
            {/* Visual Dot Sequence Map */}
            <div className="flex items-center gap-1.5 shrink-0 bg-zinc-900/50 p-2 rounded-lg border border-zinc-800/40">
              {scenes.map((scene, index) => {
                let dotClass = "bg-zinc-800 text-zinc-500 border-zinc-700/60";
                if (scene.status === 'complete') {
                  dotClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
                } else if (scene.status === 'in_progress') {
                  dotClass = "bg-violet-500/20 text-violet-450 border-violet-500/70 animate-pulse font-bold";
                }
                return (
                  <div 
                    key={scene.id} 
                    title={`${index + 1}. ${scene.slugline_raw} (${scene.status})`}
                    className={`w-6 h-6 rounded-full border text-[10px] font-medium flex items-center justify-center transition-all cursor-help ${dotClass}`}
                  >
                    {index + 1}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Editor Canvas */}
        <div ref={canvasContainerRef} className="flex-1 overflow-auto flex flex-col items-center py-12 relative scroll-smooth bg-linear-to-b from-[#0e0e11] to-[#08080a]">
          {error && <div className="absolute top-4 bg-red-500/10 border border-red-500/40 text-red-200 px-4 py-2 rounded-lg text-sm z-10">{error}</div>}
          
          {/* Format Check Issue Report Panel */}
          {hasCheckedFormat && (
            <div className="w-full max-w-200 min-w-175 mb-6 bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-5 backdrop-blur-md shadow-xl animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-zinc-850 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${formatIssues.length > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest font-sans">
                    Format check report — {formatIssues.length > 0 ? `${formatIssues.length} issues found` : 'Screenplay formatted perfectly!'}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  {formatIssues.filter((i) => !i.isSceneId).length > 0 && (
                    <button
                      type="button"
                      onClick={handleFixAllIssues}
                      disabled={isFixingAll}
                      className="px-3 py-1 text-xs font-bold text-emerald-400 hover:text-white bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 rounded-md transition-all duration-150 uppercase tracking-wider"
                    >
                      {isFixingAll ? "Fixing All..." : "Fix All Issues"}
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={() => { setHasCheckedFormat(false); setFormatIssues([]); }}
                    className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors uppercase font-mono tracking-wider animate-in fade-in duration-300"
                  >
                    Dismiss Report
                  </button>
                </div>
              </div>
              
              {formatIssues.length > 0 ? (
                <div className="max-h-40 overflow-y-auto space-y-2.5 pr-2">
                  {formatIssues.map((issue, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-850/40 hover:border-zinc-800/65 rounded-lg p-2.5 transition-all text-xs">
                      <div className="flex items-start gap-2.5 flex-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 mt-0.5 ${
                          issue.type === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/15' : 'bg-amber-500/10 text-amber-400 border border-amber-500/15'
                        }`}>
                          {issue.type}
                        </span>
                        <div className="text-zinc-350">
                          <strong className="text-zinc-200 font-mono">[{issue.rule}]</strong> {issue.message}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAutoFix(issue)}
                        disabled={isFixingIssueId === issue.blockId}
                        className="ml-4 px-2.5 py-1 text-[10px] font-bold text-violet-400 hover:text-white bg-violet-600/10 hover:bg-violet-600 border border-violet-500/20 rounded-md transition-all duration-150 shrink-0 uppercase tracking-wider"
                      >
                        {isFixingIssueId === issue.blockId ? "Fixing..." : "Auto Fix"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-400 italic">
                  All characters names are capitalized, parentheticals have wrapping brackets, and all headings follow Hollywood standard rules. Superb formatting!
                </p>
              )}
            </div>
          )}

          <div className="w-full max-w-200 min-w-175 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-12 min-h-full font-mono text-sm leading-relaxed text-zinc-300">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center pt-20">
                <RefreshCw className="h-8 w-8 animate-spin text-zinc-500 mb-4" />
                <p className="text-zinc-500">Loading your script...</p>
              </div>
            ) : scenes.length > 0 ? (
                // Render the script content based on view mode (Active Scene Only or Full continuous)
                <div className="script-container">
                  {viewMode === 'single' && activeScene && (
                    <div className="mb-8 pb-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <span className="font-sans text-xs font-semibold uppercase tracking-wider text-violet-400">
                          Scene {scenes.indexOf(activeScene) + 1} of {scenes.length}
                        </span>
                        <h2 className="text-lg font-bold text-zinc-100 font-mono mt-0.5 wrap-break-word">{activeScene.slugline_raw}</h2>
                      </div>
                      <span className="font-mono text-xs text-zinc-400 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800 shrink-0 select-none self-start sm:self-auto">
                        {activeScene.location_type || 'INT/EXT'} • {activeScene.time_of_day || 'DAY'}
                      </span>
                    </div>
                  )}

                  {viewMode === 'single' ? (
                    activeScene ? (
                      <div key={activeScene.id} className="mb-10">
                        {(blocksByScene[activeScene.id] || []).length > 0 ? (
                          (blocksByScene[activeScene.id] || []).map(renderBlock)
                        ) : (
                          <div className="text-zinc-500 text-xs italic text-center p-8 border border-dashed border-zinc-800 rounded-lg">
                            This scene has no content blocks yet. Click &quot;AI Rewrite&quot; or type in the editor below.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-zinc-500 text-sm text-center p-12">
                        No active scene selected. Click a scene from the sidebar.
                      </div>
                    )
                  ) : (
                    // Full Script view (continuous) with highlighted active scene
                    scenes.map((scene, idx) => {
                      const isActive = activeSceneId === scene.id;
                      return (
                        <div 
                          key={scene.id} 
                          id={`scene-${scene.id}`}
                          className={`mb-12 p-6 rounded-xl border transition-all duration-300 ${
                            isActive 
                              ? 'bg-zinc-900/40 border-violet-500/35 shadow-lg ring-1 ring-violet-500/10' 
                              : 'border-transparent bg-transparent'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 border-b border-zinc-850 pb-2 select-none">
                            <span className={`font-sans text-xs font-bold uppercase tracking-wider min-w-0 flex-1 wrap-break-word ${isActive ? 'text-violet-400' : 'text-zinc-500'}`}>
                              Scene {idx + 1} • {scene.slugline_raw}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 truncate max-w-40 shrink-0 self-start sm:self-auto">
                              {scene.location_type || 'INT'}
                            </span>
                          </div>
                          {(blocksByScene[scene.id] || []).length > 0 ? (
                            (blocksByScene[scene.id] || []).map(renderBlock)
                          ) : (
                            <div className="text-zinc-500 text-xs italic text-center p-8 border border-dashed border-zinc-800 rounded-lg">
                              This scene is empty.
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  <div className="mt-10 border border-zinc-800 bg-zinc-950/40 rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-xs text-zinc-500 font-sans">
                      <span className="flex items-center gap-1.5 font-medium text-zinc-400 select-none">
                        ✍️ Draft New Line as:
                        <select 
                          value={draftType}
                          title="Screenplay element draft type"
                          aria-label="Screenplay element draft type"
                          onChange={(e) => setDraftType(e.target.value as "action" | "dialogue" | "character" | "parenthetical")}
                          className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2 py-0.5 ml-1 focus:outline-none focus:border-violet-500 font-medium cursor-pointer"
                        >
                          <option value="action">📝 Action Block</option>
                          <option value="dialogue">💬 Dialogue Line</option>
                          <option value="character">👤 Character Name</option>
                          <option value="parenthetical">🎭 Parenthetical Direction</option>
                        </select>
                      </span>
                      <span className="hidden sm:inline select-none text-[11px] text-zinc-500">
                        Press <kbd className="bg-zinc-900 px-1.5 py-0.5 border border-zinc-800 text-zinc-400 rounded text-[10px] font-mono shadow-sm">Enter</kbd> to append
                      </span>
                    </div>

                    <textarea 
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      onKeyDown={handleDraftKeyDown}
                      className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-zinc-200 font-mono text-xs focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/10 placeholder-zinc-600 resize-none min-h-20" 
                      rows={3}
                      placeholder={
                        viewMode === 'single'
                          ? `Draft next line for "${activeScene?.slugline_raw || 'active scene'}"...`
                          : "Draft next line for the highlighted active scene..."
                      }
                      disabled={isAppendingDraft}
                    />

                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-zinc-500 max-w-[65%] leading-relaxed font-sans select-none">
                        {draftType === 'dialogue' && "💡 Alternating rules automatically inherit parent speaker bubble."}
                        {draftType === 'character' && "💡 Type a character name. Will be fully capitalized automatically."}
                        {draftType === 'action' && "💡 Describe physical events, character actions, landscapes, or sounds."}
                        {draftType === 'parenthetical' && "💡 Modifiers like (whispering) or (pointing) wrapped automatically."}
                      </p>
                      
                      <button
                        type="button"
                        onClick={() => handleAppendDraft()}
                        disabled={isAppendingDraft || !draftContent.trim()}
                        className="px-4 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-all disabled:opacity-40 disabled:hover:bg-violet-600 flex items-center gap-1.5 shrink-0 select-none cursor-pointer"
                      >
                        {isAppendingDraft ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin mr-1" /> Adding...
                          </>
                        ) : (
                          <>Append Line</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
            ) : (
                <div className="text-center pt-20 text-zinc-650">
                   Generate a script from the Outline tab first.
                </div>
            )}
          </div>
        </div>
      </div>
      <AlertModal
        isOpen={alertState.isOpen}
        type={alertState.type}
        title={alertState.title}
        message={alertState.message}
        confirmLabel={alertState.confirmLabel}
        cancelLabel={alertState.cancelLabel}
        onConfirm={alertState.onConfirm}
        onClose={() => setAlertState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}