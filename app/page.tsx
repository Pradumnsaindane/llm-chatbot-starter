"use client"

import { useMemo, useRef, useState } from "react"
import styles from "./page.module.css"

type Message = { role: "user" | "assistant"; content: string }

const suggestions = [
  { eyebrow: "AI / ML", text: "What’s new in AI today?" },
  { eyebrow: "JavaScript", text: "Any major JavaScript news?" },
  { eyebrow: "Open source", text: "What open-source releases matter this week?" },
]

function SparkIcon() {
  return <span className={styles.spark} aria-hidden="true">✦</span>
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000", [])
  const hasConversation = messages.length > 0

  async function sendMessage(content = input) {
    const trimmed = content.trim()
    if (!trimmed || isLoading) return
    const nextMessages = [...messages, { role: "user" as const, content: trimmed }]
    setMessages(nextMessages)
    setInput("")
    setError(null)
    setIsLoading(true)
    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || "The news service could not answer right now.")
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("The backend returned an empty reply.")
      setMessages([...nextMessages, { role: "assistant", content: data.reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      void sendMessage()
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}><div className={styles.logo}><SparkIcon /></div><span>Dev News Chat</span></div>
        <div className={styles.status}><span className={styles.statusDot} /> Live briefings</div>
      </header>

      <section className={`${styles.chat} ${hasConversation ? styles.chatActive : ""}`} aria-label="Developer news chat">
        {!hasConversation ? (
          <div className={styles.welcome}>
            <div className={styles.heroIcon}><SparkIcon /></div>
            <p className={styles.kicker}>YOUR DAILY DEVELOPER BRIEF</p>
            <h1>Stay curious.<br /><em>Stay current.</em></h1>
            <p className={styles.intro}>Ask about the latest in technology, open source, and the tools shaping how we build.</p>
            <div className={styles.suggestions}>
              {suggestions.map((suggestion) => <button className={styles.suggestion} key={suggestion.text} onClick={() => void sendMessage(suggestion.text)}><span>{suggestion.eyebrow}</span><strong>{suggestion.text}</strong><b>↗</b></button>)}
            </div>
          </div>
        ) : (
          <div className={styles.messages}>
            {messages.map((message, index) => <article className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`} key={`${message.role}-${index}`}><div className={styles.messageLabel}>{message.role === "user" ? "You" : <><SparkIcon /> Dev News</>}</div><p>{message.content}</p></article>)}
            {isLoading && <article className={`${styles.message} ${styles.assistantMessage}`}><div className={styles.messageLabel}><SparkIcon /> Dev News</div><div className={styles.typing}><i /><i /><i /></div></article>}
            {error && <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => void sendMessage(messages[messages.length - 1]?.content)}>Retry</button></div>}
          </div>
        )}
      </section>

      <div className={styles.composerWrap}>
        <div className={styles.composer}>
          <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask about developer news..." aria-label="Your question" rows={1} disabled={isLoading} />
          <button className={styles.send} onClick={() => void sendMessage()} disabled={!input.trim() || isLoading} aria-label="Send message"><span>Send</span><b>↗</b></button>
        </div>
        <p className={styles.hint}>Press <kbd>Enter</kbd> to send <span>·</span> <kbd>Shift + Enter</kbd> for a new line</p>
      </div>
      <footer className={styles.footer}><span>Answers are powered by your local backend.</span><span>News access depends on its configuration.</span></footer>
    </main>
  )
}
