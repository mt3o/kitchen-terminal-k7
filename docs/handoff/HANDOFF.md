# Kitchen Terminal K7 — handoff

Dokument dla przyszłej sesji (Claude lub Ciebie), żeby nie trzeba było
odtwarzać kontekstu od zera.

## Kontekst sprzętowy

- Stary iPad (~10 lat, prawdopodobnie iOS 9–10) jako kiosk kuchenny
- Montowany na stałe (uchwyt/stojak), podłączony do zasilania na stałe
- Dostęp przez Safari → "Add to Home Screen" (pełny ekran, bez paska adresu)
- Auto-Lock ustawiony na Never
- Ograniczenie: stary Safari — nie polegać na najnowszych API JS,
  testować wcześnie i często na realnym urządzeniu

## Kontekst sieciowy

- Backend na fizycznej maszynie w domowym LAN (nie na cloud VPS, który Teodor
  ma osobno do innych projektów)
- iPad i serwer w tej samej sieci — nie trzeba wystawiać na zewnątrz,
  ale HTTPS w LAN bywa problematyczne dla starego Safari (mixed content,
  self-signed certy) — do sprawdzenia w fazie deploymentu

## Decyzje stylistyczne (ustalone)

- Styl: retro-futurystyczny, mocny klimat sci-fi (nie subtelny terminal)
- Typografia: monospace
- Kolory: amber jako dominujący akcent + teal jako drugi
- Kształty: ostre kąty (border-radius: 0), grube obramowania jako "HUD"
- Elementy: migający kursor, etykiety w stylu diagnostycznym
  (`STATUS: ONLINE`, `[AKTYWNE]`, `>> log`)
- Dwa wireframe'y zaakceptowane kierunkowo — patrz `wireframes/`

## Funkcje i status decyzji

| Funkcja | Status | Notatka |
|---|---|---|
| Pogoda | zdecydowane | Open-Meteo, bez klucza API |
| Kalendarz Google | zdecydowane | dwukierunkowo: odczyt + dodaj/edytuj/usuń, mini widok tygodnia |
| Przepisy | zdecydowane | import przez URL, ekstrakcja (schema.org/Recipe + fallback) |
| Lista zakupów | zdecydowane | edytowalna też z telefonu |
| Timer | zdecydowane | czysty JS, offline |
| Czat AI | zdecydowane | Kilo Gateway, wybór modelu, do bieżących pytań; docelowo możliwe podpięcie pod MCP/dedykowany skill — stąd `ConversationService` ma być oddzielony od endpointu czatu |
| Baza błędów | zdecydowane | GlitchTip, SDK `@sentry/node` (kompatybilny) |
| Repo | zdecydowane | publiczne na GitHubie, nazwa: **kitchen-terminal-k7** |
| Storybook | zdecydowane | osobny build komponentów |
| Logowanie AI | zdecydowane | tabela `ai_calls`: sesja, model, tokeny, szacowany koszt |
| Rolling window / compacting | zdecydowane | budżet kontekstu per model na podstawie `contextWindow` z listy modeli Kilo Gateway |
| Kot dnia | zmienione | rozdzielone na dwa osobne widgety: `comic-of-the-day` (zewnętrzny obraz z RSS, atrybucja, filtrowanie słów kluczowych) i `ascii-art-of-the-day` (generowany przez AI, własny prompt/model/rozmiar) — inne parametry i inne kwestie prawne, więc nie warto ich łączyć w jeden typ |
| Theming | zdecydowane | design podmieniany przez wczytanie innego pliku motywu (`theme.schema.yaml`); komponenty czytają wyłącznie tokeny/zmienne CSS, nigdy nie zaszywają kolorów/fontów na sztywno |
| Mikrofon w czacie | zdecydowane | ikona nagrywania + transkrypcja audio przed wysłaniem wiadomości |
| Karuzela / grid w karcie / slideshow bezczynności | zdecydowane | `carousel` = ręczne/auto przewijanie slajdów w jednej pozycji siatki (z `startDelaySeconds`); `grid` = zagnieżdżona mini-siatka widoczna naraz; `slideshow` = pełnoekranowa rotacja głównych kart po `idleTriggerSeconds` bezczynności, przerywana dotykiem |
| Sidebar / zegar / menu | zdecydowane | `sidebar` to komponent główny (równorzędny z `cards`), permanentny w układzie horyzontalnym, chowalny pionowo, zawsze chowalny na telefonie; nowe typy kart `clock` (data/godzina, może stać w gridzie/karuzeli/sidebarze) i `menu` (przełącza aktywną kartę po `cardId`, bez renderowania treści samodzielnie) |
| Audiometr | zdecydowane | nowy typ karty `audiometer` — nasłuchuje mikrofonu (Web Audio API), pokazuje bieżącą głośność + histogram z ostatnich `historyDurationSeconds` (domyślnie 3 min); jednostka dB lub percent, opcjonalny próg ostrzegawczy |
| Wybudzanie kamerą | zdecydowane | `slideshow.params.wakeOnPresence` — wykrycie ruchu/obecności kamerą wybudza z trybu bezczynności; przetwarzane lokalnie w przeglądarce, obraz nigdy nie opuszcza urządzenia; skanowanie kodów/dodawanie do listy zakupów i notatki wideo — świadomie odrzucone na razie |
| Integracja z Zakupy (lista/spiżarnia) | otwarte | `shopping-list.params.dataSource` ma dwa tryby: `local` (własna tabela w K7) i `zakupy-api` (K7 jako dodatkowy wyświetlacz danych z osobnego projektu Zakupy). `zakupy-api` niedostępne, dopóki Zakupy nie ma fazy technicznej (patrz `/projects/.../family-pwa-suite`) — na razie działa tylko `local` |

