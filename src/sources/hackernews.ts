import { GigLead } from './linkedin';

export async function fetchHNContractLeads(keyword: string): Promise<GigLead[]> {
  // Specifically search for freelance & contract gigs with explicit contact info
  const query = `${keyword} (freelance OR contractor OR "short term" OR MVP) remote`;
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=comment&query=${encodeURIComponent(
    query
  )}&hitsPerPage=10`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!res.ok) return [];

    const data: any = await res.json();
    const hits = data.hits || [];
    const leads: GigLead[] = [];

    for (const h of hits) {
      const text = h.comment_text || '';
      const lower = text.toLowerCase();

      // STRICT FILTER: Reject pure full-time posts
      if (lower.includes('full-time') && !lower.includes('contract') && !lower.includes('freelance')) {
        continue;
      }

      // Must explicitly mention contract or freelance or project
      if (!lower.includes('contract') && !lower.includes('freelance') && !lower.includes('project') && !lower.includes('mvp')) {
        continue;
      }

      const emailMatch = text.match(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/);
      const email = emailMatch ? emailMatch[0] : undefined;

      const plainText = text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
      const lines = plainText.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const title = lines[0]?.slice(0, 80) || `HN Contract: ${keyword}`;

      leads.push({
        id: `hn:${h.objectID}`,
        source: 'HackerNews',
        title,
        company: h.author || 'Startup Founder',
        location: 'Remote',
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: plainText.slice(0, 300),
        directContact: email,
        posted: new Date(h.created_at).toLocaleDateString(),
      });
    }

    return leads;
  } catch (err) {
    console.error(`[HN] Fetch error:`, err);
    return [];
  }
}
