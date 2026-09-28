# 미리보기용 한 파일짜리 HTML 만들기: python3 preview/build.py <출력 경로>
# public/ 의 화면 + preview/demo-api.js(가짜 서버)를 한 파일로 합친다.
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
pub = root / 'public'
html = (pub / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (pub / 'style.css').read_text() + '\n</style>')
scripts = ''.join('<script>\n' + p.read_text() + '\n</script>\n' for p in [root / 'preview' / 'demo-api.js', pub / 'rules.js', pub / 'app.js'])
html = html.replace('<script src="rules.js"></script>\n<script src="app.js"></script>\n', scripts)
html = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>\s*', '', html)
html = re.sub(r'<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*', '', html)
html = html.replace('</head>\n', '').replace('</body>\n</html>', '')
Path(sys.argv[1]).write_text(html)
