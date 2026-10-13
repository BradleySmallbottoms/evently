# DESIGN.md --- Local Events App

## 1. Product and Design Intent

Design a polished, mobile-first app that helps people discover, search,
save, and attend local events and activities: live music, concerts,
theatre, museums, exhibitions, fitness, outdoor activities, food events,
and more.

The experience should feel: - **Local and welcoming** --- useful for
discovering what is happening nearby. - **Editorial and photographic**
--- strong event photography gives each event personality. - **Modern
and calm** --- clear hierarchy, generous spacing, restrained
decoration. - **Warm but not rustic** --- use sunset-inspired accents
balanced by neutral blue-grey, warm off-white, and muted category
colors. - **Easy to explore** --- users should be able to browse before
creating an account.

Treat this document as the source of truth for visual and interaction
decisions. Reuse tokens and components rather than inventing new styles
screen by screen.

## 2. Visual Direction

Use a Scandinavian-inspired visual language: warm off-white surfaces,
dark blue-grey typography, subtle borders, soft corners, and photography
with natural light. Images should feel cinematic and authentic rather
than like generic stock photos.

The onboarding imagery establishes the visual direction: 1. **Music and
live events:** a lively outdoor concert at dusk, warm stage lights, a
crowd, and a sunset sky. 2. **Culture:** a museum, gallery, or theatre
atmosphere with warm interior lighting and architectural or artistic
details. 3. **Activities:** people outdoors by a lake or on a forest
trail at golden hour.

Use the third onboarding image (people running beside a lake at sunset)
as the preferred reference for the app's outdoor/activity imagery. Keep
imagery edge-to-edge where it adds emotion, but preserve readable areas
for UI text.

Do not bake headlines, buttons, logos, or interface labels into images.
Render all UI text as real text.

## 3. Color Tokens

Use these exact base tokens unless a documented accessibility or
platform constraint requires a small adjustment.

  -----------------------------------------------------------------------
  Token                   Hex                     Primary use
  ----------------------- ----------------------- -----------------------
  `primary`               `#252D35`               Primary buttons,
                                                  navigation emphasis,
                                                  dark panels

  `accent`                `#EAA16F`               Primary CTA highlights,
                                                  selected emphasis,
                                                  event accents

  `secondary`             `#729A8B`               Activity/category
                                                  accents, secondary
                                                  states

  `info`                  `#7095B5`               Informational accents,
                                                  links, culture or
                                                  general information

  `background`            `#F6F1E8`               Main app background

  `surface`               `#FFFFFF`               Cards, sheets, dialogs,
                                                  elevated surfaces

  `text`                  `#283533`               Main text on light
                                                  backgrounds

  `textSecondary`         `#64736C`               Supporting text and
                                                  metadata

  `border`                `#E5E0D8`               Subtle dividers, card
                                                  outlines, input borders

  `overlay`               `#111820`               Image overlays and dark
                                                  gradients

  `success`               `#477B65`               Success states,
                                                  confirmation

  `error`                 `#B84C43`               Errors and destructive
                                                  actions
  -----------------------------------------------------------------------

### Color rules

-   The overall interface should be **neutral first**. Use `primary`,
    `background`, and `surface` for most of the UI.
-   Use `accent` intentionally for the most important action on a
    screen; do not turn every icon or label orange.
-   Use `secondary` and `info` as accents, not as large competing brand
    colors.
-   Category chips may use lightly tinted backgrounds derived from the
    category color with dark readable text.
-   Use `primary` or `text` for text on the accent color. Never assume
    white text on `accent` will have sufficient contrast.
-   Do not use `textSecondary` for small text if contrast is
    insufficient; use `text` or a darker variant.
-   Dark image overlays may use a vertical gradient from transparent to
    `overlay` to support white text.

## 4. Typography

Use the platform's native sans-serif system font by default (SF Pro on
iOS, Roboto on Android) unless the project already has a defined
typeface.

Suggested type scale: - **Large hero title:** 32--36 px, bold,
line-height 1.05--1.15 - **Screen title:** 26--30 px, semibold/bold -
**Section heading:** 18--22 px, semibold - **Card title:** 16--18 px,
semibold - **Body:** 15--17 px, regular, line-height 1.35--1.5 -
**Supporting text:** 13--14 px - **Metadata / labels:** 12--13 px,
medium

