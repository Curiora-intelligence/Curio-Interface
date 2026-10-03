"""Browser connection settings; this server contains no intelligence backend."""
from dataclasses import dataclass, field
import os
from urllib.parse import urlsplit
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    api_base: str = field(default_factory=lambda: os.getenv('CURIO_API_BASE', 'http://127.0.0.1:8001').rstrip('/'))
    ws_base: str = field(default_factory=lambda: os.getenv('CURIO_WS_BASE', 'ws://127.0.0.1:8001').rstrip('/'))

    def browser_config(self):
        for value, schemes in ((self.api_base, ('http', 'https')), (self.ws_base, ('ws', 'wss'))):
            parsed = urlsplit(value)
            if parsed.scheme not in schemes or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError('Configure an absolute HTTP/WS base URL without credentials, query or fragment.')
        return {'apiBase': self.api_base, 'wsBase': self.ws_base}
