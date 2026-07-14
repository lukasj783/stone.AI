"use client";

import React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Plus, MoreVertical } from 'lucide-react';

interface CharactersProps {
  onSelect: (item: Record<string, unknown>) => void;
}

const CHARACTERS = [
  {
    id: 1,
    name: 'Commander Jax',
    role: 'Lead Protagonist',
    image: 'https://picsum.photos/seed/jax/400/500',
    tags: ['Hero', 'Veteran']
  },
  {
    id: 2,
    name: 'Lt. Vasquez',
    role: 'Tech Officer',
    image: 'https://picsum.photos/seed/vasquez/400/500',
    tags: ['Genius', 'Anxious']
  },
  {
    id: 3,
    name: 'The Overlord',
    role: 'Antagonist',
    image: 'https://picsum.photos/seed/overlord/400/500',
    tags: ['Alien', 'Menacing']
  },
];

export function Characters({ onSelect }: CharactersProps) {
  const router = useRouter();

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Characters</h1>
          <p className="text-sm text-zinc-400">Manage and generate character assets for your project.</p>
        </div>
        <button 
          onClick={() => router.push('/character')}
          className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors shadow-sm shadow-violet-900/20"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Character
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {CHARACTERS.map((char) => (
          <div 
            key={char.id}
            onClick={() => onSelect(char)}
            className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 hover:border-violet-500 hover:shadow-lg hover:shadow-violet-900/10 transition-all cursor-pointer relative flex flex-col"
          >
             <button title="More options" className="absolute top-3 right-3 p-1.5 rounded-md bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60 z-10">
              <MoreVertical className="w-4 h-4" />
             </button>
            <div className="aspect-3/4 w-full relative bg-zinc-800 overflow-hidden">
               <Image 
                 src={char.image} 
                 alt={char.name}
                 fill
                 sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                 className="object-cover group-hover:scale-105 transition-transform duration-500"
               />
               <div className="absolute inset-0 bg-linear-to-t from-zinc-950 via-zinc-950/20 to-transparent"></div>
            </div>
            <div className="p-4 absolute bottom-0 left-0 w-full">
              <h3 className="text-lg font-bold text-white mb-1">{char.name}</h3>
              <p className="text-xs text-zinc-400 mb-3">{char.role}</p>
              <div className="flex gap-2">
                {char.tags.map(tag => (
                  <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}

        {/* Generate New Placeholder */}
        <div 
          onClick={() => router.push('/character')}
          className="group overflow-hidden rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 hover:bg-zinc-800/50 hover:border-violet-500 transition-all cursor-pointer flex flex-col items-center justify-center min-h-90 aspect-3/4"
        >
           <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4 group-hover:bg-violet-600/20 text-zinc-500 group-hover:text-violet-400 transition-colors">
              <Plus className="w-6 h-6" />
           </div>
           <span className="text-sm font-medium text-zinc-400 group-hover:text-zinc-200">Generate Character</span>
        </div>
      </div>
    </div>
  );
}