Rules: - Keep titles short and specific. - Avoid overly tight line
spacing in body copy. - Use sentence case, not all caps, for ordinary UI
labels. - Event names should be easy to scan and should not be truncated
when the layout can reasonably accommodate two lines. - Dates, times,
locations, and price should have a clear visual hierarchy.

## 5. Layout, Spacing, and Shape

Use a consistent 4 px spacing system. Prefer values from this scale:
`4, 8, 12, 16, 20, 24, 32, 40, 48`.

-   Screen horizontal padding: 20 px on standard mobile screens; 16 px
    is acceptable on compact devices.
-   Space between major sections: 24--32 px.
-   Space inside cards: 12--16 px.
-   Space between related controls: 8--12 px.
-   Minimum touch target: 44 × 44 px.
-   Card corner radius: 16--20 px.
-   Buttons and search fields: 12--16 px radius.
-   Chips: fully rounded / pill-shaped.
-   Use subtle borders and restrained shadows. Avoid heavy shadows,
    thick outlines, and excessive glassmorphism.
-   Respect safe areas and keep important controls clear of device
    edges.
-   The layout must adapt to different screen sizes, dynamic text sizes,
    and accessibility settings.

## 6. Photography and Image Treatment

Photography is a core part of the product identity.

-   Prefer authentic, location-oriented imagery with natural light and a
    cinematic golden-hour feel.
-   Favor warm sunset highlights balanced by cool blue-grey shadows and
    natural greens.
-   Use large images for onboarding and event detail headers; use
    cropped thumbnails for list cards.
-   Keep subjects and important details away from areas where text or
    buttons will sit.
-   Add a dark gradient behind white text on image-led cards or headers.
-   Use a consistent image aspect ratio within each component type.
-   Crop images intentionally with `cover`; do not stretch them.
-   Provide loading placeholders and graceful fallbacks for missing
    images.
-   Do not rely on image color alone to communicate category or event
    status.
-   Avoid placing small, dense text directly over busy photography.

## 7. Navigation and Information Architecture

Use a five-item bottom navigation on the main app:

1.  **Home** --- personalized discovery and featured events.
2.  **Search** --- search and filter events.
3.  **Events** --- a broader browse/calendar view or event discovery
    hub.
4.  **Saved** --- saved events and user-created lists.
5.  **Profile** --- preferences, tickets, notifications, and settings.

Navigation rules: - Use simple, recognizable outline icons with
consistent stroke weight. - Pair icons with short labels. - The active
tab should use `primary` and a clear selected state; inactive items
should be muted. - Keep bottom navigation consistent across main
screens. - Hide bottom navigation only on focused flows where it would
distract, such as onboarding or a full-screen ticket view. - Do not use
color as the only active-state signal.

## 8. Core Screens

### 8.1 Onboarding

The reference image shows three editorial slides (discover, culture,
together). That sequence is wrong for this app. Keep a four-screen
photo carousel, but the steps stay:

**Screen 1 --- Intro** - Full-bleed photo. - Heading: "Experience more,
locally." - Supporting copy: "Music, concerts and unique events near
you." - CTA: "Continue". This only advances. It does not request a
permission.

**Screen 2 --- Notifications** - Full-bleed photo. - Heading: "Stay in
the loop." - Supporting copy explains that notifications are for new
events that match the user's interests. - CTA: "Activate" creates the
anonymous device identity when secure storage has none
(`POST /identities`), requests notification permission, then registers
the push token on that device. - Secondary action: "Skip" records the
choice as skipped and advances. A later reminder can ask again.

**Screen 3 --- Location** - Full-bleed photo. - Heading: "Find what's
nearby." - Supporting copy explains nearby events and venue check-in. -
CTA: "Activate" requests foreground location permission, then advances.
- Secondary action: "Skip" records the choice as skipped and advances.

**Screen 4 --- First area** - Full-bleed photo. - Heading: "Your first
area." - If location was granted, read one foreground fix and put the
place name (covering region, otherwise the device geocoder) in a text
field. Editing that text disables Continue and opens an autocomplete
list. Continue is enabled again when a suggestion is picked, or when the
text fully matches one suggestion. - If location was not granted, the
same field starts empty for search. A chosen place uses that geocoded
point as the center. - The user picks a radius (5, 25, 50, or 100 km).
"Continue" saves that circle as their first area and stores its id as
the selected discovery area. - If the account already has a saved area, this
step is skipped and the earliest saved area is the selected discovery
area. - "Skip" finishes onboarding without an area
and counts as dismissing the save-area prompt, so that prompt stays quiet
for 7 days near this place.

