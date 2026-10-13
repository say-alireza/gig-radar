import { fetchLinkedInContractJobs, GigLead } from './sources/linkedin';
import { fetchHNContractLeads } from './sources/hackernews';
import { sendLeadToTelegram } from './telegram';

export interface Env {
  GIG_KV: KVNamespace;
  AI: any;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  SEARCH_KEYWORDS?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' || url.pathname === '/scan') {
      const force = url.searchParams.get('force') === 'true';
      const customKw = url.searchParams.get('kw');
      const result = await scanAndNotify(env, force, customKw || undefined);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST') {
      try {
        const update: any = await request.json();
        const chatId = update?.message?.chat?.id;
        const text = update?.message?.text;

        if (chatId && text) {
          if (text.startsWith('/start')) {
            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `🎯 <b>GigRadar Online!</b>\n\nI monitor LinkedIn for <b>Contract & Freelance Projects</b> matching your stack:\n• React & Next.js\n• Django & Python\n• Full-Stack MVPs\n\nPure full-time employment roles are strictly filtered out.\nSend /scan to check now!`
            );
          } else if (text.startsWith('/scan')) {
            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `🔍 Scanning LinkedIn for fresh contract & freelance gigs...`
            );
            ctx.waitUntil(scanAndNotify(env, true));
          }
        }
      } catch (err) {
        console.error('Webhook error:', err);
      }
      return new Response('OK');
    }

    return new Response(
      JSON.stringify({
        status: 'online',
        service: 'gig-radar',
        usage: 'Send GET /trigger?force=true or send /scan in Telegram.',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scanAndNotify(env, false));
  },
};

async function scanAndNotify(env: Env, force = false, overrideKw?: string) {
  const keywords = overrideKw
    ? [overrideKw]
    : ['React', 'Django', 'Next.js'];

  const stats = {
    checked: 0,
    accepted: 0,
    sentToTelegram: 0,
    sources: {} as Record<string, number>,
  };

  const allLeads: GigLead[] = [];

  const debugErrors: any[] = [];
  for (const kw of keywords) {
    const res = await fetchLinkedInContractJobs(kw);
    if (res.leads.length > 0) {
      allLeads.push(...res.leads);
    } else {
      debugErrors.push({ kw, status: res.status, err: res.err });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Backup: HN Contract only if LinkedIn has 0
  if (allLeads.length === 0) {
    for (const kw of ['React', 'Django']) {
      const hnLeads = await fetchHNContractLeads(kw);
      allLeads.push(...hnLeads);
    }
  }

  stats.checked = allLeads.length;

  let sentCount = 0;
  for (const lead of allLeads) {
    stats.sources[lead.source] = (stats.sources[lead.source] || 0) + 1;
    stats.accepted++;

    const exists = await env.GIG_KV.get(lead.id);
    if (exists && !force) {
      continue;
    }

    if (force && sentCount >= 3) {
      break;
    }

    // Generate tailored pitch with Workers AI
    let pitch: string | undefined = undefined;
    if (env.AI) {
      try {
        const aiPrompt = `You are Alireza, a full-stack developer (React, Next.js, Django, Tailwind). Write a 2-sentence direct proposal pitch to the hiring team for this contract gig:
Role: ${lead.title} at ${lead.company}
Snippet: ${lead.snippet}
Keep it confident, highlight relevant React/Django experience, zero fluff.`;

        const response: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'user', content: aiPrompt }],
          max_tokens: 100,
        });
        pitch = response?.response?.trim();
      } catch (e) {
        console.warn('[AI] Pitch error:', e);
      }
    }

    const targetChatId = env.TELEGRAM_CHAT_ID || '96092687';
    if (env.TELEGRAM_BOT_TOKEN) {
      const sent = await sendLeadToTelegram(env.TELEGRAM_BOT_TOKEN, targetChatId, lead, pitch);
      if (sent) {
        stats.sentToTelegram++;
        sentCount++;
        await env.GIG_KV.put(lead.id, '1', { expirationTtl: 60 * 60 * 24 * 14 });
      }
    }
  }

  return { ...stats, debugErrors };
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('Send error:', err);
  }
}
