import { GigLead } from './linkedin';

export async function fetchWWRLeads(): Promise<GigLead[]> {
  const url = 'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss';

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const leads: GigLead[] = [];

    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = itemRegex.exec(xml)) !== null && count < 5) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
      const guidMatch = itemXml.match(/<guid[^>]*>(.*?)<\/guid>/);
      const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);

      const rawTitle = titleMatch ? titleMatch[1] || titleMatch[2] : 'Remote Position';
      const url = linkMatch ? linkMatch[1] : '';
      const guid = guidMatch ? guidMatch[1] : url;

      // Extract Company and Role (usually formatted as "Company: Role")
      const parts = rawTitle.split(':');
      const company = parts.length > 1 ? parts[0].trim() : 'Startup';
      const title = parts.length > 1 ? parts.slice(1).join(':').trim() : rawTitle;

      leads.push({
        id: `wwr:${guid}`,
        source: 'WeWorkRemotely',
        title,
        company,
        location: 'Remote',
        url,
        snippet: rawTitle,
        posted: pubDateMatch ? pubDateMatch[1] : 'Recent',
      });
      count++;
    }

    return leads;
  } catch (err) {
    console.error(`[WWR] Fetch error:`, err);
    return [];
  }
}
