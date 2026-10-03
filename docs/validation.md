# Validation — 3 October 2026

## Final results

| Check | Result |
|---|---|
| Backend full regression suite | **72 passed in 2.11s**: all original 57 plus 15 new SSE/grounding checks |
| Interface Python compilation | Passed, exit 0 |
| Interface Python tests | **3 passed in 0.21s** |
| Browser fixture suite | **39 checks passed**, no error-level browser console entries |
| Independent interface launch | Uvicorn started on `127.0.0.1:8000`; GET `/` and CSS/JS returned 200 |
| Desktop and narrow layouts | Visually inspected at 1280×900 and the in-app browser's narrow default viewport |
| Repository whitespace checks | `git diff --check` passed in both repositories |
| React/TypeScript/build tool removal | Original scaffold, manifests, lockfiles, node_modules and dist removed |

Commands used (Python executable: `/Users/saiganeshsattenapalli/miniforge3/envs/aiml/bin/python`):

```sh
# In Curio
CURIO_TEST_DATABASE_URL=postgresql+asyncpg://curio_test@127.0.0.1:55432/curio_test \
CURIO_TEST_REDIS_URL=redis://127.0.0.1:56379/0 \
python -m pytest -q

# In Curio-Interface
python -m compileall -q app main.py tests
python -m pytest -q
uvicorn app.main:app --host 127.0.0.1 --port 8000
uvicorn tests.serve_browser:app --host 127.0.0.1 --port 8002
# Open /browser-tests on port 8002 to run the synthetic browser suite.
```

## Milestone record

1. **Backend SSE.** Added `app/services/events.py`, `app/services/runs.py`, `app/routers/runs.py`, `tests/test_runs.py`; updated existing service/agent/registry/app wiring and backend documentation. Initial milestone result: 71 backend tests passed using real PostgreSQL and Redis. PostgreSQL AgentRun remains authoritative, no migration required. Risk: no durable inference job queue after a hard process kill.
2. **Python interface shell.** Created `app/main.py`, `app/core/config.py`, `app/routers/pages.py`, package initializers, Jinja templates/components, CSS assets, `static/js/config.js`, `static/js/app.js`, requirements and page tests. Retained the original root entry point as an alias. Removed all of the unfinished Node scaffold. Compilation and 3 page/static/config tests passed; independent server/browser launch passed.
3. **SSE chat.** Added `api.js`, `sse.js`, `chat.js`, and chat styles. Implemented stable identity, browser-local history, New Chat, single-placeholder progress, final answer, pending-run recovery, idempotent retry and polling fallback. 10 browser checks passed. An SSE failure never submits a new run automatically.
4. **Memories.** Added `memory.js` and memory/card styles. Actual backend values render as human-readable cards, with refresh on open/completion/New Chat. 12 browser checks passed. A real model request saved and displayed the biryani preference and food budget.
5. **Live.** Added `live.js`, Live styles and the camera/voice/metrics UI. 32 browser checks passed, including synthetic media preview, JPEG limits, mode configuration, voice explicit-send, metrics bounds, busy/backoff, permission denial and resource cleanup. The real UI connected to the backend WebSocket. Physical capture hardware was not accessed.
6. **Demo polish.** Added discovery reasons, connection checks, optional location, safe DOM-based answer formatting, confirmed-activity controls, `README.md`, and `docs/demo.md`. Added narrow backend shopping affordability verification in `coaching.py`/`curio.py` after real inference exposed a contradiction. Final results are in the table above. Closing Live during an answer now stops capture immediately while allowing the answer to finish in the main chat.

## Real backend/model checks

These checks used the actual HTTP/WebSocket server, PostgreSQL on port 55432, Redis on port 56379, and cached GPT-OSS/Qwen MLX weights. Inference was not mocked.

- The browser submitted the biryani preference with `demo-sai`. SSE stages appeared and a final response rendered. The memory panel read the saved food preference and budget.
- After New Chat, “I'm hungry.” returned Demo Saffron Kitchen, spicy chicken biryani, and a fictional ₹280 price within the remembered ₹300 ceiling. The answer labeled the catalogue fictional. The conversation IDs differed while the user stayed the same.
- The real Discover form prefilled saved values and displayed ranked providers with backend-provided reasons. Distance remained unknown without coordinates.
- A measured shopping run returned HTTP 202 in **0.055 seconds**, then `run_started`, understanding/memory/reasoning/verification/response stages, final and done. Total time was **52.61 seconds**. GET status recovered the same committed answer. Last-Event-ID replay after `2-0` excluded the earlier events and included final.
- A synthetic 640×480 product silhouette was sent to the real Live WebSocket. Qwen returned a bounded observation in **19.41 seconds**. A second frame returned `frame_skipped`; a question sent during frame inference returned `busy`.
- The initial real shopping answer incorrectly claimed budget fit while admitting an unknown price. A narrow backend guard was added and tested; a subsequent real SSE shopping answer explicitly kept price/budget fit unknown. A final wording cleanup removes duplicate uncertainty sentences and is covered by the regression suite.
- The real interview mode received sample timing/RMS values and asked: “In a backend role, how would you optimize a slow query that scans a large table without an index?” The user's saved skill gap was database indexing.

## Scope of browser/media verification

`tests/browser_setup.js` supplies controlled network responses, speech recognition, audio samples and a canvas-generated MediaStream. `tests/browser_checks.js` exercises the actual interface modules and reports assertions in the browser. This verifies camera preview playback, raw JPEG encoding/dimensions/size, explicit-send dictation, timing/RMS payload shape, denial messages, duplicate-send prevention, fallback polling, modes, safe rendering and capture cleanup. It does **not** claim to validate the physical camera, microphone, OS permissions or browser speech-service accuracy on this machine. Those remain an in-person demo rehearsal check.

## Operational limits

- The asynchronous scheduler is process-local. Completed PostgreSQL results survive restart; accepted/running inference is not automatically resumed after a hard kill. Use graceful shutdown and avoid backend restarts during requests.
- The preview uses the isolated validation database (`curio_test`, port 55432) and disposable Redis (port 56379), not the repository's default database. Demo memories were intentionally seeded there. Configure normal PostgreSQL/Redis connections in the backend for later use.
- IDs are hackathon scoping, not authentication. Browser history is local, and Live has no durable reconnect/replay protocol for an interrupted WebSocket question. The client never silently resubmits one.
- SpeechRecognition support depends on the browser. Model responses and sparse visual observations remain fallible; the shopping guard is a narrow affordability check, not a general factual verifier.
