import { GigLead } from './sources/linkedin';

export async function sendLeadToTelegram(
  botToken: string,
  chatId: string,
  lead: GigLead,
  pitch?: string
): Promise<boolean> {
  const sourceEmoji = lead.source === 'LinkedIn' ? '💼' : lead.source === 'HackerNews' ? '🔶' : '🌐';

  let message = `${sourceEmoji} <b>New Lead: ${escapeHtml(lead.title)}</b>\n\n`;
  message += `🏢 <b>Company:</b> ${escapeHtml(lead.company)}\n`;
  message += `💼 <b>Workplace:</b> 🌐 100% Remote (Contract)\n`;
  message += `📍 <b>Region / Location:</b> ${escapeHtml(lead.location)}\n`;
  message += `⏱ <b>Published:</b> <code>${escapeHtml(lead.posted || 'Recent')}</code>\n`;
  message += `🏷 <b>Source:</b> ${lead.source}\n`;

  if (lead.directContact) {
    message += `✉️ <b>Direct Email:</b> <code>${escapeHtml(lead.directContact)}</code>\n`;
  }

  if (pitch) {
    message += `\n💡 <b>Draft Pitch (Ready to send):</b>\n<blockquote>${escapeHtml(pitch)}</blockquote>\n`;
  }

  const inlineKeyboard: any[] = [];
  const linkRow: any[] = [];

  if (lead.url) {
    linkRow.push({
      text: `🚀 Open on ${lead.source}`,
      url: lead.url,
    });
  }

  if (lead.directContact) {
    linkRow.push({
      text: '📧 Send Email',
      url: `mailto:${lead.directContact}?subject=${encodeURIComponent('Quick Question - ' + lead.title)}`,
    });
  }

  if (linkRow.length > 0) {
    inlineKeyboard.push(linkRow);
  }

  // Buttons for Resume tailoring & Cloud Apply
  inlineKeyboard.push([
    {
      text: '📝 ساخت رزومه اختصاصی (PDF)',
      callback_data: `tailor:${lead.id}`,
    },
  ]);
  inlineKeyboard.push([
    {
      text: '🤖 پر کردن و اپلای خودکار (Cloud Apply)',
      callback_data: `apply:${lead.id}`,
    },
  ]);

  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
    reply_markup: inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined,
  };

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Telegram] Send failed: ${res.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Telegram] Network error:`, err);
    return false;
  }
}

export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '🔍 اسکن موقعیت‌های جدید' }, { text: '📊 وضعیت رادار' }],
    [{ text: '📝 ساخت رزومه از متن' }, { text: '🤖 اپلای خودکار با لینک' }],
    [{ text: 'ℹ️ راهنما' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  replyMarkup: any = MAIN_KEYBOARD
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error(`[Telegram] Message send error:`, err);
    return false;
  }
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });
  } catch (err) {
    console.error(`[Telegram] answerCallbackQuery error:`, err);
  }
}

export async function sendResumeDocument(
  botToken: string,
  chatId: string | number,
  docBytes: Uint8Array,
  filename: string,
  caption?: string
): Promise<{ ok: boolean; error?: string }> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  const fileBlob = new Blob([docBytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  form.append('document', fileBlob, filename);
  if (caption) {
    // Strictly cap caption at 1000 characters to avoid Telegram 400 Bad Request
    const safeCaption = caption.length > 1000 ? caption.slice(0, 997) + '...' : caption;
    form.append('caption', safeCaption);
    form.append('parse_mode', 'HTML');
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Telegram] sendDocument failed: ${res.status} - ${errText}`);
      return { ok: false, error: `${res.status}: ${errText}` };
    }
    return { ok: true };
  } catch (err: any) {
    console.error(`[Telegram] sendDocument network error:`, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function sendResumePdf(
  botToken: string,
  chatId: string | number,
  pdfBytes: Uint8Array,
  filename: string,
  caption?: string
): Promise<{ ok: boolean; error?: string }> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  const fileBlob = new Blob([pdfBytes], {
    type: 'application/pdf',
  });
  form.append('document', fileBlob, filename);
  if (caption) {
    const safeCaption = caption.length > 1000 ? caption.slice(0, 997) + '...' : caption;
    form.append('caption', safeCaption);
    form.append('parse_mode', 'HTML');
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Telegram] sendResumePdf failed: ${res.status} - ${errText}`);
      return { ok: false, error: `${res.status}: ${errText}` };
    }
    return { ok: true };
  } catch (err: any) {
    console.error(`[Telegram] sendResumePdf network error:`, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function updateTelegramDashboard(
  botToken: string,
  chatId: string,
  kv: KVNamespace,
  stats: {
    sources: Record<string, { count: number; status: string }>;
    newLeads: number;
    totalSeen: number;
  }
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const now = new Date();
  const nowStr = now.toLocaleString('en-GB', {
    timeZone: 'Asia/Tehran',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: 'short',
  });

  const liStatus = stats.sources.LinkedIn?.status || '200 OK';
  const liCount = stats.sources.LinkedIn?.count || 0;
  const hnStatus = stats.sources.HackerNews?.status || '200 OK';
  const hnCount = stats.sources.HackerNews?.count || 0;

  const allHealthy = !liStatus.includes('Err') && !hnStatus.includes('Err');
  const statusEmoji = allHealthy ? '🟢' : '🟡';
  const statusText = allHealthy ? 'All Systems Active' : 'Partial Issues';

  const dashboardText = [
    `📊 <b>GigRadar Live Dashboard</b>`,
    `${statusEmoji} <b>Status:</b> ${statusText}`,
    `⏱ <b>Last Check:</b> <code>${nowStr} IRST</code>`,
    `⚡️ <b>Interval:</b> Scheduled (Cloudflare Edge)`,
    ``,
    `📡 <b>Sources Health:</b>`,
    `• 💼 <b>LinkedIn:</b> <code>${liStatus}</code> (${liCount} gigs found)`,
    `• 🔶 <b>HackerNews:</b> <code>${hnStatus}</code> (${hnCount} gigs found)`,
    ``,
    `🎯 <b>New Leads (This Scan):</b> ${stats.newLeads}`,
    `📁 <b>Total Database Leads:</b> ${stats.totalSeen}`,
  ].join('\n');

  const msgId = await kv.get('status_message_id');
  let updated = false;

  if (msgId) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: parseInt(msgId, 10),
          text: dashboardText,
          parse_mode: 'HTML',
        }),
      });
      if (resp.ok) {
        return { success: true, messageId: parseInt(msgId, 10) };
      }
    } catch (e: any) {
      console.warn('[Dashboard] Edit error:', e);
    }
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: dashboardText,
        parse_mode: 'HTML',
      }),
    });
    const text = await resp.text();
    if (resp.ok) {
      const data: any = JSON.parse(text);
      const newId = data?.result?.message_id;
      if (newId) {
        await kv.put('status_message_id', String(newId));
        await fetch(`https://api.telegram.org/bot${botToken}/pinChatMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: newId,
            disable_notification: true,
          }),
        });
        return { success: true, messageId: newId };
      }
      return { success: true };
    } else {
      return { success: false, error: `${resp.status}: ${text}` };
    }
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}