Onboarding rules: - Use full-bleed photography with a dark lower
gradient. - Place copy in the lower third, with enough contrast and
spacing. - Use small, clear page indicators. - Keep the CTA anchored
consistently near the bottom, above the safe area. - Show this carousel
when onboarding is unfinished, and when secure storage has no device
identity. - Skipping a permission is allowed. Do not finish the intro by
skipping both permissions at once. - Do not force account creation
before users can explore. The anonymous device is created here, before
the notification prompt.

### 8.2 Home / Discover

Purpose: make it easy to find something appealing with minimal effort.

Recommended order: 1. Greeting or concise screen title. 2. Current
location selector. 3. Search field. 4. Horizontal category shortcuts: Music, Sports, Culture, Family,
Holidays, and Other. A control under the shortcuts opens those groups,
and each group expands to its tags. The chosen tags stay on the device. 5. Featured
event card. 6. "Popular right now": a grid of three rows and two or
three columns, filled from nearby events people have saved or marked
coming (`sort=popular`, up to nine). Each tile is only a photo and
a date, and opens that event. The section stays hidden when none
qualify. "See all" opens the wider list. 7. "This
weekend" or date-based collections. 8. Optional personalized
recommendations.

Event card content: - Image thumbnail or image-led card. - Event
title. - Date and time. - Venue or neighborhood. - Price or "Free", when
known. - One or two category chips. - Save/favorite control.

Avoid showing too much information on the home screen. Prioritize a few
strong recommendations and clear paths into search.

### 8.3 Search and Filters

Search should be fast, forgiving, and easy to refine.

Include: - Prominent search field with a clear button. - Search across
event title, venue, organizer, category, and location where supported. -
Filter chips or a filter sheet for date, category, distance/location,
price, and event type. - Sort options such as relevance, soonest, and
distance when location data is available. - Recent searches and useful
empty states. - A clear "Reset filters" action.

Search results should use compact, consistent event rows with a
thumbnail, title, date, venue, price, category, and save action. Make
selected filters visibly active. Do not imply that location or distance
is available unless the app has permission and data to calculate it.

### 8.4 Event Details

The event detail screen should answer: what is it, when is it, where is
it, what does it cost, and how do I attend?

Recommended structure: 1. Large hero image with back, save, and share
controls, and a date box on the photo just above the detail card.
2. Event title with the overflow menu beside it, then category chips.
3. Date and time. Then "Your plan": Interested (the save) and I'm coming,
as two pills. A selected pill is filled dark. The line under them says
the answer can be changed anytime. 4. Venue
and location, with a map preview or directions action where supported.
5. Price or admission details. 6. Description and accessibility
information, if available. 7. Organizer information. 8. Primary action:
"Get tickets", "Register", "Book", or "More information", depending on
the event.

Rules: - Use a persistent bottom CTA when the main action should remain
accessible. - Clearly distinguish external ticket links from in-app
actions. - Do not fabricate availability, prices, venue details, or
event data. - Show the event's local date and time clearly. - Make
saving and unsaving an event immediate and reversible. Interested is
that save. I'm coming is separate, and both can be on at once.

### 8.5 Saved Events

Include: - A clear "Saved events" title. - Optional tabs for saved
events and custom lists. - Consistent event rows with date, title,
venue, and category. - Empty state explaining how to save events, with a
CTA back to discovery. - Optional reminders or calendar actions only
when supported.

Saving should be available from event cards, search results, and event
details. Keep saved state synchronized across screens.

### 8.6 Profile and Preferences

Include: - Profile summary, if the user has signed in. - Rows for
favorite categories and notifications. Each row shows a count badge and
opens its own screen. Tickets and registration stay out of the list for
now. Saved events and lists stay on the Saved tab. Quiet hours are on
the notifications screen. Location stays on the preferences screen
opened from Home. A separate developer section on Profile resets this
device.

Account creation should be optional for basic browsing. Explain the
value of signing in when users want cross-device sync or personalized
features.

## 9. Components and States

Build reusable components rather than one-off screen implementations.

Recommended components: - `PrimaryButton`, `SecondaryButton`,
`IconButton` - `SearchField` - `CategoryChip` - `CategoryShortcut` -
`EventCard` - `EventListItem` - `DateBadge` - `SaveButton` -
`FilterChip` and `FilterSheet` - `SectionHeader` - `EmptyState` -
`LoadingSkeleton` - `ErrorState` - `BottomNavigation` -
`LocationSelector`

