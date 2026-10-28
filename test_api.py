from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app as chatbot

client = TestClient(chatbot.app)


class FakeCompletions:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.kwargs = None

    async def create(self, **kwargs):
        self.kwargs = kwargs
        if self.error:
            raise self.error
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.response))])


class FakeClient:
    def __init__(self, completions):
        self.chat = SimpleNamespace(completions=completions)
        self.closed = False

    async def close(self):
        self.closed = True


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_requires_provider_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello"}]})
    assert response.status_code == 503


@pytest.mark.parametrize("messages", [
    [],
    [{"role": "user", "content": "   "}],
    [{"role": "assistant", "content": "No final user"}],
    [{"role": "system", "content": "not allowed"}],
    [{"role": "user", "content": "x" * 12_001}],
    [{"role": "user", "content": "x"}] * 21,
])
def test_invalid_messages_are_rejected(messages):
    assert client.post("/api/chat", json={"messages": messages}).status_code == 422


def test_provider_success_receives_context_and_config(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    completions = FakeCompletions("A contextual reply")
    fake_client = FakeClient(completions)
    monkeypatch.setattr(chatbot, "AsyncOpenAI", lambda **kwargs: fake_client)

    response = client.post("/api/chat", json={"messages": [
        {"role": "user", "content": "Remember this: blue"},
        {"role": "assistant", "content": "I will remember blue."},
        {"role": "user", "content": "What color?"},
    ]})

    assert response.status_code == 200
    assert response.json() == {"reply": "A contextual reply"}
    assert completions.kwargs["model"] == "test-model"
    assert completions.kwargs["messages"][1:] == [
        {"role": "user", "content": "Remember this: blue"},
        {"role": "assistant", "content": "I will remember blue."},
        {"role": "user", "content": "What color?"},
    ]
    assert fake_client.closed


def test_local_compatible_server_does_not_require_secret(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
    completions = FakeCompletions("Local model reply")
    captured = {}

    def make_client(**kwargs):
        captured.update(kwargs)
        return FakeClient(completions)

    monkeypatch.setattr(chatbot, "AsyncOpenAI", make_client)
    response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hi"}]})
    assert response.status_code == 200
    assert captured["api_key"] == "local-inference"
    assert captured["base_url"] == "http://localhost:11434/v1"


def test_provider_failure_is_sanitized(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    completions = FakeCompletions(error=RuntimeError("private credential details"))
    monkeypatch.setattr(chatbot, "AsyncOpenAI", lambda **kwargs: FakeClient(completions))
    response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "Hi"}]})
    assert response.status_code == 502
    assert "private credential" not in response.text


def test_preflight_cors_is_scoped():
    response = client.options("/api/chat", headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
