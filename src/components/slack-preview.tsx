import { gemoji } from "gemoji"
import { Fragment, type ReactNode } from "react"

import { footerText, parseItems, tokenize, type Style, type Token } from "@shared/format"
import { cn } from "@/lib/utils"

const EMOJI = new Map<string, string>()
for (const e of gemoji) for (const name of e.names) EMOJI.set(name, e.emoji)

const SKIN_TONES: Record<string, string> = {
  "skin-tone-2": "\u{1F3FB}",
  "skin-tone-3": "\u{1F3FC}",
  "skin-tone-4": "\u{1F3FD}",
  "skin-tone-5": "\u{1F3FE}",
  "skin-tone-6": "\u{1F3FF}",
}

function Emoji({ name }: { name: string }) {
  const [base, tone] = name.split("::")
  const char = EMOJI.get(base)
  if (!char) {
    // Probably a custom workspace emoji; Slack will render it.
    return (
      <span className="rounded bg-muted px-1 font-mono text-xs text-muted-foreground" title="Custom emoji">
        :{base}:
      </span>
    )
  }
  return <span title={`:${name}:`}>{tone ? char + (SKIN_TONES[tone] ?? "") : char}</span>
}

function styled(node: ReactNode, style?: Style) {
  if (!style) return node
  return (
    <span
      className={cn(
        style.bold && "font-bold",
        style.italic && "italic",
        style.strike && "line-through",
        style.code && "rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em] text-orange-300"
      )}
    >
      {node}
    </span>
  )
}

const Mention = ({ children }: { children: ReactNode }) => (
  <span className="rounded bg-sky-500/15 px-0.5 font-medium text-sky-300">{children}</span>
)

function renderToken(t: Token, names: PreviewNames) {
  switch (t.type) {
    case "text":
      return styled(t.text, t.style)
    case "link":
      return styled(
        <a href={t.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
          {t.text ?? t.url}
        </a>,
        t.style
      )
    case "emoji":
      return <Emoji name={t.name} />
    case "user":
      return <Mention>@{t.id}</Mention>
    case "usergroup":
      return <Mention>@{t.id === names.usergroupId ? names.usergroup : t.id}</Mention>
    case "channel":
      return <Mention>#{t.id}</Mention>
    case "broadcast":
      return <Mention>@{t.range}</Mention>
  }
}

const Tokens = ({ tokens, names }: { tokens: Token[]; names: PreviewNames }) =>
  tokens.map((t, i) => <Fragment key={i}>{renderToken(t, names)}</Fragment>)

const BULLETS = ["•", "◦", "▪"]

export type PreviewNames = { usergroupId: string; usergroup: string }

export function SlackPreview({ text, formatted, names }: { text: string; formatted: boolean; names: PreviewNames }) {
  if (text.trim() === "") {
    return <p className="text-sm text-muted-foreground">Your message preview shows up here.</p>
  }

  if (!formatted) {
    return (
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {text
          .trim()
          .split("\n")
          .map((line, i) => {
            const indent = line.match(/^[ \t]*/)![0]
            return (
              <div key={i}>
                {indent}
                <Tokens tokens={tokenize(line.slice(indent.length))} names={names} />
              </div>
            )
          })}
      </div>
    )
  }

  const items = parseItems(text)
  const footer = tokenize(footerText(names.usergroupId))

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <p>
        <Mention>@{names.usergroup}</Mention> today:
      </p>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2" style={{ paddingLeft: `${item.level * 1.5}rem` }}>
            <span className="text-muted-foreground select-none">{BULLETS[item.level % BULLETS.length]}</span>
            <span className="min-w-0 break-words">
              <Tokens tokens={item.tokens} names={names} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        <Tokens tokens={footer} names={names} />
      </p>
    </div>
  )
}
