import type { Knowledge, SearchHit } from './types.ts';

export function searchKnowledge(records: Knowledge[], query: string): SearchHit[] {
  const terms = query.toLocaleLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}_-]+/gu) ?? [];
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const record of records) {
    record.content.split(/\r?\n\s*\r?\n/).forEach((paragraph, index) => {
      const text = `${record.title} ${record.tags.join(' ')} ${paragraph}`.toLocaleLowerCase();
      const score = terms.reduce((sum, term) => sum + text.split(term).length - 1, 0);
      if (score)
        hits.push({
          id: record.id,
          title: record.title,
          excerpt: paragraph.trim().slice(0, 300),
          score,
          paragraph: index + 1,
        });
    });
  }
  return hits.sort((left, right) => right.score - left.score || left.paragraph - right.paragraph);
}
