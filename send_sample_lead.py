import os
import requests
import json

token = os.environ.get('TELEGRAM_BOT_TOKEN')
chat_id = os.environ.get('TELEGRAM_CHAT_ID', '96092687')

lead = {
    'title': 'UI Developer (Contract / Remote)',
    'company': 'Jump Trading',
    'location': 'Remote (US)',
    'url': 'https://www.linkedin.com/jobs/view/ui-developer-at-jump-trading-4440262112',
    'snippet': 'Contract remote role building high-performance web dashboards with React and TypeScript.'
}

pitch = 'I build low-latency, modular React frontends for data-intensive dashboards. Available immediately for this contract scope to deliver production-ready components.'

msg = f"💼 <b>New LinkedIn Contract: {lead['title']}</b>\n\n"
msg += f"🏢 <b>Company:</b> {lead['company']}\n"
msg += f"📍 <b>Location:</b> {lead['location']}\n"
msg += f"🏷 <b>Source:</b> LinkedIn (Contract / Remote)\n\n"
msg += f"💡 <b>Draft Proposal Pitch:</b>\n"
msg += f"<blockquote>{pitch}</blockquote>"

payload = {
    'chat_id': chat_id,
    'text': msg,
    'parse_mode': 'HTML',
    'reply_markup': {
        'inline_keyboard': [
            [{'text': '🚀 Open on LinkedIn', 'url': lead['url']}]
        ]
    }
}

if token:
    proxies = {'http': 'socks5://127.0.0.1:10808', 'https': 'socks5://127.0.0.1:10808'}
    try:
        r = requests.post(f'https://api.telegram.org/bot{token}/sendMessage', json=payload, proxies=proxies, timeout=10)
        print(r.json())
    except Exception as e:
        print("Error sending:", e)
else:
    print("TELEGRAM_BOT_TOKEN not set in environment.")
