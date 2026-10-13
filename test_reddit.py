import requests
import json

proxies = {
    "http": "socks5://127.0.0.1:10808",
    "https": "socks5://127.0.0.1:10808"
}
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
}

def test_reddit():
    url = "https://www.reddit.com/r/forhire/search.json?q=flair_name%3A%22Hiring%22%20react&restrict_sr=1&sort=new"
    print("Testing Reddit r/forhire JSON endpoint...")
    r = requests.get(url, headers=headers, proxies=proxies, timeout=10)
    print("Status:", r.status_code)
    if r.status_code == 200:
        children = r.json().get("data", {}).get("children", [])
        print(f"Total hiring posts found: {len(children)}")
        for c in children[:3]:
            p = c["data"]
            print(f"- {p.get('title')}")
            print(f"  https://reddit.com{p.get('permalink')}")
    else:
        print("Blocked/Error response:", r.text[:200])

if __name__ == "__main__":
    test_reddit()
