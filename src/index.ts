import { fetchLinkedInContractJobs, GigLead, fetchLinkedInJobDescription } from './sources/linkedin';
import { fetchHNContractLeads } from './sources/hackernews';
import {
  sendLeadToTelegram,
  sendTelegramMessage,
  answerCallbackQuery,
  sendResumeDocument,
  updateTelegramDashboard,
} from './telegram';
import master from './resume/master.json';
import { aiTailorResume } from './resume/ai-tailor';
import { buildDocx, resumeFilename } from './resume/docx';

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

    if (url.pathname === '/status') {
      const targetChatId = env.TELEGRAM_CHAT_ID || '96092687';
      const result = await updateTelegramDashboard(env.TELEGRAM_BOT_TOKEN, targetChatId, env.GIG_KV, {
        sources: {
          LinkedIn: { count: 0, status: '200 OK' },
          HackerNews: { count: 0, status: '200 OK' },
        },
        newLeads: 0,
        totalSeen: 0,
      });
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/set-webhook') {
      const webhookUrl = url.origin;
      const res = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/webhook-info') {
      const res = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`
      );
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST') {
      try {
        const update: any = await request.json();

        // 1. Handle Callback Query (click "📝 ساخت رزومه اختصاصی (ATS 100)")
        if (update?.callback_query) {
          const cb = update.callback_query;
          const data: string = cb.data || '';
          const chatId = cb.message?.chat?.id;

          if (data.startsWith('tailor:') && chatId) {
            const leadId = data.replace('tailor:', '');
            // Immediate feedback popup to Telegram
            await answerCallbackQuery(
              env.TELEGRAM_BOT_TOKEN,
              cb.id,
              '⏳ در حال ساخت رزومه بهینه‌شده با هوش مصنوعی...'
            );

            // Execute in background so the webhook responds immediately
            ctx.waitUntil(handleTailorRequest(env, chatId, leadId));
            return new Response('OK');
          }
        }

        // 2. Handle Text Messages
        const chatId = update?.message?.chat?.id;
        const text = update?.message?.text;

        if (chatId && text) {
          if (text.startsWith('/start')) {
            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `🎯 <b>GigRadar Online!</b>\n\nI monitor LinkedIn & HackerNews for <b>Contract & Freelance Projects</b> matching your stack:\n• React & Next.js\n• Django & Python\n• Full-Stack MVPs\n\n💡 <b>دو راه برای ساخت رزومه اختصاصی:</b>\n1. روی دکمه <b>📝 ساخت رزومه اختصاصی</b> زیر هر آگهی کلیک کنید.\n2. یا <b>متن کامل هر شرح شغل (JD)</b> را مستقیماً همینجا بفرستید تا هوش مصنوعی فوراً رزومه متناسب با آن را بازنویسی کند و فایل Word (.docx) تحویل دهد.\n\n/scan برای اسکن دستی | /status برای مشاهده وضعیت.`
            );
          } else if (text.startsWith('/scan')) {
            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `🔍 Scanning LinkedIn for fresh contract & freelance gigs...`
            );
            ctx.waitUntil(scanAndNotify(env, true));
          } else if (text.startsWith('/status')) {
            const targetChatId = env.TELEGRAM_CHAT_ID || String(chatId);
            ctx.waitUntil(
              updateTelegramDashboard(env.TELEGRAM_BOT_TOKEN, targetChatId, env.GIG_KV, {
                sources: {
                  LinkedIn: { count: 0, status: '200 OK' },
                  HackerNews: { count: 0, status: '200 OK' },
                },
                newLeads: 0,
                totalSeen: 0,
              })
            );
          } else {
            // Direct Job Description text sent by the user!
            if (text.trim().length >= 30) {
              await sendTelegramMessage(
                env.TELEGRAM_BOT_TOKEN,
                chatId,
                '⏳ <b>متن شرح شغل دریافت شد. در حال تحلیل نیازمندی‌ها و بازنویسی رزومه با هوش مصنوعی...</b>'
              );
              ctx.waitUntil(handleDirectJdRequest(env, chatId, text.trim()));
            } else {
              await sendTelegramMessage(
                env.TELEGRAM_BOT_TOKEN,
                chatId,
                'متن ارسالی خیلی کوتاه است. لطفاً متن کامل شرح شغل (Job Description) را بفرستید تا رزومه متناسب با آن بازنویسی شود.'
              );
            }
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
        usage: 'Send GET /trigger?force=true or send /scan or paste JD in Telegram.',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scanAndNotify(env, false));
  },
};

/** Handles direct text sent by the user (pasted Job Description). */
async function handleDirectJdRequest(env: Env, chatId: string | number, jdText: string) {
  try {
    // 1. Tailor Resume using Cloudflare Workers AI
    const result = await aiTailorResume(env.AI, master, jdText);

    // 2. Build DOCX
    const docxBytes = buildDocx(result.resume);
    const targetTitle = result.resume.header.headline || 'Custom_Role';
    const filename = resumeFilename(result.resume.header.name, targetTitle.slice(0, 25));

    // 3. Format Report & Stats
    const rep = result.report;
    const topKeywords = rep.matched.slice(0, 8).map((k) => k.display).join(', ');
    const gaps =
      rep.gaps.length > 0
        ? rep.gaps.slice(0, 5).map((g) => g.term).join(', ')
        : 'ندارد (تمام مهارت‌های ذکرشده پوشش داده شد)';

    const caption = [
      `🎯 <b>رزومه اختصاصی شما آماده شد!</b>`,
      ``,
      `💼 <b>عنوان پوزیشن هدف:</b> ${result.resume.header.headline}`,
      `📊 <b>نمره تطابق ATS:</b> <code>${rep.score}/100</code>`,
      `🤖 <b>مدل هوش مصنوعی:</b> ${result.usedAi ? 'Llama 3.1 8B (Workers AI)' : 'Deterministic Matcher'}`,
      `✅ <b>کلمات کلیدی منطبق (${rep.matched.length}):</b> ${topKeywords}`,
      `⚠️ <b>گپ‌های مهارتی (در رزومه نبود و جعل نشد):</b> ${gaps}`,
      ``,
      `📝 <b>خلاصه شغلی تولیدشده:</b>`,
      `<blockquote>${escapeHtml(result.resume.summary)}</blockquote>`,
      ``,
      `📄 <i>فایل Word (.docx) استاندارد و تک‌ستونه برای ارسال پیوست شد.</i>`,
    ].join('\n');

    // 4. Deliver document
    await sendResumeDocument(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      docxBytes,
      filename,
      caption
    );
  } catch (err: any) {
    console.error('Direct JD tailor failed:', err);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `❌ خطا در ساخت رزومه: ${err?.message || String(err)}`
    );
  }
}

/** Handles button click under an alerted lead. */
async function handleTailorRequest(env: Env, chatId: string | number, leadId: string) {
  try {
    // 1. Send status notification
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⏳ <b>در حال تحلیل موقعیت شغلی و استخراج کلمات کلیدی با هوش مصنوعی...</b>'
    );

    // 2. Fetch lead info from KV
    let lead: GigLead | null = null;
    const raw = await env.GIG_KV.get(leadId);
    if (raw) {
      try {
        lead = JSON.parse(raw);
      } catch {}
    }

    // 3. Obtain JD text
    let jdText = '';
    let roleTitle = 'Software Engineer';
    let companyName = 'Contract';

    if (lead) {
      roleTitle = lead.title;
      companyName = lead.company;
      jdText = lead.snippet || `${lead.title} at ${lead.company}`;

      // If LinkedIn, fetch full description
      if (lead.source === 'LinkedIn' && lead.id.startsWith('linkedin:')) {
        const jobId = lead.id.replace('linkedin:', '');
        const fullDesc = await fetchLinkedInJobDescription(jobId);
        if (fullDesc && fullDesc.length > 50) {
          jdText = `${lead.title}\n${lead.company}\n${fullDesc}`;
        }
      }
    } else {
      if (leadId.startsWith('linkedin:')) {
        const jobId = leadId.replace('linkedin:', '');
        const fullDesc = await fetchLinkedInJobDescription(jobId);
        if (fullDesc) jdText = fullDesc;
      }
      if (!jdText) {
        jdText = 'Full-Stack Developer Contract (React, Next.js, Django, TypeScript, Tailwind CSS, REST APIs)';
      }
    }

    // 4. Tailor Resume with Workers AI
    const result = await aiTailorResume(env.AI, master, jdText);

    // 5. Build DOCX
    const docxBytes = buildDocx(result.resume);
    const filename = resumeFilename(result.resume.header.name, companyName);

    // 6. Report summary
    const rep = result.report;
    const topKeywords = rep.matched.slice(0, 8).map((k) => k.display).join(', ');
    const gaps =
      rep.gaps.length > 0
        ? rep.gaps.slice(0, 5).map((g) => g.term).join(', ')
        : 'ندارد (تمام نیازمندی‌ها پوشش داده شد)';

    const caption = [
      `🎯 <b>رزومه اختصاصی شما آماده شد!</b>`,
      ``,
      `💼 <b>پوزیشن:</b> ${roleTitle} (${companyName})`,
      `📊 <b>نمره تطابق ATS:</b> <code>${rep.score}/100</code>`,
      `🤖 <b>مدل هوش مصنوعی:</b> ${result.usedAi ? 'Llama 3.1 8B (Workers AI)' : 'Deterministic Matcher'}`,
      `✅ <b>کلمات کلیدی منطبق (${rep.matched.length}):</b> ${topKeywords}`,
      `⚠️ <b>گپ‌های مهارتی:</b> ${gaps}`,
      ``,
      `📝 <b>خلاصه شغلی تولیدشده:</b>`,
      `<blockquote>${escapeHtml(result.resume.summary)}</blockquote>`,
      ``,
      `📄 <i>فایل ورد تک‌ستونه، استاندارد و بدون جدول جهت عبور موفق از فیلتر اولیه ATS.</i>`,
    ].join('\n');

    // 7. Deliver DOCX directly to Telegram
    await sendResumeDocument(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      docxBytes,
      filename,
      caption
    );
  } catch (err: any) {
    console.error('Tailor request failed:', err);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `❌ خطا در ساخت رزومه: ${err?.message || String(err)}`
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

    // Generate tailored pitch with Workers AI if available
    let pitch: string | undefined = undefined;
    if (env.AI) {
      try {
        const aiPrompt = `You are Alireza, a full-stack developer (React, Next.js, Django, Tailwind). Write a 2-sentence direct proposal pitch to the hiring team for this contract gig:\nRole: ${lead.title} at ${lead.company}\nSnippet: ${lead.snippet}\nKeep it confident, highlight relevant React/Django experience, zero fluff.`;

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
        // Store the lead object in KV for future on-demand resume generation
        await env.GIG_KV.put(lead.id, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 14 });
      }
    }
  }

  // Update live status dashboard on Telegram
  const targetChatId = env.TELEGRAM_CHAT_ID || '96092687';
  if (env.TELEGRAM_BOT_TOKEN) {
    const liErr = debugErrors.find((e) => e.kw === 'React');
    const liStatus = liErr ? `${liErr.status || 'Err'}` : '200 OK';
    const sourceStats: Record<string, { count: number; status: string }> = {
      LinkedIn: {
        count: stats.sources['LinkedIn'] || 0,
        status: liStatus,
      },
      HackerNews: {
        count: stats.sources['HackerNews'] || 0,
        status: '200 OK',
      },
    };

    await updateTelegramDashboard(env.TELEGRAM_BOT_TOKEN, targetChatId, env.GIG_KV, {
      sources: sourceStats,
      newLeads: stats.sentToTelegram,
      totalSeen: stats.checked,
    });
  }

  return { ...stats, debugErrors };
}
