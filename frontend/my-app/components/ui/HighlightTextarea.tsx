import React, { useRef, useEffect, useMemo } from 'react';

interface HighlightTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  tags?: string[];
}

export function HighlightTextarea({
  value,
  onChange,
  className,
  tags = [],
  ...textareaProps
}: HighlightTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const tagSet = useMemo(() => new Set(tags), [tags]);

  // Sync scrolling between textarea and backdrop
  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  useEffect(() => {
    handleScroll();
  }, [value]);

  // Function to render text with highlighted tags
  const renderHighlights = () => {
    if (!value) return null;

    // Pattern to match [image1], [image2], etc.
    const regex = /(\[image\d+\])/g;
    const parts = value.split(regex);

    return parts.map((part, i) => {
      const tag = part.slice(1, -1);
      if (part.match(regex) && (tagSet.size === 0 || tagSet.has(tag))) {
        return (
          <span key={i} className="text-blue-400 bg-blue-500/20 rounded">
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className={`relative ${className || ''}`}>
      {/* Backdrop for highlights */}
      <div
        ref={backdropRef}
        className="absolute inset-0 pointer-events-none break-words whitespace-pre-wrap overflow-hidden"
        style={{
          padding: '12px 16px 16px 16px', // Matches textarea roughly
          fontFamily: 'inherit',
          fontSize: '0.875rem', // text-sm
          lineHeight: '1.25rem'
        }}
        aria-hidden="true"
      >
        <div className="text-zinc-200">
          {renderHighlights()}
          {/* Add zero-width space if ends with newline to maintain height */}
          {value.endsWith('\n') && <br />}
        </div>
      </div>

      {/* Actual textarea, totally transparent text, caret is visible */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onScroll={handleScroll}
        className="w-full h-full bg-transparent text-transparent caret-zinc-200 placeholder:text-zinc-600 text-sm px-4 pt-3 pb-4 resize-none focus:outline-none relative z-10"
        style={{
          fontFamily: 'inherit'
        }}
        {...textareaProps}
      />
    </div>
  );
}
