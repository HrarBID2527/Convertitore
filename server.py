import http.server
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
YT_DLP = shutil.which("yt-dlp") or os.path.expanduser("~/Library/Python/3.9/bin/yt-dlp")

YOUTUBE_RE = re.compile(
    r"^https?://(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/)|youtu\.be/)[\w-]{6,}"
)
MAX_DURATION_SECONDS = 20 * 60


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/api/yt-audio":
            self._handle_yt_audio()
        else:
            self.send_error(404)

    def _handle_yt_audio(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._send_json(400, {"error": "Richiesta non valida."})

        url = (data.get("url") or "").strip()
        if not url or not YOUTUBE_RE.match(url):
            return self._send_json(
                400, {"error": "Inserisci un link YouTube valido (youtube.com o youtu.be)."}
            )

        with tempfile.TemporaryDirectory() as tmp:
            out_template = os.path.join(tmp, "audio.%(ext)s")
            try:
                proc = subprocess.run(
                    [
                        YT_DLP,
                        "-f", "18/bestaudio/best",
                        "--no-playlist",
                        "--no-warnings",
                        "--no-simulate",
                        "--match-filter", f"duration < {MAX_DURATION_SECONDS}",
                        "--extractor-args", "youtube:player_client=android",
                        "--print", "TITLE::%(title)s",
                        "-o", out_template,
                        url,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=240,
                )
            except subprocess.TimeoutExpired:
                return self._send_json(
                    504, {"error": "Timeout: il video è troppo lungo o la connessione è lenta."}
                )
            except FileNotFoundError:
                return self._send_json(
                    500, {"error": "yt-dlp non è installato sul server."}
                )

            if proc.returncode != 0:
                stderr_lines = [l for l in proc.stderr.strip().splitlines() if l.strip()]
                last = stderr_lines[-1] if stderr_lines else "errore sconosciuto"
                if "does not pass filter" in last:
                    msg = f"Video troppo lungo (limite {MAX_DURATION_SECONDS // 60} minuti)."
                else:
                    msg = "Impossibile scaricare l'audio da questo link."
                return self._send_json(422, {"error": msg})

            title = "audio"
            for line in proc.stdout.splitlines():
                if line.startswith("TITLE::"):
                    title = line[len("TITLE::"):].strip() or "audio"

            downloaded = [f for f in os.listdir(tmp) if f.startswith("audio.")]
            if not downloaded:
                return self._send_json(500, {"error": "File audio non trovato dopo il download."})

            filepath = os.path.join(tmp, downloaded[0])
            ext = downloaded[0].rsplit(".", 1)[-1]
            size = os.path.getsize(filepath)

            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.send_header("X-Video-Title", urllib.parse.quote(title))
            self.send_header("X-Audio-Ext", ext)
            self.end_headers()
            with open(filepath, "rb") as f:
                shutil.copyfileobj(f, self.wfile)


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", 8420), Handler) as httpd:
        print("Serving on http://127.0.0.1:8420")
        httpd.serve_forever()
