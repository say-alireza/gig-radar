export interface GigLead {
  id: string;
  source: 'LinkedIn' | 'HackerNews';
  title: string;
  company: string;
  location: string;
  url: string;
  snippet: string;
  directContact?: string;
  posted?: string;
}

export async function fetchLinkedInContractJobs(keyword: string): Promise<{ status: number; leads: GigLead[]; err?: string }> {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(
    keyword
  )}&f_WT=2&f_JT=C&f_TPR=r86400&sortBy=DD&start=0`;

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return { status: res.status, leads: [], err: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const leads: GigLead[] = [];

    const rawItems = html.split(/<li\b[^>]*>/i).slice(1);

    for (const item of rawItems) {
      const urnMatch = item.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/i);
      if (!urnMatch) continue;
      const jobId = urnMatch[1];

      const titleMatch = item.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h3>/i);
      const companyMatch = item.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>|<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h4>/i);
      const locationMatch = item.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/span>/i);
      const linkMatch = item.match(/<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i);
      const timeMatch = item.match(/<time[^>]*>\s*([\s\S]*?)\s*<\/time>/i);

      const title = titleMatch ? cleanText(titleMatch[1]) : 'Developer';
      const company = companyMatch ? cleanText(companyMatch[1] || companyMatch[2] || 'Company') : 'Company';
      const location = locationMatch ? cleanText(locationMatch[1]) : 'Remote';
      const cleanUrl = linkMatch ? linkMatch[1].split('?')[0] : `https://www.linkedin.com/jobs/view/${jobId}`;
      const posted = timeMatch ? cleanText(timeMatch[1]) : 'Recent';

      const isTech = /developer|engineer|frontend|front-end|backend|back-end|fullstack|full-stack|software|react|django|python|web|architect/.test(
        title.toLowerCase()
      );
      if (!isTech) continue;

      leads.push({
        id: `linkedin:${jobId}`,
        source: 'LinkedIn',
        title,
        company,
        location,
        url: cleanUrl,
        snippet: `${title} at ${company} (Remote Contract Gig)`,
        posted,
      });
    }

    return { status: res.status, leads };
  } catch (err: any) {
    return { status: 0, leads: [], err: err?.message || String(err) };
  }
}

function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}
