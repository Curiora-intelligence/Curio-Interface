import re
from fastapi.testclient import TestClient
from app.main import app


def test_page_and_all_static_assets():
    with TestClient(app) as client:
        page = client.get('/')
        assert page.status_code == 200
        assert 'A little more' in page.text
        assert 'demo-sai' in page.text
        assets = re.findall(r'(?:href|src)="(http://testserver/static/[^"]+)"', page.text)
        assert len(assets) == 9
        for asset in assets:
            result = client.get(asset)
            assert result.status_code == 200, asset


def test_config_is_serialized_as_data(monkeypatch):
    monkeypatch.setenv('CURIO_API_BASE', 'http://localhost:8001/</script><script>alert(1)</script>')
    with TestClient(app) as client:
        page = client.get('/').text
        assert '<script>alert(1)</script>' not in page
        assert r'\u003c/script\u003e' in page


def test_no_backend_import_or_node_build_required():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    assert not (root / 'package.json').exists()
    assert not (root / 'src').exists()
    assert not (root / 'node_modules').exists()


def test_dedicated_interview_page_uses_same_config():
    with TestClient(app) as client:
        page = client.get('/interview')
        assert page.status_code == 200
        assert 'Question 1 of 5' in page.text and 'Finish Answer' in page.text
        assert 'js/interview.js' in page.text and 'js/app.js' not in page.text
        assert 'curio-config' in page.text
