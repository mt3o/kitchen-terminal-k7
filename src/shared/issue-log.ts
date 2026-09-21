/**
 * The shape `GET /api/issues` serves and `POST /api/issues/client` accepts.
 * Mirrors `IssueLogEntry` in `src/server/domain/types.ts` field-for-field —
 * kept as a separate declaration rather than a cross-boundary import, same
 * "no client code imports server types" rule `CalendarEvent` follows
 * (`server/domain/types.ts`'s own doc comment). `createdAt` is a string here:
 * it crosses HTTP as JSON, where a `Date` is already an ISO string.
 */
export type IssueSeverity = 'warn' | 'error'

export interface IssueLogEntry {
  id: string
  severity: IssueSeverity
  source: string
  message: string
  detail: string | null
  createdAt: string
}
