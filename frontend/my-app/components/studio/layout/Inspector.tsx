"use client";

import React from 'react';
import { Settings2, Wand2, X } from 'lucide-react';

interface InspectorProps {
  activeView: string;
  selectedItem?: Record<string, unknown> | null;
  onClose: () => void;
}

export function StudioInspector({ activeView, selectedItem, onClose }: InspectorProps) {
  const selectedName = typeof selectedItem?.name === 'string' ? selectedItem.name : '';
  const selectedRole = typeof selectedItem?.role === 'string' ? selectedItem.role : '';
  const selectedAge = typeof selectedItem?.age === 'number' ? selectedItem.age : '';
  const selectedAppearance = typeof selectedItem?.appearance === 'string' ? selectedItem.appearance : '';

  return (
    <div className="h-full w-80 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-y-auto shadow-2xl shadow-black/50">
      <div className="h-14 border-b border-zinc-800 px-4 flex items-center justify-between sticky top-0 bg-zinc-950/90 backdrop-blur z-10 text-sm font-medium text-zinc-100">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-zinc-400" />
          Inspector
        </div>
        <button type="button" onClick={onClose} aria-label="Close inspector" className="text-zinc-400 hover:text-zinc-100 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="p-4 space-y-6">
        {activeView === 'characters' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-zinc-100 font-medium mb-1">Character Details</h3>
              <p className="text-xs text-zinc-500">Configure character properties</p>
            </div>
            
            <div className="space-y-3">
              <div>
                <label htmlFor="character-name" className="text-xs font-medium text-zinc-400 mb-1.5 block">Name</label>
                <input 
                  id="character-name"
                  type="text" 
                  key={`name-${selectedItem?.id ?? 'empty'}`}
                  defaultValue={selectedName}
                  placeholder="Select or create a character"
                  className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm focus:border-violet-500 outline-none transition-colors" 
                />
              </div>
              <div>
                <label htmlFor="character-role" className="text-xs font-medium text-zinc-400 mb-1.5 block">Role</label>
                <input 
                  id="character-role"
                  type="text" 
                  key={`role-${selectedItem?.id ?? 'empty'}`}
                  defaultValue={selectedRole}
                  placeholder="Role"
                  className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm focus:border-violet-500 outline-none transition-colors" 
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="character-age" className="text-xs font-medium text-zinc-400 mb-1.5 block">Age</label>
                  <input 
                    id="character-age"
                    type="number" 
                    key={`age-${selectedItem?.id ?? 'empty'}`}
                    defaultValue={selectedAge}
                    className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm focus:border-violet-500 outline-none transition-colors" 
                  />
                </div>
                <div>
                  <label htmlFor="character-voice" className="text-xs font-medium text-zinc-400 mb-1.5 block">Voice</label>
                  <select id="character-voice" className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm focus:border-violet-500 outline-none transition-colors appearance-none">
                    <option>Deep Male 1</option>
                    <option>Gruff 2</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="character-appearance" className="text-xs font-medium text-zinc-400 mb-1.5 block">Appearance Description</label>
                <textarea 
                  id="character-appearance"
                  key={`appearance-${selectedItem?.id ?? 'empty'}`}
                  defaultValue={selectedAppearance}
                  placeholder="Appearance description"
                  className="min-h-25 w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm focus:border-violet-500 outline-none transition-colors resize-none" 
                />
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button className="flex items-center justify-center gap-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium hover:bg-zinc-800 transition-colors">
                Update Properties
              </button>
              <button className="flex items-center justify-center gap-2 w-full rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors">
                <Wand2 className="w-4 h-4" />
                Generate New Look
              </button>
            </div>
          </div>
        )}
        
        {activeView !== 'characters' && (
          <div className="text-center py-12 px-4 border border-dashed border-zinc-800 rounded-xl">
            <p className="text-sm text-zinc-500">Select an item in the workspace to view properties.</p>
          </div>
        )}
      </div>
    </div>
  );
}
