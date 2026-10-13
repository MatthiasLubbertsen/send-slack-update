import { InfoIcon, Loader2Icon, SendIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { SlackPreview, type PreviewNames } from "@/components/slack-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

const DRAFT_KEY = "daily-update-draft"
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
// Don't pop the keyboard open on phones.
const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches

const PLACEHOLDER = `Fixed the login bug :bug:
  Added logging
  Added tests
Updated the dashboard :rocket:
  See https://example.com or [the docs](https://example.com/docs)`

function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ""
  } catch {
    return ""
  }
}

function writeDraft(value: string) {
  try {
    if (value) localStorage.setItem(DRAFT_KEY, value)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Storage unavailable (private mode etc.), drafts just won't persist.
  }
}

type Config = PreviewNames & { channel: string }

export default function App() {
  const [text, setText] = useState(readDraft)
  const [formatted, setFormatted] = useState(true)
  const [sending, setSending] = useState(false)
  const [config, setConfig] = useState<Config>({ usergroupId: "", usergroup: "usergroup", channel: "" })

  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConfig)
      .catch(() => {})
  }, [])

  useEffect(() => writeDraft(text), [text])

  const send = useCallback(async () => {
    if (sending) return
    if (text.trim() === "") {
      toast.error("Write something first.")
      return
    }

    setSending(true)
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, formatted }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`)

      setText("")
      toast.success("Sent to Slack", {
        action: data.permalink
          ? { label: "Open", onClick: () => window.open(data.permalink, "_blank", "noreferrer") }
          : undefined,
      })
    } catch (error) {
      toast.error("Couldn't send", { description: (error as Error).message })
    } finally {
      setSending(false)
    }
  }, [text, formatted, sending])

  return (
    // Phones: exactly one screen tall, editor on top and preview below, each
    // scrolling on its own. md+: two columns.
    <main className="mx-auto flex h-dvh w-full max-w-5xl flex-col gap-3 p-3 md:grid md:h-auto md:min-h-svh md:grid-cols-2 md:items-start md:gap-6 md:p-8 md:py-16">
      <Card className="min-h-0 flex-[3] [--card-spacing:--spacing(3)] md:flex-none md:[--card-spacing:--spacing(4)]">
        <CardHeader>
          <CardTitle className="md:text-xl">Today&apos;s update</CardTitle>
          <CardDescription className="hidden md:block">
            One task per line. Indent with two spaces or a tab for sub-points.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 md:gap-4">
          <Textarea
            autoFocus={isDesktop}
            spellCheck={false}
            value={text}
            placeholder={PLACEHOLDER}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void send()
              }
              if (e.key === "Tab" && !e.shiftKey) {
                // Tab indents instead of leaving the field.
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: start, selectionEnd: end } = el
                const next = `${text.slice(0, start)}  ${text.slice(end)}`
                setText(next)
                requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
              }
            }}
            // text-base on phones stops iOS from zooming in on focus.
            className="min-h-0 flex-1 resize-none font-mono text-base leading-relaxed field-sizing-fixed md:min-h-64 md:flex-none md:resize-y md:text-sm md:field-sizing-content"
          />

          <div className="flex shrink-0 items-start gap-3 md:rounded-lg md:border md:p-3">
            <Checkbox
              id="formatted"
              checked={formatted}
              onCheckedChange={(v) => setFormatted(v === true)}
              className="mt-0.5"
            />
            <div className="grid gap-1">
              <Label htmlFor="formatted">Daily update format</Label>
              <p className="hidden text-sm text-muted-foreground md:block">
                {formatted ? (
                  <>Pings @{config.usergroup} with &ldquo;today:&rdquo;, a bullet list and the thread footer.</>
                ) : (
                  <>Sends your text exactly as written. No ping, no footer.</>
                )}
              </p>
            </div>
          </div>

          <p className="hidden text-xs leading-relaxed text-muted-foreground md:block">
            <code>*bold*</code> <code>_italic_</code> <code>~strike~</code> <code>`code`</code>{" "}
            <code>:emoji:</code> <code>[text](url)</code> and pasted links all work.
          </p>
        </CardContent>
        <CardFooter className="shrink-0 justify-between gap-4">
          <KbdGroup className="hidden text-muted-foreground md:inline-flex">
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          <Button onClick={send} disabled={sending || text.trim() === ""} className="w-full md:w-auto">
            {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {sending ? "Sending…" : "Send to Slack"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="min-h-0 flex-[2] [--card-spacing:--spacing(3)] md:sticky md:top-16 md:flex-none md:[--card-spacing:--spacing(4)]">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Preview</CardTitle>
            <Badge variant="secondary">{formatted ? "Daily update" : "Plain text"}</Badge>
          </div>
          {config.channel && (
            <CardDescription className="hidden md:block">
              Posting to #{config.channel}
            </CardDescription>
          )}
        </CardHeader>
        <Separator />
        <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <SlackPreview text={text} formatted={formatted} names={config} />
          {formatted && text.trim() !== "" && (
            <p className="text-sm text-muted-foreground md:border-t md:pt-3">
              Followed by: 🧵 or don&apos;t thread
            </p>
          )}
        </CardContent>
        <CardFooter className="hidden text-xs text-muted-foreground md:flex">
          <InfoIcon className="mr-1.5 size-3" />
          Approximation. Custom emoji show as their name.
        </CardFooter>
      </Card>
    </main>
  )
}
