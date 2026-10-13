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
  if (lead.url) {
    inlineKeyboard.push([
      {
        text: `🚀 Open on ${lead.source}`,
        url: lead.url,
      },
    ]);
  }

  if (lead.directContact) {
    inlineKeyboard.push([
      {
        text: '📧 Send Email',
        url: `mailto:${lead.directContact}?subject=${encodeURIComponent('Quick Question - ' + lead.title)}`,
      },
    ]);
  }

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
