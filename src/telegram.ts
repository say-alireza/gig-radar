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
  message += `📍 <b>Location:</b> ${escapeHtml(lead.location)}\n`;
  message += `🏷 <b>Source:</b> ${lead.source} (Contract / Remote)\n`;

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

  // Button to trigger custom resume generation on demand
  inlineKeyboard.push([
    {
      text: '📝 ساخت رزومه اختصاصی (ATS 100)',
      callback_data: `tailor:${lead.id.slice(0, 50)}`,
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

export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
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
  caption: string
): Promise<boolean> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  const fileBlob = new Blob([docBytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  form.append('document', fileBlob, filename);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[Telegram] sendDocument failed: ${res.status} - ${err}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Telegram] sendDocument network error:`, err);
    return false;
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
