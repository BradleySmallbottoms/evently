# Evently — App Store listing

Paste-ready copy for App Store Connect. The same text is in `apps/mobile/store.config.json` for `eas metadata:push` (run that from `apps/mobile`, after a binary has been uploaded).

Primary language: **Swedish**. Add **English (U.S.)** as a localization. Bundle id `se.candybanana.lcly`. Version 1.0.0. Copyright **2026 Candy Banana AB** — confirm the legal name before you submit.

Price: free. Category: Lifestyle, secondary Entertainment.

## Swedish

**Name** (25/30)  
Evently: Lokala evenemang

**Subtitle** (27/30)  
Nära dig. Spara. Checka in.

**Promotional text** (update any time, no new build)  
Nytt i Söderhamn. Se konserter, kultur och familjeaktiviteter nära dig, spara det du vill gå på och checka in när du är där.

**Keywords** (comma only, no spaces, no words from the name or subtitle)  
konsert,kultur,kalender,museum,idrott,familj,festival,karta,söderhamn,påminnelse,barn,musik,teater

**What's new**  
Första versionen av Evently. Upptäck evenemang nära dig, sök och filtrera, se dem på kartan, spara, bli påmind och checka in på plats.

**Description**

Evently hjälper dig att se vad som händer nära dig. Konserter, kultur, idrott, familjeaktiviteter och det lilla som annars går att missa.

Öppna appen och bläddra direkt. Välj ort och hur långt du vill söka, spara det du vill gå på och be om en påminnelse. När du är på plats checkar du in.

Upptäck
• Evenemang nära dig, med bild, tid och plats
• Sök och filtrera på kategori, dag och pris
• Kartan, med en nål för varje evenemang
• Spara det du inte vill missa, eller säg att du kommer
• Påminnelser innan det börjar
• Lägg evenemanget i din kalender
• Checka in när du är där
• Tipsa om något som saknas i listan

Din stad
Evently börjar i Söderhamn och Hälsingland. Du väljer område och sökradie själv.

Inget konto
Appen känner igen enheten, inte ditt namn. Ett visningsnamn är valfritt. Det syns bara om du själv lägger till det, till exempel när du betygsätter ett evenemang du har besökt.

Plats
Plats läses när appen är öppen, för att visa evenemang nära dig och för att checka in. Evently följer dig inte i bakgrunden.

Svenska och engelska
Appen följer språket på telefonen.

## English (U.S.)

**Name** (21/30)  
Evently: Local Events

**Subtitle** (23/30)  
Nearby. Save. Check in.

**Promotional text**  
New in Söderhamn. See concerts, culture, and family activities near you, save what you want to attend, and check in when you arrive.

**Keywords**  
concert,culture,calendar,museum,sports,family,festival,map,sweden,reminder,music,tickets,halsingland

**What's new**  
The first version of Evently. Discover events near you, search and filter, see them on the map, save them, get a reminder, and check in when you are there.

**Description**

Evently shows you what is happening near you. Concerts, culture, sports, family activities, and the smaller things that are easy to miss.

Open the app and browse straight away. Pick a place and how far you want to look, save what you want to attend, and ask for a reminder. When you are there, check in.

Discover
• Events near you, with a photo, time, and place
• Search and filter by category, day, and price
• A map, with a pin for every event
• Save what you do not want to miss, or say you are coming
• Reminders before it starts
• Add the event to your calendar
• Check in when you are there
• Tell us about something missing from the list

Your town
Evently starts in Söderhamn and Hälsingland, Sweden. You choose the area and the search distance.

No account
The app recognizes the device, not your name. A display name is optional. It is shown only if you add one yourself, for example when you rate an event you attended.

Location
Location is read while the app is open, to show events near you and to check in. Evently does not follow you in the background.

Swedish and English
The app follows the language on your phone.

## Screenshots

Upload these, in order, for the **6.9-inch** iPhone display. Each file is 1320×2868.

| Order | Swedish                          | English                          |
| ----- | -------------------------------- | -------------------------------- |
| 1     | `screenshots/sv/01-discover.png` | `screenshots/en/01-discover.png` |
| 2     | `screenshots/sv/02-detail.png`   | `screenshots/en/02-detail.png`   |
| 3     | `screenshots/sv/03-search.png`   | `screenshots/en/03-search.png`   |
| 4     | `screenshots/sv/04-map.png`      | `screenshots/en/04-map.png`      |

The frames use real screens from the iPhone simulator. Swedish screenshots use the Swedish interface. English screenshots use the English interface. Recapture into `store/raw/` (Swedish) or `store/raw/en/` and run `python3 apps/mobile/store/compose.py` if the UI changes.

Apple scales the 6.9-inch set down to smaller iPhones. iPad screenshots are not included. Set **iPhone** only in the Xcode / Expo target (`ios.supportsTablet` is unset) before you upload, and confirm the build is iPhone-only. If the binary supports iPad, App Store Connect will also require a 13-inch iPad set (2064×2752).

## App icon

`store/icon/app-store-icon-1024.png` is 1024×1024, sRGB, with no transparency. The same file is written to `assets/images/icon.png`, which is what the iOS build ships. Apple rejects an icon that has an alpha channel or is not square. The previous file was 1024×1001 and had transparent corners.

Do not round the corners yourself. Apple applies the mask.

