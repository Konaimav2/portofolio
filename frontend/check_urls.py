import urllib.request
from bs4 import BeautifulSoup
import json

urls = [
    "https://anggajuliawan.com/",
    "https://rajaaditya.my.id/",
    "https://vanes430.my.id/",
    "https://portofoliov2fahri.vercel.app/",
    "https://portofolio-greezeid-n42d.vercel.app"
]

results = {}

for url in urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read()
            soup = BeautifulSoup(html, 'html.parser')
            
            # Look for common AI/Template identifiers
            title = soup.title.string if soup.title else 'No Title'
            scripts = [s.get('src') for s in soup.find_all('script') if s.get('src')]
            classes = set()
            for el in soup.find_all(class_=True):
                classes.update(el['class'])
            
            # Check for Tailwind or specific frameworks
            has_tailwind = any('tailwind' in s for s in scripts) or any('tw-' in c for c in classes) or 'flex' in classes and 'w-full' in classes
            has_framer = any('framer' in s for s in scripts)
            
            # Check body text for generic phrases
            text = soup.get_text()
            
            results[url] = {
                'title': title.strip() if title else '',
                'classes_sample': list(classes)[:20],
                'has_tailwind': has_tailwind,
                'has_framer': has_framer,
                'links_count': len(soup.find_all('a'))
            }
    except Exception as e:
        results[url] = str(e)

print(json.dumps(results, indent=2))
