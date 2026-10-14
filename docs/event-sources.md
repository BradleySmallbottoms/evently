# Event sources to import

Backlog for launch-area importers, starting in Söderhamn and nearby (Hälsingland, then closest
Gästrikland). Visit Söderhamn (Citybreak CBIS API) is already imported.

Build in this order. Each new source starts at trust `review`.

| Order | Source | Status | How |
| --- | --- | --- | --- |
| 1 | [Glada Hudik](https://www.gladahudik.se/sv/evenemangskalender) | Adapter `glada-hudik`. Public calendar, no API key. | Unfiltered `GET /sv/api/cbis-product-list?nodeId=841&page=`, then each event page. `robots.txt` disallows filtered list queries (`order`, `occasion`, `filter`, `search`, `categories`, `geo`, `arena`), so the worker does not send those. |
| 2 | [Destination Hälsingland](https://destinationhalsingland.se/evenemang-i-halsingland/) | Not started | Citybreak (WordPress CBIS plugin). One pull for festivals across Hälsingland. Needs an API key, or the same public-calendar approach as Glada Hudik. Do this before a Bollnäs scraper. |
| 3 | [Tickster](https://www.tickster.com/se/sv/events/tagged/s%C3%B6derhamn) | Not started | Official event API, filter by city. Söderhamn first, then Bollnäs, Hudiksvall, Ljusdal. Needs an API key. Ticketed concerts and theatre. |
| 4 | [Söderhamns stadsbibliotek](https://www.soderhamn.se/underwebbar/biblioteket/evenemang-pa-biblioteket.html) | Not started | Sitevision pages. `robots.txt` allows the calendar. Date, time, place and price on each page. |
| 5 | [Cinemascenen](https://www.cinemascenen.se/soderhamn/) | Not started | WordPress programme. Build only for screenings Tickster does not already return. |
| 6 | [Bollnäs kommun](https://bollnas.se/turism/upplev-bollnas/evenemang) | Not started | Sitevision calendar, about 290 events. Take what Destination Hälsingland missed. |
| 7 | [Gästrikland](https://gastrikland.se/sv/evenemang) | Not started | One Citybreak account feeds gastrikland.se, Visit Gävle, Visit Ockelbo, Hofors and Sandviken. Ockelbo first. |
| 8 | [Visit Ljusdal](http://visit.ljusdal.se/evenemang) | Not started | Sitevision calendar for Ljusdal and Järvsö. Build if Destination Hälsingland does not already list them. |
| 9 | [Föreningen Söderhamns Museum](https://www.foreningensm.se/event/) | Not started | Short hand-written list. Low volume. |
| 10 | [Nu på gång](https://nupagang.se/sv/city/soderhamn/) | Last | Aggregator with JSON-LD. Use as a venue checklist. It repeats Tickster and the cinema. |

Skipped on purpose:

- Söderhamn municipality’s evenemang page only links to Visit Söderhamn.
- `kalender.se` for Söderhamn has no published events.
- Runt knuten (Nordanstig) aggregates other sites. Import those sites directly.

Check each site’s terms before enabling a scraper. Citybreak and Tickster should use an API key when we have one.
