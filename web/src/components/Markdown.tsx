// The record's bodies use a fixed subset of Markdown: headings, paragraphs, lists, bold, inline
// code, links, code fences (highlighted) and mermaid fences (drawn). No HTML passes through.
import { useEffect, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);

// Safety note: the only HTML ever injected below comes from highlight.js, which escapes the source
// text and emits its own span markup, and from mermaid rendering at securityLevel 'strict', which
// sanitizes labels. Record text itself is never inserted as HTML.
export function Code({ code, language, start = 1, highlight }: { code: string; language?: string; start?: number; highlight?: number }) {
  const lang = language && hljs.getLanguage(language) ? language : undefined;
  const html = lang ? hljs.highlight(code, { language: lang }).value : escapeHtml(code);
  const lines = html.split('\n');
  return (
    <pre className="code numbered">
      {lines.map((l, i) => (
        <span key={i} className={`ln ${highlight === start + i ? 'hl' : ''}`}>
          <span className="no">{start + i}</span>
          <span className="src" dangerouslySetInnerHTML={{ __html: l || ' ' }} />
        </span>
      ))}
    </pre>
  );
}

let mermaidReady: Promise<any> | undefined;
function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((m) => {
      const dark = document.documentElement.dataset.theme !== 'light';
      m.default.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict', fontFamily: "'Archivo Variable', system-ui, sans-serif" });
      return m.default;
    });
  }
  return mermaidReady;
}

let mermaidSeq = 0;
export function Diagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    let alive = true;
    loadMermaid()
      .then((m) => m.render(`at-mermaid-${++mermaidSeq}`, source))
      .then(({ svg }: { svg: string }) => { if (alive && ref.current) ref.current.innerHTML = svg; })
      .catch((e: Error) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [source]);
  if (err) return <pre className="code">{source}{'\n\n'}(diagram could not be drawn: {err})</pre>;
  return <div className="diagram" ref={ref} role="img" aria-label="Diagram" />;
}

/** `onLink` is called with the slug inside a [[wikilink]]. Without it the link is plain words. */
export function Markdown({ text, onLink }: { text: string; onLink?: (slug: string) => void }) {
  const blocks = tokenize(text);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'fence') return b.lang === 'mermaid' ? <Diagram key={i} source={b.body} /> : <Code key={i} code={b.body} language={b.lang} />;
        if (b.kind === 'heading') {
          // The pane already owns h2, so a body's own headings start below it and never
          // outrank the title of the thing being read.
          const Tag = `h${Math.min((b.level ?? 3) + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6';
          return <Tag key={i}>{b.body}</Tag>;
        }
        if (b.kind === 'ul') return <ul key={i}>{b.items!.map((it, j) => <li key={j}><Inline text={it} onLink={onLink} /></li>)}</ul>;
        if (b.kind === 'ol') return <ol key={i}>{b.items!.map((it, j) => <li key={j}><Inline text={it} onLink={onLink} /></li>)}</ol>;
        return <p key={i}><Inline text={b.body} onLink={onLink} /></p>;
      })}
    </>
  );
}

interface Block { kind: 'p' | 'fence' | 'heading' | 'ul' | 'ol'; body: string; lang?: string; items?: string[]; level?: number }

function tokenize(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push({ kind: 'fence', body: body.join('\n'), lang });
      continue;
    }
    const h = /^(#{1,6}) /.exec(line);
    if (h) { out.push({ kind: 'heading', body: line.slice(h[1].length + 1), level: h[1].length }); i++; continue; }
    if (/^(\d+\.|[-*]) /.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^(\d+\.|[-*]) /.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        if (/^(\d+\.|[-*]) /.test(lines[i])) items.push(lines[i].replace(/^(\d+\.|[-*]) /, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push({ kind: ordered ? 'ol' : 'ul', body: '', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !/^(#{3,6} |\d+\. |[-*] )/.test(lines[i])) para.push(lines[i++]);
    out.push({ kind: 'p', body: para.join(' ') });
  }
  return out;
}

// The code span is the first alternative, so anything inside backticks stays literal; fenced
// blocks never reach this function at all. Bold is non-greedy and allows a * inside it, which is
// what made a brief print its own ** markers. Italic requires a non-word character either side so
// snake_case identifiers are left alone.
const INLINE = /(`[^`]+`|\*\*[\s\S]+?\*\*|(?<![A-Za-z0-9_])_[^_\n]+_(?![A-Za-z0-9_])|\[\[[^\]|]+\]\]|\[[^\]]+\]\([^)]+\))/g;

function Inline({ text, onLink }: { text: string; onLink?: (slug: string) => void }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
        if (p.length > 2 && p.startsWith('_') && p.endsWith('_')) return <i key={i}>{p.slice(1, -1)}</i>;
        if (p.startsWith('[[') && p.endsWith(']]')) {
          const slug = p.slice(2, -2);
          const label = slug.replace(/-/g, ' ');
          if (!onLink) return <span key={i}>{label}</span>;
          return <button key={i} className="wikilink" onClick={() => onLink(slug)}>{label}</button>;
        }
        const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
        if (m && /^https?:\/\//.test(m[2])) return <a key={i} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