Every interactive component should support relevant states: - Default -
Pressed - Selected / active - Disabled - Loading - Error, where
applicable

Interaction rules: - Buttons must show clear feedback when pressed. -
Save controls should immediately reflect the new state. - Use accessible
labels for icon-only buttons. - Show skeletons or loading indicators
while content loads. - Provide useful error and empty states with a
clear next action. - Avoid decorative controls that appear interactive
but do nothing.

## 10. Icons and Category Styling

Use one consistent icon family, such as Lucide, with matching stroke
width and size.

Suggested categories: - Music: warm coral tint. - Theatre / Culture:
muted blue tint. - Fitness / Outdoors: muted sage tint. - Museums:
neutral blue or sage tint. - Food & Drink: warm sand or coral tint.

Category colors are secondary visual cues only. Always include a
readable text label.

## 11. Accessibility

-   Aim for WCAG AA contrast for text and controls.
-   Ensure touch targets are at least 44 × 44 px.
-   Support dynamic text sizes and screen readers.
-   Give meaningful accessibility labels to icon-only buttons and images
    when informative.
-   Mark decorative images as decorative for assistive technology.
-   Do not communicate state using color alone.
-   Avoid text over high-detail image regions without a gradient or
    solid backing.
-   Respect reduced-motion settings.
-   Make focus and selection states visible.

## 12. Motion and Interaction

Keep motion purposeful and restrained: - Use subtle transitions between
onboarding slides. - Use short, smooth transitions for opening filters,
sheets, and details. - Provide immediate visual feedback for saving an
event. - Avoid excessive parallax, bouncing, or continuous animation. -
Respect reduced-motion settings and avoid making essential information
dependent on animation.

## 13. Content and Localization

The initial UI language may be Swedish, but all interface strings should
be centralized for localization.

-   Use concise, friendly language.
-   Prefer sentence case.
-   Display dates and times in the user's locale.
-   Keep event metadata consistent across cards and detail pages.
-   Avoid hardcoding strings directly into reusable components.
-   Use realistic sample content during prototyping, but clearly
    separate mock data from production data.

## 14. Responsive Behavior and Platform Conventions

-   Design mobile-first, with particular care for iOS safe areas and
    bottom navigation.
-   Respect native status bars, keyboard behavior, and platform
    navigation expectations.
-   Ensure search fields remain usable when the keyboard is open.
-   On larger screens, use wider content layouts without stretching
    cards excessively.
-   Keep touch controls comfortably spaced.
-   Do not make core information dependent on hover.

## 15. Engineering Guidance for Claude

When implementing this design: 1. Inspect the existing project structure
and conventions before changing code. 2. Reuse the project's current
framework, routing, state management, and styling approach unless there
is a clear reason to change them. 3. Create centralized design tokens
for colors, typography, spacing, radii, and shadows. 4. Build shared
components for repeated patterns, especially event cards, chips, save
controls, search, and navigation. 5. Keep business logic separate from
presentation where practical. 6. Use semantic, accessible controls and
real text rather than text embedded in images. 7. Use mock data only
where APIs or backend data are not available, and keep it easy to
replace. 8. Ensure all visible controls have meaningful behavior, or
clearly mark them as placeholders during prototyping. 9. Check loading,
empty, error, selected, and disabled states---not only the happy path.
10. Verify the layout on small and large mobile screens and check
contrast before considering a screen complete.

## 16. Definition of Done

A screen is considered complete when: - It follows the color,
typography, spacing, and shape tokens. - Its primary action is visually
obvious. - Text and controls have sufficient contrast. - Images are
well-cropped and do not obscure content. - Interactive elements provide
feedback and have meaningful behavior. - Loading, empty, and error
states are considered. - Layout respects safe areas and supports smaller
screens. - Repeated patterns use shared components rather than
duplicated styles.

## 17. Design Summary

The app should look like a modern local discovery product:
photography-led, warm, calm, and easy to use. Use **Midnight Slate
`#252D35`** as the main dark neutral, **Sunset Coral `#EAA16F`** as the
key action accent, **Warm Sand `#F6F1E8`** as the primary background,
and muted sage and lake blue for secondary accents. Let authentic event
photography create the emotional appeal; keep the interface itself
simple, readable, and consistent.
