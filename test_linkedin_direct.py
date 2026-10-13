import requests
from bs4 import BeautifulSoup
import urllib.parse

proxies = {
    "http": "socks5://127.0.0.1:10808",
    "https": "socks5://127.0.0.1:10808"
}
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
}

def search_linkedin_contract(keywords="React"):
    print(f"\n==========================================")
    print(f"Searching LinkedIn for: {keywords} (Remote Contract)")
    print(f"==========================================")
    
    # f_WT=2 is Remote, f_JT=C is Contract
    url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={urllib.parse.quote(keywords)}&f_WT=2&f_JT=C&start=0"
    
    r = requests.get(url, headers=headers, proxies=proxies, timeout=15)
    if r.status_code != 200:
        print(f"Failed with status: {r.status_code}")
        return
        
    soup = BeautifulSoup(r.text, "html.parser")
    cards = soup.find_all("div", class_="base-search-card")
    print(f"Found {len(cards)} matching contract/freelance jobs:")
    
    for idx, card in enumerate(cards[:6], 1):
        title_elem = card.find("h3", class_="base-search-card__title")
        company_elem = card.find("h4", class_="base-search-card__subtitle")
        location_elem = card.find("span", class_="job-search-card__location")
        link_elem = card.find("a", class_="base-card__full-link")
        time_elem = card.find("time")
        
        title = title_elem.get_text(strip=True) if title_elem else "N/A"
        company = company_elem.get_text(strip=True) if company_elem else "N/A"
        location = location_elem.get_text(strip=True) if location_elem else "N/A"
        link = link_elem["href"].split("?")[0] if link_elem and "href" in link_elem.attrs else "N/A"
        posted = time_elem.get_text(strip=True) if time_elem else "Recent"
        
        print(f"\n{idx}. {title} @ {company}")
        print(f"   📍 Location: {location} | ⏱ Posted: {posted}")
        print(f"   🔗 Direct Link: {link}")

if __name__ == "__main__":
    search_linkedin_contract("React")
    search_linkedin_contract("Next.js")
    search_linkedin_contract("Django")
