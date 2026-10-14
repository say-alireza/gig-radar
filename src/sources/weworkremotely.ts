import { GigLead } from './linkedin';
import { createLeadId } from './hash';

export async function fetchWWRLeads(): Promise<GigLead[]> {
  const categories = [
    'remote-front-end-programming-jobs',
    'remote-full-stack-programming-jobs',
  ];

  const leads: GigLead[] = [];

  for (const cat of categories) {
    const url = `https://weworkremotely.com/categories/${cat}.rss`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        },
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match: RegExpExecArray | null;
      let count = 0;

      while ((match = itemRegex.exec(xml)) !== null && count < 8) {
        const itemXml = match[1];
        const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
        const guidMatch = itemXml.match(/<guid[^>]*>(.*?)<\/guid>/);
        const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);
        const descMatch = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/s);

        const rawTitle = titleMatch ? titleMatch[1] || titleMatch[2] : 'Remote Position';
        const link = linkMatch ? linkMatch[1] : '';
        const guid = guidMatch ? guidMatch[1] : link;
        const rawDesc = descMatch ? descMatch[1] || descMatch[2] || '' : '';
        const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        const parts = rawTitle.split(':');
        const company = parts.length > 1 ? parts[0].trim() : 'Startup';
        const title = parts.length > 1 ? parts.slice(1).join(':').trim() : rawTitle;

        leads.push({
          id: createLeadId('wwr', guid),
          source: 'WeWorkRemotely',
          title,
          company,
          location: '100% Remote',
          url: link,
          snippet: cleanDesc.slice(0, 400),
          posted: pubDateMatch ? pubDateMatch[1] : 'Recent',
        });
        count++;
      }
    } catch (err) {
      console.error(`[WWR] Error fetching ${cat}:`, err);
    }
  }

  return leads;
}
