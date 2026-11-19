"""Download the prototype's product photographs into the web public directory."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

IMAGES = {
    "headphones": "photo-1505740420928-5e560c06d30e",
    "backpack": "photo-1544816155-12df9643f363",
    "sneakers": "photo-1542291026-7eec264c27ff",
    "bottle": "photo-1602143407151-7111542de6e8",
    "watch": "photo-1523275335684-37898b6baf30",
    "sunglasses": "photo-1511499767150-a48a237f0083",
    "mug": "photo-1514228742587-6b1558fcca3d",
    "weekender": "photo-1553062407-98eeb64c6a62",
}
destination = Path(__file__).resolve().parents[1] / "apps" / "web" / "public" / "images"
destination.mkdir(parents=True, exist_ok=True)

def download(item):
    name, identifier = item
    url = f"https://images.unsplash.com/{identifier}?auto=format&fit=crop&w=320&h=320&q=85&fm=jpg"
    request = Request(url, headers={"User-Agent": "Docklane-Prototype/1.0"})
    with urlopen(request, timeout=60) as response:
        content = response.read()
    if not content.startswith(b"\xff\xd8"):
        raise ValueError(f"{name}: expected a JPEG photograph")
    (destination / f"{name}.jpg").write_bytes(content)
    print(f"{name}: {len(content)} bytes", flush=True)

with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(download, IMAGES.items()))
