#!/usr/bin/env python3
"""Watch a local Movies folder and securely register new videos in CineVerse."""
import hashlib, json, os, time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

FOLDER = Path(os.environ.get("CINEVERSE_MOVIES_DIR", str(Path.home() / "CloudFiles" / "Movies"))).expanduser()
API_URL = os.environ.get("CINEVERSE_IMPORT_API", "https://chineverse.pages.dev/api/server-import")
SECRET = os.environ.get("CINEVERSE_IMPORT_SECRET", "")
EXTS = {".mp4", ".mkv", ".webm", ".mov", ".m4v"}
SEEN_FILE = Path.home() / ".cineverse-imported.json"
POLL_SECONDS = 8

def load_seen():
    try: return json.loads(SEEN_FILE.read_text())
    except Exception: return {}

def save_seen(seen):
    tmp = SEEN_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(seen, indent=2))
    tmp.replace(SEEN_FILE)

def send(path, seen):
    rel = path.relative_to(FOLDER).as_posix()
    stat = path.stat()
    source_key = hashlib.sha256(f"{rel}|{stat.st_size}|{stat.st_mtime_ns}".encode()).hexdigest()
    if source_key in seen: return
    payload = json.dumps({"filename": path.name, "relative_path": rel, "source_key": source_key}).encode()
    req = Request(API_URL, data=payload, headers={"Authorization": "Bearer " + SECRET, "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=60) as response:
            result = json.loads(response.read().decode())
            print("CineVerse:", result, flush=True)
            seen[source_key] = {"path": rel, "status": "imported"}
            save_seen(seen)
    except HTTPError as e:
        detail = e.read().decode(errors="replace")
        print(f"Import failed ({e.code}) for {rel}: {detail}", flush=True)
    except (URLError, TimeoutError, OSError) as e:
        print(f"Connection error for {rel}: {e}", flush=True)

def main():
    if not SECRET:
        raise SystemExit("Set CINEVERSE_IMPORT_SECRET first.")
    if not FOLDER.is_dir():
        raise SystemExit(f"Movies folder not found: {FOLDER}")
    seen = load_seen()
    print(f"Watching {FOLDER} for new video files. Ctrl+C to stop.", flush=True)
    while True:
        for path in FOLDER.rglob("*"):
            try:
                if path.is_file() and path.suffix.lower() in EXTS:
                    # Wait until file size is stable before importing a file still being copied.
                    size1 = path.stat().st_size
                    time.sleep(0.2)
                    size2 = path.stat().st_size
                    if size1 == size2 and size2 > 0:
                        send(path, seen)
            except (FileNotFoundError, PermissionError):
                pass
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()
