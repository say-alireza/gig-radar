import requests
import json
import re

proxies = {
    "http": "socks5://127.0.0.1:10808",
    "https": "socks5://127.0.0.1:10808"
}

def test_hn_freelance():
    print("\n--- Testing Hacker News 'Freelancer? Seeking freelancer?' ---")
    # Get whoishiring user's latest submissions
    r = requests.get("https://hacker-news.firebaseio.com/v0/user/whoishiring.json", proxies=proxies, timeout=10)
    submissions = r.json().get("submitted", [])[:5]
    
    freelance_thread_id = None
    for sub_id in submissions:
        item = requests.get(f"https://hacker-news.firebaseio.com/v0/item/{sub_id}.json", proxies=proxies, timeout=10).json()
        title = item.get("title", "")
        if "Seeking freelancer" in title or "freelance" in title.lower():
            freelance_thread_id = sub_id
            print(f"Found active thread: {title} (ID: {sub_id})")
            kids = item.get("kids", [])
            print(f"Total comments/posts in thread: {len(kids)}")
            
            # inspect first 10 comments
            matched = 0
            for kid_id in kids[:15]:
                comment = requests.get(f"https://hacker-news.firebaseio.com/v0/item/{kid_id}.json", proxies=proxies, timeout=10).json()
                text = comment.get("text", "")
                # check if seeking freelancer and mentions dev tech
                if "SEEKING FREELANCER" in text.upper():
                    # extract email if present
                    emails = re.findall(r'[\w\.-]+@[\w\.-]+\.\w+', text)
                    print(f"\n[HN Lead] ID: {kid_id}")
                    print(f"Snippet: {text[:250]}...")
                    print(f"Direct Emails detected: {emails}")
                    matched += 1
            print(f"Matched {matched} SEEKING FREELANCER posts from sample.")
            break

def test_remoteok():
    print("\n--- Testing RemoteOK Contract/Freelance API ---")
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get("https://remoteok.com/api?tag=react", headers=headers, proxies=proxies, timeout=10)
    if r.status_code == 200:
        data = r.json()
        jobs = [j for j in data if isinstance(j, dict) and "position" in j]
        print(f"Found {len(jobs)} React jobs on RemoteOK.")
        for j in jobs[:3]:
            print(f"\n[RemoteOK] {j.get('position')} @ {j.get('company')}")
            print(f"Apply URL: {j.get('url')}")
            print(f"Tags: {j.get('tags')}")
    else:
        print(f"RemoteOK status code: {r.status_code}")

if __name__ == "__main__":
    test_hn_freelance()
    test_remoteok()