## Pomysły odłożone na później (nie zapomnieć, nie budować teraz)

- **Integracja z Punktomatem** — kafelek z rankingiem domowników/punktów za obowiązki,
  czytający z tej samej bazy co Punktomat. Blokowane tym samym co Zakupy: Punktomat
  też nie ma jeszcze fazy technicznej.
- **Czujnik pyłków/jakości powietrza** — Teodor jeszcze nie zbudował fizycznego
  czujnika ESP32 do tego (patrz `/areas/pollen-ventilation-esp32.md`), ale koncepcyjnie
  ma sens jako karta obok pogody, gdy czujnik powstanie i zacznie publikować przez MQTT.
- Skanowanie kodów kreskowych do listy zakupów kamerą iPada — świadomie odrzucone.
- Notatki wideo z transkrypcją — świadomie odrzucone.

## Techniczne notatki, które łatwo przeoczyć

- Kilo Gateway: base URL `https://api.kilo.ai/api/gateway/`, format modelu
  `provider/model-name`, lista modeli i cennik przez `GET /models` (bez
  autoryzacji), `usage.prompt_tokens`/`completion_tokens` w odpowiedzi do
  liczenia kosztu
- Google Calendar: pełna integracja dwukierunkowa wymaga OAuth2, nie tylko
  publicznego `.ics` (to tylko odczyt)
- Refresh token Google i klucz Kilo Gateway — nigdy nie trafiają do frontendu/iPada,
  tylko backend

## Co dalej

Zacząć od Fazy 0 w `PLAN.md` (szkielet repo). Framework frontendu jest już
rozstrzygnięty (Svelte 5 + custom elements — patrz `TECH-STACK.md`), więc
scaffolding nie jest już tym zablokowany.

Realnie blokują start dwie rzeczy, obie po Twojej stronie:

1. **`middleware-pipe`** — nazwa zajęta na npm, potrzebna nowa przed publikacją.
2. **`vidataflux`** — repo jest puste, wymaga uzupełnienia zanim wejdzie do stacku.

Otwarte, ale nieblokujące (do rozstrzygnięcia w trakcie Fazy 0):

- adapter migracji + lekki ORM/query builder do SQLite (silnik ustalony) — **Opus**
- strategia cache'owania Service Workera dla danych dynamicznych — **Opus**
- ~~binding trackera zadań~~ — **rozstrzygnięte 2026-09-08**: GitHub Issues na koncie
  osobistym, `mt3o/kitchen-terminal-k7`, zamyka człowiek. Patrz
  `context/foundation/tracker.md` i `context/foundation/git-workflow.md`
  (branch-per-change → PR → merge commit, bez squasha).

<!-- graph-workflow: distilled by /gw-foundation 2026-09-08 into memory_goal 59472cdc.
     Amending this file? Recall the foundation subgraph and impact_of these nodes first;
     the full table lives in context/foundation/foundation.md.
       Safari 15 baseline .......... 0bc7e618-9b95-4977-9fe1-f3a48759276f
       A8X frame budget ............ 716987ce-f933-41b5-8c4e-590c09dc33bf
       LAN backend + HTTPS risk .... d3faf49e-9fd8-4d79-9c8a-733cb2baa856
       secrets never reach the FE .. ac006a24-2763-40e7-8423-2b851793efcf
       token contract .............. 79662ce5-7b55-458a-b0e9-f0efd406d5a8
       ConversationService seam .... 4730c1bc-b791-4a0d-a94c-1bd4f8307102
       Kilo Gateway ................ 279d73e0-ff0f-4184-a25c-f051d2030072
       Google Calendar / OAuth2 .... c129f201-ae3c-45c8-89d7-a170bbaf5fad
       GlitchTip via @sentry/node .. 41ec3acd-0302-4120-9ef0-4b00a4945829
       comic + ascii split ......... e24b75ab-e370-4566-b9e7-35706cad806b
       camera stays local .......... 9ea20285-de89-4f25-a25e-37700078bd59
       zakupy-api blocked .......... 6d5ae12d-608b-4187-839b-74d56e7ff059
-->
