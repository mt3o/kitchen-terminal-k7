# k7-kilo-completion-timeout

status: open
created: 2026-09-10

## Goal
Fix a live bug found immediately after the household added a real
KILO_GATEWAY_KEY: an ascii-art-of-the-day generation request
(kilo-auto/free, non-streaming) hung indefinitely — no response, no
error, still pending minutes later per the deployed service's own log
(an "incoming request" line with no matching "request completed").
Reproduced with a raw curl POST to the real gateway too (0 bytes
received after 20s).

Root cause: chatCompletionOnce (src/server/upstream/kilo.ts) — used by
both ascii-art.ts and conversation-service.ts's compacting — issues its
POST with only the caller's own AbortSignal, no timeout of its own.
freshness.ts's fetchWithTimeout exists for exactly this ("an upstream
that accepts the connection and then never answers holds the request
open... those pile up") but chatCompletionOnce never adopted the
pattern; fetchWithTimeout itself is GET-only and doesn't fit a POST
with headers/body.

Fix: chatCompletionOnce now builds its own AbortController with a
45s timeout (DEFAULT_CHAT_COMPLETION_ONCE_TIMEOUT_MS), merged with any
caller-supplied signal.

Deliberately NOT touched: chatCompletion (the streaming generator used
by live chat) has the same shape of gap — plain opts.signal, no
timeout — but a stalled live chat turn is immediately visible to the
person waiting on it and a separate code path (SSE reader loop, not a
single fetch+json()); fixing it is a different diff and captured as an
issue instead.

memory_goal: 530af390-b4e3-443d-bccb-552fc45d9b73
