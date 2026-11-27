"use client";

import type { ReactNode } from 'react';

const ACCENT = '#a78bfa';

interface PanelTabsProps<K extends string> {
  tabs: { key: K; label: ReactNode }[];
  active: K;
  onChange: (key: K) => void;
}

/** The side panel's tab strip, styled like the Characters page. */
export function PanelTabs<K extends string>({ tabs, active, onChange }: PanelTabsProps<K>) {
  return <div role="tablist" className="grid border-b border-zinc-800 text-xs font-semibold" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
    {tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={active === tab.key} onClick={() => onChange(tab.key)} className={`-mb-px border-b-2 py-2.5 ${active === tab.key ? 'text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`} style={active === tab.key ? { borderColor: ACCENT } : undefined}>{tab.label}</button>)}
  </div>;
}