## What you still fill in yourself

App Store Connect will not accept the version until these exist. They are not invented here.

- **Privacy policy URL.** A draft is below. Publish it on a page you control, then paste the URL. Also add it to `store.config.json` as `privacyPolicyUrl` on both `sv` and `en-US` before `eas metadata:push`.
- **Support URL.** A page or mailto is not enough for Apple unless it is a working http(s) page with a way to reach you. Add `supportUrl` the same way.
- **Review contact.** First name, last name, phone, and email of a person who answers App Review. Sign-in is not required: the app creates an anonymous device identity on first launch. Notes you can paste:

  > No account is required. On first launch the app creates an anonymous device identity. Allow location if prompted; it is used only while the app is open, to list nearby events and to check in. Browse events for Söderhamn from the Home tab. Open an event for time, place, save, reminder, and calendar. The map is opened from the calendar screen’s map button. Check-in only succeeds at the venue during the event, or with a code the organizer shows. Push notifications are optional.

- **Age rating.** Suggested answers are in `store.config.json`: no contests, gambling, unrestricted web, or 17+ content, and every content descriptor set to None. Event text can mention a pub or a concert; if that is common, change alcohol references to Infrequent/Mild before you submit. That can raise the rating.
- **App Privacy.** See the label below. Answer that you do not track, and that you do not use data for tracking.
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is already false in `app.json`. In App Store Connect, the app uses encryption only as part of the operating system (HTTPS).
- **Release.** `store.config.json` keeps the version as a manual release so a metadata push does not publish it the moment Apple approves.

## App Privacy label

| Data                | Collected                                                                                        | Linked to the device identity | Used for tracking | Purpose           |
| ------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------- | ----------------- |
| Precise location    | Yes, while the app is in use                                                                     | Yes                           | No                | App functionality |
| Name                | Only if the person adds a display name                                                           | Yes                           | No                | App functionality |
| Email address       | Only if the person adds a recovery email                                                         | Yes                           | No                | App functionality |
| Photos              | Only if the person attaches one to a tip                                                         | Yes                           | No                | App functionality |
| User content        | Tips, ratings, comments                                                                          | Yes                           | No                | App functionality |
| Product interaction | Saves, “I’m coming”, check-ins                                                                   | Yes                           | No                | App functionality |
| Device ID           | Anonymous device credential                                                                      | Yes                           | No                | App functionality |
| Crash data          | Yes, via Sentry                                                                                  | Yes                           | No                | App functionality |
| Camera              | Used to scan a check-in code or photograph a poster. Not stored unless the person sends a photo. | —                             | No                | —                 |

Location is not collected in the background. The calendar permission is write-only (add an event) and calendar contents are not read. There is no advertising SDK and no tracking prompt in this version.

Resetting app data on the profile screen removes the credential from the phone. It does not delete the anonymous record on the server. Say that in the privacy policy, and give a contact address for a deletion request. App Review and GDPR both expect a way to ask for deletion.

## Privacy policy draft

Publish this, then put the URL in App Store Connect. Have it read by whoever signs for the company. Replace the bracketed lines.

### Swedish

Evently är en app från Candy Banana AB. Den visar evenemang nära dig.

Vi behöver ingen registrering. Vid första starten skapas en anonym identitet på enheten. Den används för att spara evenemang, områden, notiser och incheckningar.

Om du själv lägger till ett visningsnamn eller en mejladress sparar vi dem. Namnet kan visas om du betygsätter ett evenemang. Mejladressen visas inte offentligt.

När appen är öppen kan den läsa din plats, för att visa evenemang nära dig och för att checka in. Vi läser inte plats i bakgrunden.

Om du tipsar om ett evenemang sparar vi texten och de bilder du väljer att skicka. Om du checkar in kan du lämna ett betyg.

Vi använder Sentry för kraschrapporter, så att vi kan rätta fel. Vi säljer inte uppgifterna och använder dem inte för spårning mellan appar.

Återställning i appen tar bort identiteten från telefonen. Den tar inte automatiskt bort den anonyma posten hos oss. Skriv till [supportadress] om du vill att vi raderar den.

Personuppgiftsansvarig: Candy Banana AB, [adress], [e-post].

### English

Evently is an app from Candy Banana AB. It shows events near you.

No registration is required. On first launch the app creates an anonymous identity on the device. That identity is used to store saved events, places, notifications, and check-ins.

If you add a display name or an email address, we store them. The name can be shown if you rate an event. The email address is not shown publicly.

While the app is open it can read your location, to show events near you and to check in. We do not read location in the background.

If you submit a tip we store the text and any photos you choose to send. If you check in you can leave a rating.

We use Sentry for crash reports, so we can fix failures. We do not sell the data and we do not use it to track you across apps.

Resetting the app removes the identity from the phone. It does not by itself delete the anonymous record on our side. Email [support address] if you want that record deleted.

Controller: Candy Banana AB, [address], [email].

## Before review, from this pass

These showed up while the screenshots were taken. They are not in the store images. A reviewer who opens the app can still hit them.

- The calendar tab showed “Kunde inte ladda evenemang” while Home, search, and the map loaded events.
- Profile includes a Developer section with “Återställ appdata” and “Rensa sparade förslag”. That reads as a debug tool on a public build.
