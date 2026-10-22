/**
 * Inline Markdown user manual.
 *
 * The manual itself lives in `USER_MANUAL.md` at the repository root and is
 * bundled as a raw string, then rendered by the small renderer below. Keeping
 * the source as Markdown means the same document doubles as the repo README
 * companion and the in-app help screen.
 */

import { useMemo, type ReactNode } from 'react';
import manualSource from '../../USER_MANUAL.md?raw';

/** Renders inline spans: `code`, **bold**, *italic*, [links](url). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index}`;
    index += 1;

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      }
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderTable(rows: string[], key: string): ReactNode {
  const cells = rows.map((row) =>
    row
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim()),
  );
  const [head, , ...body] = cells;
  return (
    <div className="manual__table-wrap" key={key}>
      <table className="manual__table">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index}>{renderInline(cell, `${key}-h${index}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderInline(cell, `${key}-r${rowIndex}c${cellIndex}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Minimal block-level Markdown renderer covering everything the manual uses. */
function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];
    const nextKey = () => `md-${key++}`;

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // Fenced code block
    if (line.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={nextKey()} className="manual__code">
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={nextKey()} />);
      index += 1;
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], nextKey());
      if (level === 1) blocks.push(<h1 key={nextKey()}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={nextKey()}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={nextKey()}>{content}</h3>);
      else blocks.push(<h4 key={nextKey()}>{content}</h4>);
      index += 1;
      continue;
    }

    // Table
    if (line.trim().startsWith('|')) {
      const rows: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(lines[index].trim());
        index += 1;
      }
      blocks.push(renderTable(rows, nextKey()));
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={nextKey()}>{renderInline(quote.join(' '), nextKey())}</blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={nextKey()}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `${nextKey()}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={nextKey()}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `${nextKey()}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#{1,4}\s|```|>|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[index]) &&
      !/^---+$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={nextKey()}>{renderInline(paragraph.join(' '), nextKey())}</p>);
  }

  return blocks;
}

export function UserManual() {
  const content = useMemo(() => renderMarkdown(manualSource), []);
  return <article className="manual">{content}</article>;
}
