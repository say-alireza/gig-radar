import os
import json
import time
from datetime import datetime, timezone, timedelta
import re
import html
import urllib.parse
from typing import List, Dict, Tuple, Optional
import requests
from bs4 import BeautifulSoup

SEEN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seen_leads.json")
STATUS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "status_state.json")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "96092687")
FORCE_SEND = os.environ.get("FORCE_SEND", "").lower() in ("true", "1")

# Use proxy only if explicitly configured in environment
PROXIES = {}
if os.environ.get("HTTP_PROXY") or os.environ.get("HTTPS_PROXY"):
    PROXIES = {
        "http": os.environ.get("HTTP_PROXY"),
        "https": os.environ.get("HTTPS_PROXY"),
    }

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def load_seen_leads() -> Dict[str, int]:
    if not os.path.exists(SEEN_FILE):
        return {}
    try:
        with open(SEEN_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            now = int(time.time())
            pruned = {k: v for k, v in data.items() if now - v < 30 * 86400}
            return pruned
    except Exception as e:
        print(f"[Warn] Failed to load {SEEN_FILE}: {e}")
        return {}


def save_seen_leads(seen: Dict[str, int]) -> None:
    try:
        with open(SEEN_FILE, "w", encoding="utf-8") as f:
            json.dump(seen, f, indent=2)
    except Exception as e:
        print(f"[Error] Failed to save {SEEN_FILE}: {e}")


def load_status_state() -> Dict:
    if not os.path.exists(STATUS_FILE):
        return {}
    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[Warn] Failed to load {STATUS_FILE}: {e}")
        return {}


def save_status_state(state: Dict) -> None:
    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[Error] Failed to save {STATUS_FILE}: {e}")


def generate_pitch(title: str, company: str, snippet: str) -> str:
    title_lower = title.lower()
    if any(k in title_lower for k in ["react", "next", "frontend", "front-end", "ui"]):
        return (
            "Hi, I specialize in building fast, modular React & Next.js web applications "
            "with clean TypeScript architecture. I am available immediately for contract/milestone deliverables."
        )
    elif any(k in title_lower for k in ["django", "python", "backend", "back-end", "api"]):
        return (
            "Hi, I build scalable Python/Django backends and RESTful APIs with solid DB design. "
            "Ready to take on this contract scope and deliver production-ready code."
        )
    else:
        return (
            "Hi, I am a full-stack engineer experienced in React/Next.js frontend and Python/Django backend. "
            "Available immediately for this contract scope to deliver high-quality, maintainable results."
        )


def fetch_linkedin_leads() -> Tuple[List[Dict], str]:
    keywords = ["React", "Next.js", "Django", "Full Stack"]
    leads = []
    status_summary = "200 OK"
    tech_pattern = re.compile(
        r"(developer|engineer|frontend|front-end|backend|back-end|fullstack|full-stack|software|react|django|python|web)",
        re.I,
    )

    for kw in keywords:
        url = (
            f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?"
            f"keywords={urllib.parse.quote(kw)}&f_WT=2&f_JT=C&f_TPR=r86400&sortBy=DD&start=0"
        )
        try:
            r = requests.get(url, headers=HEADERS, proxies=PROXIES or None, timeout=15)
            if r.status_code != 200:
                print(f"[LinkedIn] Status {r.status_code} for keyword '{kw}'")
                status_summary = f"{r.status_code} Err"
                time.sleep(2)
                continue

            soup = BeautifulSoup(r.text, "html.parser")
            cards = soup.find_all("div", class_="base-search-card")

            for card in cards:
                title_elem = card.find("h3", class_="base-search-card__title")
                company_elem = card.find("h4", class_="base-search-card__subtitle")
                location_elem = card.find("span", class_="job-search-card__location")
                link_elem = card.find("a", class_="base-card__full-link")
                time_elem = card.find("time")
                urn = card.get("data-entity-urn", "")
                job_id_match = re.search(r"jobPosting:(\d+)", urn)
                job_id = job_id_match.group(1) if job_id_match else None

                title = title_elem.get_text(strip=True) if title_elem else "Developer"
                company = company_elem.get_text(strip=True) if company_elem else "Company"
                location = location_elem.get_text(strip=True) if location_elem else "Remote"
                link = (
                    link_elem["href"].split("?")[0]
                    if link_elem and "href" in link_elem.attrs
                    else f"https://www.linkedin.com/jobs/view/{job_id}"
                )

                posted = "Recent"
                if time_elem:
                    rel_time = time_elem.get_text(strip=True)
                    dt_attr = time_elem.get("datetime")
                    if rel_time and dt_attr:
                        posted = f"{rel_time} ({dt_attr})"
                    elif rel_time:
                        posted = rel_time
                    elif dt_attr:
                        posted = dt_attr

                if not job_id:
                    id_match = re.search(r"-(\d+)$", link)
                    job_id = id_match.group(1) if id_match else str(hash(link))

                if not tech_pattern.search(title):
                    continue

                if re.search(r"full[- ]?time\s+only", title, re.I):
                    continue

                leads.append({
                    "id": f"linkedin:{job_id}",
                    "source": "LinkedIn",
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": link,
                    "posted": posted,
                    "snippet": f"{title} at {company} (Remote Contract Gig)",
                })
        except Exception as e:
            print(f"[LinkedIn] Error scraping '{kw}': {e}")
            status_summary = "Req Failed"

        time.sleep(2.5)

    return leads, status_summary


def fetch_reddit_leads() -> Tuple[List[Dict], str]:
    url = "https://www.reddit.com/r/forhire/new.rss"
    leads = []
    status_summary = "200 OK"
    try:
        r = requests.get(url, headers=HEADERS, proxies=PROXIES or None, timeout=12)
        if r.status_code != 200:
            print(f"[Reddit] Status {r.status_code}")
            return [], f"{r.status_code} Err"

        try:
            soup = BeautifulSoup(r.text, "xml")
        except Exception:
            soup = BeautifulSoup(r.text, "html.parser")
        entries = soup.find_all("entry")

        tech_kw = re.compile(r"(react|next\.?js|django|python|fullstack|full-stack|frontend|front-end|web developer)", re.I)

        for entry in entries:
            title_elem = entry.find("title")
            link_elem = entry.find("link")
            id_elem = entry.find("id")

            title = title_elem.get_text(strip=True) if title_elem else ""
            if not re.search(r"\[hiring\]", title, re.I):
                continue

            if not tech_kw.search(title):
                continue

            link = link_elem.get("href", "") if link_elem else ""
            lead_id = id_elem.get_text(strip=True) if id_elem else link

            leads.append({
                "id": f"reddit:{lead_id}",
                "source": "Reddit",
                "title": title,
                "company": "r/forhire client",
                "location": "Remote",
                "url": link,
                "posted": "Recent",
                "snippet": title,
            })
    except Exception as e:
        print(f"[Reddit] Error: {e}")
        status_summary = "Req Failed"

    return leads, status_summary


def fetch_hn_leads() -> Tuple[List[Dict], str]:
    query = "(react OR next.js OR django OR python) (contract OR freelance)"
    url = f"https://hn.algolia.com/api/v1/search_by_date?tags=comment&query={urllib.parse.quote(query)}&hitsPerPage=10"
    leads = []
    status_summary = "200 OK"
    try:
        r = requests.get(url, headers=HEADERS, proxies=PROXIES or None, timeout=10)
        if r.status_code != 200:
            return [], f"{r.status_code} Err"

        data = r.json()
        hits = data.get("hits", [])
        for h in hits:
            text = h.get("comment_text", "")
            plain = re.sub(r"<[^>]+>", " ", text)
            plain = html.unescape(plain).strip()

            if re.search(r"seeking\s+work", plain, re.I):
                continue

            email_match = re.search(r"[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}", plain)
            direct_contact = email_match.group(0).strip().rstrip(".)]:;'\"") if email_match else None

            first_line = plain.split("\n")[0][:100] if plain else "HN Freelance Lead"

            leads.append({
                "id": f"hn:{h.get('objectID')}",
                "source": "HackerNews",
                "title": first_line,
                "company": h.get("author", "HN Founder"),
                "location": "Remote",
                "url": f"https://news.ycombinator.com/item?id={h.get('objectID')}",
                "posted": "Recent",
                "snippet": plain[:250],
                "directContact": direct_contact,
            })
    except Exception as e:
        print(f"[HN] Error: {e}")
        status_summary = "Req Failed"

    return leads, status_summary


def send_to_telegram(lead: Dict) -> bool:
    if not TELEGRAM_BOT_TOKEN:
        print(f"[Dry-run] Lead: {lead['title']} ({lead['url']})")
        return True

    source_icons = {
        "LinkedIn": "💼",
        "Reddit": "🔴",
        "HackerNews": "🔶",
    }
    icon = source_icons.get(lead["source"], "🌐")

    pitch = generate_pitch(lead["title"], lead["company"], lead.get("snippet", ""))

    msg = f"{icon} <b>New Lead: {html.escape(lead['title'])}</b>\n\n"
    msg += f"🏢 <b>Company:</b> {html.escape(lead['company'])}\n"
    msg += f"📍 <b>Location:</b> {html.escape(lead['location'])}\n"
    msg += f"⏱ <b>Published:</b> <code>{html.escape(lead.get('posted', 'Recent'))}</code>\n"
    msg += f"🏷 <b>Source:</b> {lead['source']} (Remote Contract)\n"

    if lead.get("directContact"):
        msg += f"✉️ <b>Direct Email:</b> <code>{html.escape(lead['directContact'])}</code>\n"

    msg += f"\n💡 <b>Draft Proposal Pitch:</b>\n"
    msg += f"<blockquote>{html.escape(pitch)}</blockquote>"

    inline_keyboard = [
        [{"text": f"🚀 Open on {lead['source']}", "url": lead["url"]}]
    ]
    if lead.get("directContact"):
        inline_keyboard.append([
            {
                "text": "📧 Send Direct Email",
                "url": f"mailto:{lead['directContact']}?subject={urllib.parse.quote('Quick Question - ' + lead['title'])}",
            }
        ])

    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": msg,
        "parse_mode": "HTML",
        "reply_markup": {"inline_keyboard": inline_keyboard},
    }

    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json=payload,
            proxies=PROXIES or None,
            timeout=15,
        )
        if resp.status_code == 200:
            return True
        else:
            print(f"[Telegram] Failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print(f"[Telegram] Error: {e}")
        return False


def update_dashboard(
    linkedin_status: str,
    linkedin_count: int,
    reddit_status: str,
    reddit_count: int,
    hn_status: str,
    hn_count: int,
    new_leads_count: int,
    total_seen: int,
):
    if not TELEGRAM_BOT_TOKEN:
        return

    # Tehran timezone: UTC+3:30
    tz_tehran = timezone(timedelta(hours=3, minutes=30))
    now_str = datetime.now(tz_tehran).strftime("%H:%M:%S (%d %b)")

    all_healthy = (
        "200" in linkedin_status and "200" in reddit_status and "200" in hn_status
    )
    status_emoji = "🟢" if all_healthy else "🟡"
    status_text = "All Systems Active" if all_healthy else "Partial Issues"

    dashboard_text = (
        f"📊 <b>GigRadar Live Dashboard</b>\n"
        f"{status_emoji} <b>Status:</b> {status_text}\n"
        f"⏱ <b>Last Check:</b> <code>{now_str} IRST</code>\n"
        f"⚡️ <b>Interval:</b> Every 5 minutes (GitHub Actions)\n\n"
        f"📡 <b>Sources Health:</b>\n"
        f"• 💼 <b>LinkedIn:</b> <code>{linkedin_status}</code> ({linkedin_count} gigs found)\n"
        f"• 🔴 <b>Reddit:</b> <code>{reddit_status}</code> ({reddit_count} gigs found)\n"
        f"• 🔶 <b>HackerNews:</b> <code>{hn_status}</code> ({hn_count} gigs found)\n\n"
        f"🎯 <b>New Leads (This Scan):</b> {new_leads_count}\n"
        f"📁 <b>Total Database Leads:</b> {total_seen}"
    )

    state = load_status_state()
    msg_id = state.get("status_message_id")

    updated = False
    if msg_id:
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "message_id": msg_id,
                    "text": dashboard_text,
                    "parse_mode": "HTML",
                },
                proxies=PROXIES or None,
                timeout=10,
            )
            if resp.status_code == 200:
                updated = True
            else:
                print(f"[Dashboard] Edit failed: {resp.status_code} - {resp.text}")
        except Exception as e:
            print(f"[Dashboard] Edit error: {e}")

    if not updated:
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": dashboard_text,
                    "parse_mode": "HTML",
                },
                proxies=PROXIES or None,
                timeout=10,
            )
            if resp.status_code == 200:
                new_id = resp.json().get("result", {}).get("message_id")
                state["status_message_id"] = new_id
                save_status_state(state)

                # Pin the status message silently
                try:
                    requests.post(
                        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/pinChatMessage",
                        json={
                            "chat_id": TELEGRAM_CHAT_ID,
                            "message_id": new_id,
                            "disable_notification": True,
                        },
                        proxies=PROXIES or None,
                        timeout=10,
                    )
                except Exception:
                    pass
        except Exception as e:
            print(f"[Dashboard] Send error: {e}")


