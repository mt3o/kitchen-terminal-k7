# k7-chat-voice-input

status: implemented, PR pending
created: 2026-09-10
memory_goal: 243ffaa5-1310-4137-a72e-a8d9255b9188

## Goal
Implement full voice-mode recording and transcription for the AI chat card: enable the existing disabled mic button behind `voiceInput`, record audio client-side with MediaRecorder, transcribe it server-side via the Kilo Gateway (extending `src/server/upstream/kilo.ts`), and populate the compose field with the transcript without auto-sending.
