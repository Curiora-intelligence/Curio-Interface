from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from app.core.config import Settings

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).resolve().parents[2] / 'templates')


@router.get('/')
async def home(request: Request):
    return templates.TemplateResponse(request=request, name='index.html', context={'config': Settings().browser_config()})
