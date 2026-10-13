import csv
import json
from jobspy import scrape_jobs

def test_fetch():
    print("Testing with search_term='React freelance remote' on LinkedIn & Indeed...")
    proxies = ["socks5://127.0.0.1:10808"]
    
    jobs = scrape_jobs(
        site_name=["linkedin", "indeed"],
        search_term="React freelance remote",
        location="United States",
        results_wanted=5,
        hours_old=72,
        country_indeed='USA',
        fetch_description=True,
        proxies=proxies
    )
    
    print(f"\n--- Total found: {len(jobs)} jobs ---")
    if not jobs.empty:
        for idx, row in jobs.iterrows():
            title = row.get("title")
            company = row.get("company")
            site = row.get("site")
            job_url = row.get("job_url")
            emails = row.get("emails")
            desc = str(row.get("description", ""))[:200].replace("\n", " ")
            
            print(f"\n[{site.upper()}] {title} @ {company}")
            print(f"Emails found: {emails}")
            print(f"Preview: {desc}...")
            print(f"URL: {job_url}")
    else:
        print("No jobs found matching criteria.")

if __name__ == "__main__":
    test_fetch()
