# Kitchen Terminal K7 — założenia techniczne

## Stack

| Warstwa | Wybór |
|---|---|
| Język | TypeScript 7 (natywny kompilator Go) — **zweryfikować status GA przed scaffoldingiem**; zakładany RC czerwiec 2026, plan pisany zanim to nastąpiło |
| Bundler | Vite 8 |
| Frontend framework | Svelte 5 — **rozstrzygnięte** (uzasadnienie niżej) |
| Meta-framework | Astro |
| Komponenty | Web Components (custom elements) |
| Style | Tailwind CSS, klasy grupowane w mixiny (`@apply`/warstwa komponentowa) |
| Storybook | tak, osobny build |
| Architektura backendu | heksagonalna (ports & adapters), dependency injection |
| PWA | pełny cache offline (Service Worker, app shell + dane) |
| Kompatybilność | iPad Air 2 (A1567) i iPhone 6s — oba wspierane do iOS/iPadOS 15, więc wspólny baseline to Safari 15 |
| Zarządzanie credentiali | Varlock (dmno-dev/varlock) — schema-based `.env`, walidacja i typowanie, redakcja sekretów w logach, skanowanie wycieków, integracje z 1Password/Infisical/AWS/Vault; agenci AI widzą schemat, nigdy realnych wartości |

## Biblioteki własne i zewnętrzne

- **config-layers** (github.com/mt3o/config-layers) — Twoja biblioteka, warstwowa konfiguracja
- **middleware-pipe** (github.com/mt3o/middlewares) — Twoja biblioteka, kompozycja middleware ze
  statyczną walidacją (Zod). **Do publikacji na npm** — patrz zastrzeżenie niżej
- **@logosdx/\*** (github.com/logosdx/monorepo) — gotowe pakiety npm: `utils`, `observer`,
  `fetch`, `storage`, `dom`, `localize` — TypeScript-first, zero-dependency, runtime-agnostic,
  pasują dobrze do heksagonalnej architektury jako adaptery (fetch z retry, storage jako
  jeden interfejs na wiele backendów kluczy-wartości, obserwator zdarzeń)
- **agentic-memory-system** i **graph-workflow** (mt3o-dev) — do zarządzania kontekstem
  (chatu?) — **patrz zastrzeżenie niżej, to nie jest biblioteka runtime**
- **vidataflux** (mt3o-dev) — do zarządzania danymi, wymaga pakietu na npm — **patrz
  zastrzeżenie niżej, repo jest puste**

## ⚠️ Zastrzeżenia — status

1. **`middleware-pipe` — nazwa zajęta na npm. OTWARTE, blokuje start.** Potwierdzone,
   poszukasz innej nazwy. Na razie trzymam w dokumentacji adres repo
   (github.com/mt3o/middlewares) bez zmian — nazwa pakietu npm do ustalenia.
2. **`agentic-memory-system` i `graph-workflow` — potwierdzone: narzędzia do PRACY
   nad projektem** (Ty + Claude Code), nie zależności runtime aplikacji. Nie trafiają
   do `package.json` — zostają jako narzędzia deweloperskie obok projektu.
3. **`vidataflux` — puste repo. OTWARTE, blokuje start.** Do uzupełnienia przez
   Ciebie przed użyciem w stacku (albo do świadomego wypisania ze stacku).
4. ~~iPhone 6s vs. iPad~~ — rozwiązane, patrz wyżej (oba do iOS/iPadOS 15).

**Status: 2 z 4 zastrzeżeń otwarte** (1 i 3). Zastrzeżenia 2 i 4 są rozstrzygnięte.

## Decyzje (rozstrzygnięte)

### Frontend: Svelte 5 + Web Components
Zdecydowane: Svelte 5, komponenty eksportowane jako custom elements
(`<svelte:options customElement="...">`) zamiast czystego natywnego JS.

