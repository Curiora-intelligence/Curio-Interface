# Curio Interface

A separate first-party client for the [Curio backend](https://github.com/Curiora-intelligence/Curio). FastAPI serves Jinja2, CSS, and native browser JavaScript modules. No Node installation or build step is needed. This repository does not import Curio backend code, connect to databases, run tools, or load models.

## Run locally

Use Python 3.11 or newer:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. `main:app` remains a compatibility entry point.

Start Curio independently, following its README and database migrations. Its cached-model launcher is `python -m scripts.serve --port 8001`. Redis enables replayable progress; PostgreSQL remains required for conversations, memories, run status, and final answers. Use a single backend worker with local MLX models.

Configuration:

```dotenv
CURIO_API_BASE=http://127.0.0.1:8001
CURIO_WS_BASE=ws://127.0.0.1:8001
```

These settings are validated and serialized into a JSON script element with Jinja's `tojson`. All modules share `config.js`. For another interface origin, set the backend's `CURIO_FRONTEND_ORIGINS` accordingly. The backend defaults allow localhost/127.0.0.1 on port 8000. Use HTTPS/WSS together when serving beyond localhost.

## Behavior

- `localStorage.curio_user_id` defaults to `demo-sai`. Chat, memory, and Live use that same identity. Discovery is stateless and receives the common identity header; its existing strict JSON body has no user field. This is a local demo identity, not authentication.
- New Chat clears conversation ID and messages, preserving identity and server memory. Up to 30 conversations are kept as browser-local history; there is no backend history endpoint. Saved replies stay readable after refresh through History.
- Chat and image attachments use multipart `POST /curio/runs`, then SSE. One assistant message updates as confirmed stages arrive. Native EventSource reconnects; polling recovers the accepted request without posting it again. A pending accepted run can resume after page reload. An explicit retry after an ambiguous POST reuses the original idempotency key.
- Personal/Research/Career map to `general`; Food to `discovery`; Shopping to `shopping`. Mock Interview opens `/interview`, using the existing Live WebSocket in `interview` mode.
- Memories are fetched on panel open, refresh, completed replies, and New Chat. Cards display categories and values without internal IDs. This interface deliberately omits memory deletion.
- Discover displays the backend's fictional ranked providers and reasons. It can prefill actual saved preferences; it performs no ranking. Location is optional and requested explicitly through Settings. Location is kept in tab memory, not localStorage.
- The activity inspector lists only backend-confirmed stage and tool events. It never displays tool arguments/results or model analysis. Final answers support a small safe Markdown subset; raw HTML remains text.

## Curio Live

Open Curio Live, select a mode, then enable the camera. The client waits for the backend's `ready` and `configured` events. Preview is local; JPEG samples use the server interval (at least five seconds), at most 1280 pixels per side and 512 KB, quality 0.6. The client sends raw base64 with a Unix timestamp. It drops stale work, pauses during inference, and backs off on busy/frame_skipped. Mode changes preserve cooldown. Closing Live stops camera/microphone tracks; an already submitted question can finish in the main conversation.

Voice typing uses browser SpeechRecognition and fills the composer; only Send submits. Support and recognition service behavior depend on the browser. The application itself uploads no raw audio to Curio. Mock Interview's explicit communication sample uses Web Audio to produce duration, speaking time, pauses and at most 600 RMS values. Displays cover pace, ratio, pauses, volume variation, and backend-observed gaze/posture; no psychological classifications.

Camera, microphone, and location can be declined. Text questions remain available. Camera/microphone APIs require localhost or a secure context. Browser permission changes are controlled by the user.

## Checks

```sh
python -m pip install -r requirements-test.txt
python -m compileall -q app main.py
python -m pytest -q
```

For repeatable browser checks without a physical camera, run the development-only fixture server:

```sh
uvicorn tests.serve_browser:app --host 127.0.0.1 --port 8002
```

Open http://127.0.0.1:8002/browser-tests. It exercises the real frontend modules with synthetic media and controlled fetch/EventSource/WebSocket fixtures, reporting results on the page. These fixtures are never mounted by the production app. See [validation and limitations](docs/validation.md) and [demo script](docs/demo.md).

The focused five-question interview checks are at http://127.0.0.1:8002/browser-interview-tests. Voice replies use browser SpeechSynthesis, default on for interviews and off for chat; an explicit choice persists. Start answering cancels playback. Finish Answer submits the accumulated transcript and available timing measurements once. Physical device permissions and dictation support still depend on the browser.

## First evaluation script

Before presenting, set `CURIO_BROWSER_BACKEND=exa` and an actual `EXA_API_KEY` in the **backend** `.env`, run `python -m scripts.check_web` there, and restart the backend. Without a working key, only the clearly labeled fictional catalogue is available. Use a browser with camera, microphone, dictation and speech playback enabled.

1. **Persistent intelligence:** say “I prefer spicy chicken biryani and usually stay under ₹300.” Click **New Chat**, then say “I'm hungry.” Next: “Search the web for real nearby spicy chicken biryani options in Hyderabad. Prefer Zomato sources if available.” Show **How Curio handled this**, actual web tool names, and clickable source buttons. Unknown prices or availability must remain unknown.
2. **Live vision:** open **Curio Live**, select **Service Discovery**, enable the camera and show a leaking tap or broken object. Ask “What service do I need for this?” Then “Find me someone who can help.” Show the sampled observation and response; supply a locality for nearby results.
3. **Mock interview:** first tell chat “I struggle with database indexing.” Open **Mock Interview**, click **Start interview**, allow camera/microphone, and hear the first question. Click **Start answering**, answer verbally, then **Finish Answer**. Show technical feedback, available observable metrics, and the next spoken question. The session ends after five answers.
4. **Shopping, if time remains:** tell chat “I prefer minimal black products and usually stay under ₹2500.” Open Live in Shopping mode, show a product, and ask “Would I like this?” Price fit requires price evidence.
