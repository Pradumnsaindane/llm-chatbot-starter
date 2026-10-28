"""Small, stateless FastAPI gateway to an OpenAI-compatible chat model."""

import os
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

load_dotenv()

MAX_HISTORY_MESSAGES = 20
MAX_TOTAL_CHARS = 40_000
DEFAULT_MODEL = "gpt-4.1-mini"

app = FastAPI(title="LLM Chatbot API", version="1.1.0")
allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message content must not be blank")
        return value


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_HISTORY_MESSAGES)

    @model_validator(mode="after")
    def validate_context(self):
        if self.messages[-1].role != "user":
            raise ValueError("The final message must be from the user")
        if sum(len(message.content) for message in self.messages) > MAX_TOTAL_CHARS:
            raise ValueError("Conversation is too long; shorten the messages and try again")
        return self


class ChatResponse(BaseModel):
    reply: str


@app.get("/")
def root():
    return {"name": "LLM Chatbot API", "status": "running", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None
    model = os.getenv("LLM_MODEL", DEFAULT_MODEL).strip()
    # Local OpenAI-compatible servers commonly do not authenticate. Never send
    # this placeholder to the browser; it is used only by the server-side SDK.
    if not api_key and base_url:
        api_key = "local-inference"
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI provider is not configured. Set OPENAI_API_KEY, or configure OPENAI_BASE_URL for a local server.",
        )
    if not model:
        raise HTTPException(status_code=503, detail="LLM_MODEL must not be empty.")

    client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=30.0, max_retries=1)
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful, clear, and friendly AI assistant. Answer the user's question directly. "
                "If you are uncertain, say so. Use Markdown when it makes the answer easier to read."
            ),
        },
        *[message.model_dump() for message in request.messages],
    ]
    try:
        result = await client.chat.completions.create(model=model, messages=messages, temperature=0.7)
        reply = result.choices[0].message.content
        if not reply or not reply.strip():
            raise HTTPException(status_code=502, detail="The model returned an empty reply. Please retry.")
        return ChatResponse(reply=reply)
    except HTTPException:
        raise
    except APITimeoutError:
        raise HTTPException(status_code=504, detail="The AI provider timed out. Please retry.")
    except (APIConnectionError, APIStatusError):
        raise HTTPException(
            status_code=502,
            detail="The AI provider request failed. Check the model name, credentials, and provider availability.",
        )
    except Exception:
        # Provider internals can include request metadata; keep them out of logs and responses.
        raise HTTPException(status_code=502, detail="The AI provider request failed. Please retry.")
    finally:
        await client.close()
