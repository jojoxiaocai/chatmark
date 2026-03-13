function htmlToMarkdown(html) {
  if (!html) return '';

  let md = html;

  // Code blocks: <pre><code class="language-xxx">...</code></pre>
  md = md.replace(/<pre[^>]*>\s*<code(?:\s+class="(?:language-)?([^"]*)")?[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, lang, code) => {
      const decoded = decodeHtmlEntities(code.trim());
      return `\n\`\`\`${lang || ''}\n${decoded}\n\`\`\`\n`;
    });

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeHtmlEntities(code)}\``);

  // Headings
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) =>
    `\n${'#'.repeat(Number(level))} ${stripTags(text).trim()}\n`);

  // Bold and italic
  md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');

  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Images
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const lines = stripTags(content).trim().split('\n');
    return lines.map(line => `> ${line}`).join('\n') + '\n';
  });

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, item) =>
      `- ${stripTags(item).trim()}`
    ) + '\n';
  });

  // Ordered lists
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let i = 0;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, item) =>
      `${++i}. ${stripTags(item).trim()}`
    ) + '\n';
  });

  // Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows = [];
    const rowMatches = tableContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const row of rowMatches) {
      const cells = [];
      const cellMatches = row.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
      for (const cell of cellMatches) {
        const text = stripTags(cell.replace(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/i, '$1')).trim();
        cells.push(text);
      }
      rows.push(cells);
    }
    if (rows.length === 0) return '';
    const header = `| ${rows[0].join(' | ')} |`;
    const separator = `| ${rows[0].map(() => '---').join(' | ')} |`;
    const body = rows.slice(1).map(r => `| ${r.join(' | ')} |`).join('\n');
    return `\n${header}\n${separator}\n${body}\n`;
  });

  // Horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Paragraphs and line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n');

  // Strip remaining HTML tags
  md = stripTags(md);

  // Decode HTML entities
  md = decodeHtmlEntities(md);

  // Clean up excessive blank lines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
    '&#x2F;': '/', '&#x60;': '`', '&#x3D;': '=',
  };
  return text.replace(/&(?:#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, match =>
    entities[match] || match
  );
}

function formatOutputMarkdown({ question, answer, summary, title, timestamp, url }) {
  const date = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
  const readableDate = formatReadableDate(date);
  const displayTitle = title || question?.slice(0, 40) || '未命名笔记';

  let md = `# ${displayTitle}\n\n`;

  if (summary) {
    md += `> ${summary.replace(/\n/g, '\n> ')}\n\n`;
  }

  md += `## 问题\n${question || '(无问题)'}\n\n`;
  md += `## 回答\n${answer || '(无内容)'}\n\n`;
  md += `---\n来源：豆包 | ${readableDate}`;
  if (url) {
    md += ` | [原始对话](${url})`;
  }
  md += '\n';

  return md;
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50)
    .replace(/_+$/, '');
}

function generateFilename(title, template = '{date}_{title}') {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const safeTitle = sanitizeFilename(title || '未命名');
  return template
    .replace('{date}', date)
    .replace('{title}', safeTitle)
    .replace('{timestamp}', now.getTime().toString())
    + '.md';
}

function escapeYaml(str) {
  return str.replace(/"/g, '\\"');
}

function formatReadableDate(isoStr) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n) {
  return n.toString().padStart(2, '0');
}
