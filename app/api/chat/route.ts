import { NextResponse } from "next/server"

export const runtime = "nodejs"

const DEV_API_URL = "https://dev.to/api/articles?per_page=8&top=7"
const DEFAULT_MODEL = "gpt-4.1-mini"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

type DevArticle = {
  title: string
  url: string
  published_at: string
  tag_list?: string[]
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim().length > 0
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey || apiKey === "your-server-side-provider-key") {
    return NextResponse.json({ detail: "OPENAI_API_KEY is missing. Add it to the project environment variables for the server." }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 })
  }

  const rawMessages = body && typeof body === "object" ? (body as Record<string, unknown>).messages : undefined
  const messages = Array.isArray(rawMessages) ? rawMessages.filter(isChatMessage).slice(-20) : []
  if (messages.length === 0) {
    return NextResponse.json({ detail: "Send at least one non-empty chat message." }, { status: 400 })
  }

  let articles: DevArticle[]
  try {
    const newsResponse = await fetch(DEV_API_URL, { headers: { Accept: "application/json" }, cache: "no-store" })
    if (!newsResponse.ok) throw new Error(`DEV Community returned ${newsResponse.status}`)
    const news = await newsResponse.json()
    articles = Array.isArray(news)
      ? news.filter((article): article is DevArticle => Boolean(article && typeof article.title === "string" && typeof article.url === "string" && typeof article.published_at === "string")).slice(0, 8)
      : []
    if (articles.length === 0) throw new Error("DEV Community returned no articles")
  } catch {
    return NextResponse.json({ detail: "Recent developer news is unavailable. Please retry when the DEV Community API is reachable." }, { status: 503 })
  }

  const articleContext = articles.map((article, index) => `${index + 1}. ${article.title} — ${article.published_at} — ${article.url}`).join("\n")
  const systemMessage = `You are AI Daily News, a careful developer-news briefing assistant. Answer using only the recent DEV Community articles below as factual news context. If the articles do not support an answer, say that the available sources do not cover it; never invent news, dates, quotes, or links. You may explain technical context separately, but label uncertainty clearly. Keep answers concise and useful.\n\nRecent DEV Community articles:\n${articleContext}`

  let openAIResponse: Response
  try {
    openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.LLM_MODEL?.trim() || DEFAULT_MODEL, temperature: 0.2, messages: [{ role: "system", content: systemMessage }, ...messages] }),
      cache: "no-store",
    })
  } catch {
    return NextResponse.json({ detail: "The AI service could not be reached. Please retry." }, { status: 502 })
  }

  const openAIBody = await openAIResponse.json().catch(() => null)
  if (!openAIResponse.ok) {
    const detail = typeof openAIBody?.error?.message === "string" ? openAIBody.error.message : "The AI service returned an error."
    return NextResponse.json({ detail }, { status: openAIResponse.status === 401 ? 503 : 502 })
  }

  const reply = openAIBody?.choices?.[0]?.message?.content
  if (typeof reply !== "string" || !reply.trim()) {
    return NextResponse.json({ detail: "The AI service returned an empty reply." }, { status: 502 })
  }

  return NextResponse.json({ reply: reply.trim(), articles })
}