Dane, które za tym stały: Svelte kompiluje się do JS bez Virtual DOM i bez runtime'u
frameworka — minimalna aplikacja waży ~2–5 KB gzip (dla porównania React+ReactDOM to
~40–45 KB), czas do interaktywności zwykle 30–40% szybszy niż w frameworkach z VDOM.
Na sprzęcie klasy A8X/2GB RAM (iPad Air 2) narzut Svelte względem czystego JS jest
w praktyce pomijalny, przy dużo lepszym DX (komponenty, reaktywność, mniej kodu).
Kompilacja do custom elements godzi ten wybór z wymaganiem Web Components, a
architektura heksagonalna zostaje nietknięta — komponenty są adapterem UI za portem.

### Baza danych: SQLite
Silnik zdecydowany: **SQLite**. Otwarty pozostaje tylko adapter migracji i query
builder (niżej) — nie sam wybór silnika.

### Kompatybilność: Safari 15
iPad Air 2 (A1567) i iPhone 6s oba kończą na iOS/iPadOS 15, więc wspólny baseline to
Safari 15. To ustawia `tsconfig` i Vite `build.target`.

## Decyzje oddane Opusowi (rozstrzygane w Fazie 0)

### Adapter migracji + lekki ORM/query builder do SQLite
Silnik jest ustalony; do wybrania jest warstwa dostępu. Musi pasować do architektury
heksagonalnej (repozytorium daje się podmienić za portem) i do TypeScript-first stacku.
Kandydaci (nie ostateczna decyzja): **Drizzle ORM** (lekki, TS-first, `drizzle-kit` do
migracji), **Kysely** (query builder z pełnym typowaniem, mniejszy narzut niż pełny ORM),
ewentualnie **better-sqlite3** jako sterownik niskopoziomowy pod spodem.

### Strategia Service Workera
Pełny cache offline (app shell + dane). Cache'owanie danych dynamicznych — kalendarz,
przepisy — ma inną charakterystykę inwalidacji niż app shell, więc wymaga przemyślenia,
zanim padnie wybór workbox vs. ręczny SW.

## Otwarte decyzje

Rozstrzygnięte (zostawione dla śladu):

- ~~Framework frontendu~~ — Svelte 5 + Web Components (wyżej)
- ~~Nazwa repo na GitHubie~~ — **kitchen-terminal-k7**
- ~~Silnik bazy~~ — SQLite
- ~~iPhone 6s vs. iPad jako target~~ — wspólny baseline Safari 15

Nadal otwarte: patrz "⚠️ Zastrzeżenia — status" wyżej (pozycje 1 i 3) oraz
"Decyzje oddane Opusowi" — obie sekcje są ujęte w liście zadań Fazy 0.

## Zadania

Zadania Fazy 0 **żyją wyłącznie w `PLAN.md`**. Ten plik uzasadnia wybory
technologiczne; wcześniejsza wersja prowadziła równoległą listę "Zaktualizowana
Faza 0 (dodatki)", która zaczęła się rozjeżdżać z planem — została scalona do
`PLAN.md` § Faza 0.

<!-- graph-workflow: distilled by /gw-foundation 2026-09-08 into memory_goal 59472cdc.
     Amending this file? Recall the foundation subgraph and impact_of these nodes first;
     the full table lives in context/foundation/foundation.md.
       Svelte 5 + custom elements .. 77925b30-350a-42ee-a7de-7e8a023c5708
       hexagonal backend ........... 125f4071-59ec-4d3f-898d-ffcb3edd8aa5
       SQLite (access layer open) .. a815b136-0de2-49af-ac42-6192c12def24
       Safari 15 baseline .......... 0bc7e618-9b95-4977-9fe1-f3a48759276f
       gw tools are not runtime .... 18bafc37-5e9e-4d04-936a-53218abaca4b
       middleware-pipe name taken .. 7835061e-c325-4e70-8051-105f22ff4f8a
       vidataflux repo empty ....... 40398c2a-b8e4-4721-b426-730e93b8a4d8
       TypeScript 7 GA unverified .. b6cc5895-5e52-462a-aab2-c934ba921825
       Service Worker strategy ..... baefeee7-a562-4085-8a4e-cd20045f4164
-->
