import { GigLead } from './linkedin';

export async function fetchRemoteOKLeads(tag = 'react'): Promise<GigLead[]> {
  const url = `https://remoteok.com/api?tag=${encodeURIComponent(tag)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.warn(`[RemoteOK] Status ${res.status}`);
      return [];
    }
    const data: any = await res.json();
    if (!Array.isArray(data)) return [];

    const leads: GigLead[] = [];
    // Item 0 is usually metadata/legal
    for (const item of data.slice(1, 15)) {
      if (!item || typeof item !== 'object') continue;
      const position = item.position || '';
      const company = item.company || 'Tech Startup';
      const applyUrl = item.apply_url || item.url || '';
      const targetUrl = applyUrl.startsWith('http') ? applyUrl : `https://remoteok.com${applyUrl}`;
      const desc = (item.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      leads.push({
        id: `remoteok:${item.id || item.epoch || targetUrl}`,
        source: 'RemoteOK',
        title: position,
        company,
        location: '100% Remote',
        url: targetUrl,
        posted: item.date ? String(item.date).slice(0, 10) : 'Recent',
        snippet: desc.slice(0, 400),
      });
    }
    return leads;
  } catch (err) {
    console.error('[RemoteOK] Fetch error:', err);
    return [];
  }
}