def main():
    print("=== GigRadar Lead Scanner Starting ===")
    seen = load_seen_leads()
    print(f"Loaded {len(seen)} previously seen leads.")

    all_leads = []

    # 1. Scrape LinkedIn (Primary)
    print("Scraping LinkedIn...")
    linkedin_leads, linkedin_status = fetch_linkedin_leads()
    print(f"Found {len(linkedin_leads)} matching LinkedIn contract leads. Status: {linkedin_status}")
    all_leads.extend(linkedin_leads)

    # 2. Scrape Reddit (Instant gigs)
    print("Scraping Reddit r/forhire...")
    reddit_leads, reddit_status = fetch_reddit_leads()
    print(f"Found {len(reddit_leads)} Reddit leads. Status: {reddit_status}")
    all_leads.extend(reddit_leads)

    # 3. Scrape Hacker News
    print("Scraping Hacker News...")
    hn_leads, hn_status = fetch_hn_leads()
    print(f"Found {len(hn_leads)} HN leads. Status: {hn_status}")
    all_leads.extend(hn_leads)

    new_count = 0
    for lead in all_leads:
        lead_id = lead["id"]
        if lead_id in seen and not FORCE_SEND:
            continue

        print(f"-> Sending new lead: [{lead['source']}] {lead['title']}")
        success = send_to_telegram(lead)
        if success:
            seen[lead_id] = int(time.time())
            new_count += 1
            time.sleep(1)

    save_seen_leads(seen)
    print(f"=== Scan Finished. {new_count} new leads notified. Total seen: {len(seen)} ===")

    # Update Live Telegram Dashboard
    update_dashboard(
        linkedin_status=linkedin_status,
        linkedin_count=len(linkedin_leads),
        reddit_status=reddit_status,
        reddit_count=len(reddit_leads),
        hn_status=hn_status,
        hn_count=len(hn_leads),
        new_leads_count=new_count,
        total_seen=len(seen),
    )


if __name__ == "__main__":
    main()
