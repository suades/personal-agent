import React from 'react';

/**
 * Lightweight markdown renderer for agent notes — supports [links](url),
 * raw URLs, **bold**, and "- " bullet lists. No dependency, no HTML injection
 * (everything renders through React elements).
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // markdown link | raw URL | **bold**
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)|\*\*([^*]+)\*\*/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }

    if (match[1] && match[2]) {
      parts.push(
        <a key={`${keyPrefix}-l${match.index}`} href={match[2]} target="_blank" rel="noreferrer"
          className="text-blue-400 hover:underline break-all">
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      // raw URL — trim trailing punctuation the LLM may attach
      const url = match[3].replace(/[).,;]+$/, '');
      const trailing = match[3].slice(url.length);
      parts.push(
        <a key={`${keyPrefix}-l${match.index}`} href={url} target="_blank" rel="noreferrer"
          className="text-blue-400 hover:underline break-all">
          {url}
        </a>
      );
      if (trailing) parts.push(<span key={`${keyPrefix}-p${match.index}`}>{trailing}</span>);
    } else if (match[4]) {
      parts.push(<strong key={`${keyPrefix}-b${match.index}`} className="font-semibold text-text">{match[4]}</strong>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`${keyPrefix}-t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

export function LinkifyText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc pl-4 space-y-1 my-1">{bullets}</ul>
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(<li key={`li-${i}`}>{renderInline(bullet[1], `li-${i}`)}</li>);
      return;
    }
    flushBullets(`ul-${i}`);
    if (line.trim() === '') {
      blocks.push(<div key={`sp-${i}`} className="h-2" />);
    } else {
      blocks.push(<p key={`p-${i}`} className="my-0.5">{renderInline(line, `p-${i}`)}</p>);
    }
  });
  flushBullets('ul-end');

  return <div className="leading-relaxed">{blocks}</div>;
}
