import { fetchLinkedInContractJobs, GigLead, fetchLinkedInJobDescription } from './sources/linkedin';
import { fetchHNContractLeads } from './sources/hackernews';
import {
  sendLeadToTelegram,
  sendTelegramMessage,
  answerCallbackQuery,
  sendResumeDocument,
  sendResumePdf,
  updateTelegramDashboard,
} from './telegram';
import master from './resume/master.json';
import { aiTailorResume } from './resume/ai-tailor';
import { buildDocx, resumeFilename } from './resume/docx';
import { buildPdf, resumePdfFilename } from './resume/pdf';

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

        // 1. Handle Callback Query (e.g. click "📝 ساخت رزومه اختصاصی (ATS 100)")
        if (update?.callback_query) {
          const cb = update.callback_query;
          const data: string = cb.data || '';
          const chatId = cb.message?.chat?.id;

          if (data.startsWith('tailor:') && chatId) {
            const leadId = data.replace('tailor:', '');

            // Immediate acknowledgement popup
            await answerCallbackQuery(
              env.TELEGRAM_BOT_TOKEN,
              cb.id,
              '📋 لطفاً شرح شغل را بفرستید...'
            );

            // Fetch lead metadata from KV
            let leadTitle = 'Software Engineer';
            let leadCompany = 'Contract';
            const raw = await env.GIG_KV.get(leadId);
            if (raw) {
              try {
                const leadObj = JSON.parse(raw);
                leadTitle = leadObj.title || leadTitle;
                leadCompany = leadObj.company || leadCompany;
              } catch {}
            }

            // Save user state in KV: waiting for JD text for this specific lead
            await env.GIG_KV.put(
              `user_state:${chatId}`,
              JSON.stringify({
                action: 'waiting_jd',
                leadId,
                title: leadTitle,
                company: leadCompany,
              }),
              { expirationTtl: 3600 }
            );

            // Ask the user to copy/paste the JD
            const promptMsg = [
              `📋 <b>لطفاً متن شرح شغل (Job Description) را ارسال کنید:</b>`,
              ``,
              `💼 <b>پوزیشن انتخاب‌شده:</b> ${escapeHtml(leadTitle)} (${escapeHtml(leadCompany)})`,
              ``,
              `متن شرح شغل، نیازمندی‌ها و مهارت‌های خواسته‌شده (Requirements / Stack) را از صفحه آگهی کپی کرده و <b>همینجا در چت پیست نمایید</b>.`,
              ``,
              `🤖 <i>به محض دریافت متن، هوش مصنوعی رزومه مادر شما را اختصاصاً متناسب با نیازمندی‌های این پوزیشن بازنویسی کرده و فایل Word (.docx) استاندارد ATS را تحویل می‌دهد.</i>`,
            ].join('\n');

            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, promptMsg);
            return new Response('OK');
          }
        }

        // 2. Handle Text Messages
        const chatId = update?.message?.chat?.id;
        const text = update?.message?.text;

        if (chatId && text) {
          // Check if user is replying to a "waiting_jd" request
          const stateRaw = await env.GIG_KV.get(`user_state:${chatId}`);
          if (stateRaw) {
            try {
              const state = JSON.parse(stateRaw);
              if (state?.action === 'waiting_jd') {
                await env.GIG_KV.delete(`user_state:${chatId}`);
                await sendTelegramMessage(
                  env.TELEGRAM_BOT_TOKEN,
                  chatId,
                  `⏳ <b>متن شرح شغل دریافت شد!</b>\nدر حال تحلیل نیازمندی‌ها و بازنویسی رزومه برای <b>${escapeHtml(state.title)} (${escapeHtml(state.company)})</b> با هوش مصنوعی...`
                );
                ctx.waitUntil(
                  handleTailorWithJd(
                    env,
                    chatId,
                    text.trim(),
                    state.title,
                    state.company
                  )
                );
                return new Response('OK');
              }
            } catch {}
          }

          if (text.startsWith('/start')) {
            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `🎯 <b>GigRadar Online!</b>\n\nI monitor LinkedIn & HackerNews for <b>100% Remote Contract Projects</b> matching your stack:\n• React & Next.js\n• Django & Python\n• Full-Stack MVPs\n\n💡 <b>دو روش ساخت رزومه اختصاصی:</b>\n1. روی دکمه <b>📝 ساخت رزومه اختصاصی</b> زیر هر آگهی بزنید؛ ربات از شما متن آگهی را می‌خواهد و رزومه متناسب می‌سازد.\n2. یا هر زمان <b>متن هر شرح شغل (JD)</b> را مستقیماً همینجا بفرستید تا هوش مصنوعی فوراً رزومه اختصاصی و فایل Word (.docx) برایتان تولید کند.\n\n/scan برای اسکن دستی | /status برای داشبورد زنده.`
            );
          } else if (text.startsWith('/scan')) {
            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `🔍 Scanning for fresh remote contract & freelance gigs...`
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
            // User pasted a Job Description directly without clicking a button first
            if (text.trim().length >= 30) {
              await sendTelegramMessage(
                env.TELEGRAM_BOT_TOKEN,
                chatId,
                '⏳ <b>متن شرح شغل دریافت شد. در حال تحلیل نیازمندی‌ها و بازنویسی رزومه با هوش مصنوعی...</b>'
              );
              ctx.waitUntil(
                handleTailorWithJd(env, chatId, text.trim(), 'Custom Role', 'Contract')
              );
              return new Response('OK');
            } else {
              await sendTelegramMessage(
                env.TELEGRAM_BOT_TOKEN,
                chatId,
                'متن ارسالی خیلی کوتاه است. لطفاً متن کامل شرح شغل (Job Description) را بفرستید تا رزومه متناسب با آن بازنویسی شود.'
              );
              return new Response('OK');
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

/** Unified tailor engine with Workers AI and DOCX export. */
async function handleTailorWithJd(
  env: Env,
  chatId: string | number,
  jdText: string,
  targetTitle: string,
  targetCompany: string
) {
  try {
    // 1. Tailor Resume using Cloudflare Workers AI
    const result = await aiTailorResume(env.AI, master, jdText);

    // 2. Build 1-Page PDF
    const pdfBytes = await buildPdf(result.resume);
    const pdfFilename = resumePdfFilename(result.resume.header.name, targetCompany || 'Resume');

    // 3. Deliver PDF directly to Telegram
    const rep = result.report;
    const topKeywords = rep.matched.slice(0, 6).map((k) => k.display).join(', ');

    const caption = [
      `📄 <b>Alireza Rahimpanah — Tailored Resume (PDF)</b>`,
      `💼 <b>Target:</b> ${escapeHtml(targetTitle || result.resume.header.headline)} (${escapeHtml(targetCompany)})`,
      `📊 <b>ATS Score:</b> <code>${rep.score}/100</code>`,
      `✅ <b>Matched:</b> ${topKeywords}`,
    ].join('\n');

    const pdfRes = await sendResumePdf(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      pdfBytes,
      pdfFilename,
      caption
    );

    if (!pdfRes.ok) {
      console.error('[sendResumePdf] Delivery error:', pdfRes.error);
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `❌ خطا در ارسال فایل PDF به تلگرام: ${pdfRes.error}`
      );
    }
  } catch (err: any) {
    console.error('Tailor with JD failed:', err);
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
