<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  // Lightweight inline markdown renderer. Handles the subset used in
  // WALKTHROUGH.md: headings, paragraphs, lists, blockquotes, bold, italic,
  // code, hr. Avoids a heavy dependency for what is structurally simple text.
  function renderMd(src: string): string {
    const lines = src.replace(/\r/g, '').split('\n');
    const out: string[] = [];
    let para: string[] = [];
    let inList = false;
    let inOl = false;
    let inBlockquote = false;

    function flushPara() {
      if (para.length === 0) return;
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
    function closeBlocks() {
      flushPara();
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
    }
    function inline(s: string): string {
      // Escape first
      s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Inline code
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      // Bold
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Italic
      s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
      // Links [text](url)
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      return s;
    }

    for (const raw of lines) {
      const line = raw;
      if (/^\s*$/.test(line)) { closeBlocks(); continue; }
      const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (hMatch) {
        closeBlocks();
        const lvl = hMatch[1].length;
        out.push(`<h${lvl}>${inline(hMatch[2])}</h${lvl}>`);
        continue;
      }
      if (/^---\s*$/.test(line)) {
        closeBlocks();
        out.push('<hr />');
        continue;
      }
      const ulMatch = line.match(/^[-*]\s+(.*)$/);
      if (ulMatch) {
        flushPara();
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(ulMatch[1]) + '</li>');
        continue;
      }
      const olMatch = line.match(/^\d+\.\s+(.*)$/);
      if (olMatch) {
        flushPara();
        if (inList) { out.push('</ul>'); inList = false; }
        if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
        if (!inOl) { out.push('<ol>'); inOl = true; }
        out.push('<li>' + inline(olMatch[1]) + '</li>');
        continue;
      }
      const bqMatch = line.match(/^>\s?(.*)$/);
      if (bqMatch) {
        flushPara();
        if (inList) { out.push('</ul>'); inList = false; }
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true; }
        out.push('<p>' + inline(bqMatch[1]) + '</p>');
        continue;
      }
      // Paragraph continuation
      if (inList || inOl) closeBlocks();
      if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
      para.push(line);
    }
    closeBlocks();
    return out.join('\n');
  }

  const html = $derived(renderMd(data.md));
</script>

<div class="max-w-3xl mx-auto">
  <div class="prose-walkthrough">
    {@html html}
  </div>
  <p class="text-xs text-ink-500 mt-8 pb-4">
    Source: <code>phase2/WALKTHROUGH.md</code> &middot; edit there to update this page.
  </p>
</div>
