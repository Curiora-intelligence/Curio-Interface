"""Optional browser checks. Run only for development; never mounted by the app."""
from pathlib import Path
from fastapi import Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from app.main import app
from app.routers.pages import templates
from app.core.config import Settings

root = Path(__file__).resolve().parent
app.mount('/__tests', StaticFiles(directory=root), name='browser-tests')


@app.get('/browser-tests', response_class=HTMLResponse)
async def browser_tests(request: Request):
    html = templates.env.get_template('index.html').render(request=request, config=Settings().browser_config())
    html = html.replace('<script id="curio-config"', '<script src="/__tests/browser_setup.js"></script><script id="curio-config"')
    html = html.replace('</body>', '<script type="module" src="/__tests/browser_checks.js"></script></body>')
    return html
