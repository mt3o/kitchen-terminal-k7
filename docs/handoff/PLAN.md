# Kitchen Terminal K7 — plan projektu

Retro-futurystyczny dashboard kuchenny na starym iPadzie (Safari, "Add to Home
Screen"), backend na fizycznym serwerze w domowym LAN. Pogoda, kalendarz Google
(dwukierunkowo), przepisy (import z URL), lista zakupów, timer, czat AI przez
Kilo Gateway oraz dwa osobne widgety obrazkowe: `comic-of-the-day` (zewnętrzny
pasek z RSS, z atrybucją) i `ascii-art-of-the-day` (ASCII-art generowany przez AI,
bez kwestii praw autorskich).

## Architektura (skrót)

- **Backend**: Node.js/TypeScript, Express lub Fastify
- **Frontend**: Svelte 5, komponenty eksportowane jako custom elements
  (`<svelte:options customElement>`), złożone przez Astro + Vite, serwowane z tego
  samego backendu; styl retro-scifi (monospace, amber/teal, ostre kąty) wyłącznie
  przez tokeny motywu — patrz `TECH-STACK.md`
- **DB**: SQLite (lekko, pasuje do jednej maszyny w LAN) — tabele: `recipes`,
  `shopping_list`, `ai_calls`, `conversations`, `messages`
- **Integracje**: Google Calendar API (OAuth2), Kilo Gateway
  (`https://api.kilo.ai/api/gateway`), Open-Meteo (pogoda), GlitchTip (SDK
  `@sentry/node`, kompatybilny 1:1)
- **Repo**: publiczne na GitHubie, CI podobne do ytshield/punktomat
- **Storybook**: osobny build komponentów UI (karty, timer, chat, kalendarz)

## Otwarte decyzje

Rozstrzygnięte (zostawione dla śladu):

- ~~Framework frontendu~~ — Svelte 5 + custom elements
- ~~Nazwa repo na GitHubie~~ — **kitchen-terminal-k7**
- ~~Silnik bazy~~ — SQLite

~~Nadal otwarte, blokują start Fazy 0~~ — **nic już nie blokuje Fazy 0 (2026-09-08):**

1. ~~Nowa nazwa pakietu npm zamiast `middleware-pipe`~~ — opublikowane jako
   `@mt3o/middleware-pipe@1.0.0`, publiczne
2. ~~Uzupełnienie pustego repo `vidataflux`~~ — **wypisane ze stacku**; rolę pokrywa
   warstwa SQLite za portem repozytorium + adaptery `@logosdx/*`

Nadal otwarte, nieblokujące (rozstrzygane w trakcie Fazy 0):

3. ~~Adapter migracji + lekki ORM/query builder do SQLite~~ — **rozstrzygnięte: Drizzle**
4. ~~Strategia cache'owania Service Workera~~ — **rozstrzygnięte 2026-09-08, ale nie tak,
   jak zakładał plan.** Service Worker wymaga bezpiecznego kontekstu, a `http://` na
   adresie LAN nim nie jest — `navigator.serviceWorker` po prostu nie istnieje. Zmierzone,
   nie założone. Dlatego HTTPS przenosi się z Fazy 6 **przed** Service Workera, świeżość
   danych (pogoda, kalendarz) ląduje w backendzie w SQLite, a Service Worker odpowiada już
   tylko za powłokę aplikacji przy restarcie backendu.
5. ~~Binding trackera zadań~~ — **rozstrzygnięte**: GitHub Issues, `mt3o/kitchen-terminal-k7`
   (`context/foundation/tracker.md`, `context/foundation/git-workflow.md`)

## Fazy i zadania

Model dobrany do złożoności/wpływu zadania (Haiku = proste/niskie ryzyko,
Sonnet = umiarkowane, Opus = złożone/decyzje architektoniczne).

### Faza 0 — szkielet projektu

To jest **jedyna** obowiązująca lista Fazy 0. `TECH-STACK.md` opisuje uzasadnienia
technologii, ale nie prowadzi własnego zestawu zadań.

~~Najpierw odblokowanie~~ — **zrobione, Faza 0 startuje bez przeszkód:**
- [x] ~~Nowa nazwa pakietu npm zamiast `middleware-pipe`~~ — opublikowane
      2026-09-08 jako `@mt3o/middleware-pipe@1.0.0`, publiczne
- [x] ~~Uzupełnienie pustego repo `vidataflux`~~ — świadomie wypisane ze stacku
      2026-09-08; port repozytorium zostaje jako szew na później

Decyzje architektoniczne:
- [ ] Adapter migracji + lekki ORM/query builder do SQLite (silnik już ustalony;
      kandydaci: Drizzle, Kysely, better-sqlite3 — patrz `TECH-STACK.md`) — **Opus**
- [ ] Strategia Service Workera pod pełny cache offline — inwalidacja danych
      dynamicznych (kalendarz, przepisy) różni się od cache'owania app shell — **Opus**

Scaffolding:
- [ ] Scaffold repo (struktura folderów, tsconfig, eslint, package.json) — **Haiku**
- [ ] Target kompilacji (`tsconfig` + Vite `build.target`) pod Safari 15 — **Sonnet**
- [ ] CI: lint + build na GitHub Actions (wzór: ytshield/punktomat) — **Haiku**
- [ ] Setup GlitchTip SDK (init, test error) — **Haiku**
- [ ] Setup Varlock: `.env.schema` (Kilo Gateway key, Google OAuth refresh token,
      GlitchTip DSN) z redakcją sekretów w logach — **Sonnet**
      (krytyczne przy czacie AI z logowaniem wywołań: sekrety nie mogą trafić do
      GlitchTip razem z błędami)
- [ ] Setup Storybook (konfiguracja, pierwszy przykładowy komponent) — **Sonnet**
- [ ] Szkielet bazy SQLite + migracje (schemat tabel) — **Sonnet**

### Faza 1 — dashboard statyczny (bez AI)
- [x] ~~Wydzielenie tokenów designu do pliku motywu~~ — motyw jest źródłem, `tokens.css` generowany
      (komponenty czytają zmienne CSS wygenerowane z motywu, nie kolory/fonty na sztywno)
- [x] ~~Loader motywu~~ — serwer czyta plik wskazany przez `theme:` i generuje zmienne CSS; podmiana pliku zmienia cały design bez restartu
- [x] ~~Layout retro-scifi~~ — siatka stronicowana, typografia i kolory z motywu
- [x] ~~Komponent: karta pogody~~ — na żywych danych, z wiekiem odczytu
- [x] ~~Komponent: timer kuchenny~~
- [x] ~~Komponent: widok tygodnia kalendarza~~ — dane przykladowe, jawnie oznaczone; realne czekaja na OAuth2
- [x] ~~Storybook stories~~ — pogoda (w tym stan nieaktualny), minutnik, lista zakupow, audiometr

### Faza 2 — Google Calendar (dwukierunkowo)
- [ ] Rejestracja aplikacji w Google Cloud Console, OAuth consent — **Sonnet**
      (wymaga Twojej ręcznej interakcji w konsoli Google)
- [ ] Backend: flow OAuth2 + przechowywanie refresh tokena — **Opus**
      (bezpieczeństwo tokenów, decyzja architektoniczna)
- [ ] Endpointy: lista wydarzeń tygodnia, dodaj, edytuj, usuń — **Sonnet**
- [ ] Podłączenie widoku tygodnia do prawdziwych danych — **Sonnet**

### Faza 3 — przepisy i lista zakupów
- [ ] Parser `schema.org/Recipe` (JSON-LD) z URL — **Sonnet**
- [ ] Fallback heurystyczny (Readability.js + wykrywanie listy składników) — **Opus**
      (niejednoznaczne dane wejściowe, wymaga projektowania heurystyki)
- [ ] Endpoint `POST /recipes/import` + ekran potwierdzenia importu — **Sonnet**
- [ ] CRUD listy zakupów (backend + prosty UI) — **Haiku**

### Faza 4 — czat AI (Kilo Gateway)
- [ ] Integracja z `GET /api/gateway/models` (lista modeli + cennik + context window) — **Sonnet**
- [ ] `ConversationService`: rolling window + budżetowanie kontekstu per model — **Opus**
      (kluczowa decyzja architektoniczna, wpływa na przyszłe MCP/skill)
- [ ] Compacting: streszczanie starszej historii tańszym modelem — **Opus**
- [ ] Endpoint czatu (SSE streaming) + UI z wyborem modelu — **Sonnet**
- [ ] Logowanie wywołań: tokeny, koszt, sesja → tabela `ai_calls` — **Sonnet**
- [ ] Dashboard/log przegląda historii kosztów (prosty widok) — **Haiku**

### Faza 5 — widgety obrazkowe (dwa osobne typy kart)
- [ ] `ascii-art-of-the-day`: prompt + endpoint generujący ASCII-art (Kilo Gateway) — **Haiku**
- [ ] `ascii-art-of-the-day`: cache na dzień + `seed` do debugowania promptu — **Haiku**
- [ ] `comic-of-the-day`: pobranie i parsowanie RSS/Atom, wyciągnięcie obrazka
      (`enclosure`/`media:content`, fallback na `itemSelector`) — **Sonnet**
- [ ] `comic-of-the-day`: filtrowanie po `filterKeywords`, cache 24 h, atrybucja
      (`creditText` + `linkToSource`) i `fallbackImageUrl` — **Haiku**

### Faza 6 — deployment i twarde detale iPada
- [x] ~~Reverse proxy / HTTPS w LAN~~ — **przeniesione do Fazy 0**: to nie jest detal
      deploymentu, tylko warunek konieczny Service Workera. Certyfikat z Let's Encrypt przez
      wyzwanie DNS-01 na prywatny rekord A; nic nie jest wystawione na zewnątrz.
- [ ] Instrukcja "Add to Home Screen" + ustawienia Auto-Lock: Never — **Haiku**
- [ ] Test na faktycznym starym iOS (Safari renderowanie, JS wsparcie) — **Sonnet**

## Kolejność pracy

Zgodnie z Twoim stylem (plan-first, przegląd w GUI): każda faza kończy się
czymś widocznym do obejrzenia przed przejściem dalej — Storybook dla
komponentów, realny ekran na iPadzie dla integracji.

<!-- graph-workflow: distilled by /gw-foundation 2026-09-08 into memory_goal 59472cdc.
     Amending this file? Recall the foundation subgraph and impact_of these nodes first;
     the full table lives in context/foundation/foundation.md.
     Roadmaps churn and the graph should not, so only the sequencing constraints
     and the blockers were captured from this file — not the task list.
       every phase ends in something visible .. 7c574f65-8059-41e1-b507-245d4b1b3d6f
       blocks Faza 0: middleware-pipe ......... 7835061e-c325-4e70-8051-105f22ff4f8a
       blocks Faza 0: vidataflux .............. 40398c2a-b8e4-4721-b426-730e93b8a4d8
       Faza 0 decision: SQLite access layer ... a815b136-0de2-49af-ac42-6192c12def24
       Faza 0 decision: Service Worker ........ baefeee7-a562-4085-8a4e-cd20045f4164
       Faza 1 depends on the token contract ... 79662ce5-7b55-458a-b0e9-f0efd406d5a8
       tracker binding unresolved ............. 8a963777-1d94-42ad-ae4b-8a2b08d0a686
-->
