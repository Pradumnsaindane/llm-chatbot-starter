# LLM Chatbot API

A stateless FastAPI backend that sends real user messages and recent conversation context to a pretrained model through the OpenAI chat-completions API. It never generates canned or fallback replies. No frontend is included in this repository.

## Requirements

- Python 3.10 or newer
- A hosted OpenAI-compatible provider API key, or a running local server that implements `/v1/chat/completions`

## Setup and run

From this repository directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` for a hosted provider. For a compatible local server, set `OPENAI_BASE_URL` and the server's model name in `LLM_MODEL`; the API key may be omitted for local inference. Keep `.env` private and never put provider credentials in browser code.

Start the API:

```bash
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs for interactive API docs. `GET /health` reports API process health; it does not make a billable provider request.

## Send a conversation

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Explain Python in simple words."}]}'
```

The response has shape `{"reply":"..."}`. For follow-up questions, include recent messages in chronological order, ending with the current user message:

```json
{
  "messages": [
    {"role": "user", "content": "Remember this: my favorite color is blue."},
    {"role": "assistant", "content": "Got it, blue."},
    {"role": "user", "content": "What color did I say?"}
  ]
}
```

The API is stateless. The client is responsible for retaining and resending the conversation. Requests accept at most 20 user/assistant messages, at most 12,000 characters per message and 40,000 characters total. The last message must be from the user. Invalid requests receive `422`; missing hosted credentials receive `503`; provider timeouts receive `504`; provider failures receive a sanitized `502`.

## Configuration

- `OPENAI_API_KEY`: hosted provider key; server only
- `LLM_MODEL`: provider model ID (default `gpt-4.1-mini`)
- `OPENAI_BASE_URL`: optional OpenAI-compatible API base URL (for example, `http://localhost:11434/v1`)
- `CORS_ORIGINS`: comma-separated exact frontend origins; defaults to local development ports 3000 and 5173

The provider client uses a 30-second timeout and one bounded retry. The API does not log message bodies or provider errors. There is no authentication or rate limiter in this starter; deploy behind an authenticated gateway or add application-level user auth and per-user rate limits before exposing it publicly.

## Tests

```bash
python -m pytest -q
```

Provider calls are mocked in tests; production always calls the configured model and returns an error if it cannot. Tests cover health, validation, missing credentials, successful model requests and conversation context, local-compatible configuration, sanitized provider failures, and CORS preflight.

## Troubleshooting

- `503 AI provider is not configured`: set `OPENAI_API_KEY`, or set `OPENAI_BASE_URL` for a local compatible server.
- `502 AI provider request failed`: confirm the provider is reachable and `LLM_MODEL` matches a model served by it. Provider-specific details are intentionally not exposed by the API.
- `504 AI provider timed out`: check provider latency and network access; requests have a 30-second timeout.
- Browser CORS failure: add the exact page origin (scheme, host and port) to `CORS_ORIGINS`, then restart the API.
- Local server connection failure: verify it is running, serves `/v1/chat/completions`, and that `OPENAI_BASE_URL` ends with `/v1` when required by that server.
