# Slack Daily Update

Eenvoudige lokale webapp om je dagelijkse Slack update te schrijven en direct
te versturen. Je typt een lijst met werkzaamheden, klikt op **Send to Slack**,
en de app zet dit automatisch om naar Slack mrkdwn en post het bericht in het
geconfigureerde kanaal — via Socket Mode, dus zonder publieke webhook.

## Tech stack

- Node.js + Express (serveert frontend en API)
- @slack/bolt in Socket Mode (authenticatie + verbinding)
- Slack Web API (`chat.postMessage`) voor het daadwerkelijk versturen
- Vanilla HTML/CSS/JS voor de frontend, geen frameworks, geen build tools

## Projectstructuur

```
project/
│
├── server.js
├── package.json
├── .env.example
├── manifest.yaml
├── README.md
│
└── public/
    ├── index.html
    ├── styles.css
    └── script.js
```

---

## 1. Installatie

```bash
npm install
```

## 2. Environment variabelen

```bash
cp .env.example .env
```

Je moet daarna 4 waarden invullen: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`,
`SLACK_CHANNEL_ID` en `SLACK_USERGROUP_ID`. Hieronder staat stap voor stap
hoe je aan elke waarde komt.

---

## 3. Slack App aanmaken

1. Ga naar [https://api.slack.com/apps](https://api.slack.com/apps).
2. Klik op **Create New App**.
3. Kies **From an app manifest**.
4. Selecteer je workspace.
5. Plak de inhoud van `manifest.yaml` (uit dit project) in het manifest-veld.
6. Klik op **Next** en daarna op **Create**.

De app heeft nu automatisch de juiste bot-configuratie, scopes en Socket
Mode-instellingen, omdat dit allemaal al in het manifest staat.

## 4. Manifest importeren

Dit gebeurt al tijdens het aanmaken van de app in stap 3. Wil je het manifest
later aanpassen, ga dan naar **Settings → App Manifest** in het linkermenu
van je Slack app, pas de YAML aan en klik op **Save Changes**.

## 5. OAuth scopes

Het manifest configureert automatisch de volgende (minimale) bot-scope:

| Scope | Waarom nodig |
|---|---|
| `chat:write` | Om berichten te posten in het geconfigureerde kanaal via `chat.postMessage`. Dit is de enige actie die de app uitvoert. |

Er zijn bewust géén `users:read` of `usergroups:read` scopes toegevoegd: de
usergroup-mention wordt via een environment variable ingesteld, niet
dynamisch opgezocht via de Slack API.

## 6. App installeren (OAuth)

1. Ga in je Slack app naar **OAuth & Permissions** in het linkermenu.
2. Klik bovenaan op **Install to Workspace** (of **Reinstall to Workspace**
   als je later scopes wijzigt).
3. Bevestig de permissies op het toestemmingsscherm.
4. Je komt terug op de **OAuth & Permissions** pagina. Bovenaan staat nu de
   **Bot User OAuth Token**, beginnend met `xoxb-`.
5. Kopieer deze waarde naar `SLACK_BOT_TOKEN` in je `.env`.

## 7. Socket Mode inschakelen

1. Ga naar **Socket Mode** in het linkermenu van je Slack app.
2. Zet de toggle **Enable Socket Mode** aan.
3. Slack vraagt je direct om een App-Level Token aan te maken (zie stap 8) —
   dit hoort bij het inschakelen van Socket Mode.

Dit staat overigens ook al goed gezet via `manifest.yaml`
(`socket_mode_enabled: true`), maar controleer dit voor de zekerheid.

## 8. App-Level Token aanmaken

1. Ga naar **Basic Information** in het linkermenu.
2. Scroll naar **App-Level Tokens** en klik op **Generate Token and Scopes**.
3. Geef de token een naam, bijvoorbeeld `socket-mode-token`.
4. Voeg de scope **`connections:write`** toe (dit is de enige scope die een
   App-Level Token nodig heeft om Socket Mode te laten werken).
5. Klik op **Generate**.
6. Kopieer de token, beginnend met `xapp-`.
7. Plak deze in `SLACK_APP_TOKEN` in je `.env`.

## 9. Bot Token vinden (indien je hem kwijt bent)

Ga naar **OAuth & Permissions** in het linkermenu van je Slack app. De
**Bot User OAuth Token** (`xoxb-...`) staat daar altijd bovenaan zolang de
app geïnstalleerd is.

## 10. Channel ID vinden

1. Open het gewenste kanaal in Slack (desktop of web).
2. Klik op de kanaalnaam bovenaan om het kanaal-detailvenster te openen.
3. Scroll helemaal naar onderen — de **Channel ID** (bijvoorbeeld
   `C0123456789`) staat onderaan dit venster.
4. Kopieer deze naar `SLACK_CHANNEL_ID` in je `.env`.

> Let op: zorg dat je bot ook daadwerkelijk in dit kanaal aanwezig is
> (`/invite @daily-update-bot` in het kanaal), anders krijg je een
> `not_in_channel` fout bij het versturen.

## 11. Usergroup ID vinden

1. Ga in Slack naar **People & user groups** (via het zijmenu of de
   werkbalk-zoekfunctie).
2. Open het tabblad **User groups** en klik op de gewenste groep
   (bijvoorbeeld `@matthias-day`).
3. De ID (beginnend met `S`, bijvoorbeeld `S0AK8LYJ8FR`) is te vinden via de
   Slack API-methode `usergroups.list`, of via de URL wanneer je de
   groepsdetails opent in de browserversie van Slack.
4. Kopieer deze naar `SLACK_USERGROUP_ID` in je `.env`.

---

## 12. Applicatie starten

```bash
npm start
```

Je ziet in de terminal:

```
⚡️ Slack Bolt app draait in Socket Mode
🚀 Server draait op http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) in je browser.

---

## Gebruik

- Typ je werkzaamheden in de textarea. Regels zonder inspringing zijn
  hoofdpunten, regels met minimaal twee spaties of een tab zijn subpunten:

  ```
  Fixed authentication bug
    Added logging
    Added tests
  Updated dashboard
    Faster loading
    Fixed CSS
  ```

- Je concept wordt automatisch opgeslagen in `localStorage` tijdens het
  typen, en hersteld wanneer je de pagina opnieuw opent.
- Klik op **Send to Slack**, of gebruik **Ctrl+Enter**, om te versturen.
- Na succesvol versturen worden de textarea en `localStorage` geleegd.
- Bij een fout blijft je tekst behouden en zie je een duidelijke foutmelding.

Het uiteindelijke Slack-bericht ziet er zo uit:

```
<!subteam^S0AK8LYJ8FR> today:

- Fixed authentication bug
  - Added logging
  - Added tests
- Updated dashboard
  - Faster loading
  - Fixed CSS

_I'm ooo, so I won't read y'alls reactions, but I will read them once my vacation is ended! - join this usergroup using '/se group join @matthias-day' - see y'all later!_
```

---

## Troubleshooting

**`❌ Ontbrekende environment variable: ...`**
Je `.env` bestand mist een verplichte waarde. Controleer of alle 4 de
variabelen uit `.env.example` zijn ingevuld in je eigen `.env`.

**`not_in_channel` fout bij versturen**
De bot is nog niet lid van het kanaal. Ga naar het kanaal in Slack en typ
`/invite @jouw-bot-naam`, of voeg de bot toe via de kanaal-instellingen.

**`invalid_auth` of `not_authed` fout**
De `SLACK_BOT_TOKEN` is ongeldig of verlopen. Herinstalleer de app via
**OAuth & Permissions → Reinstall to Workspace** en kopieer de nieuwe token.

**App start niet / Socket Mode verbindt niet**
Controleer of `SLACK_APP_TOKEN` daadwerkelijk begint met `xapp-` en de scope
`connections:write` heeft, en of **Enable Socket Mode** aanstaat onder
**Socket Mode** in de Slack app-instellingen.

**`channel_not_found` fout**
Controleer of `SLACK_CHANNEL_ID` de juiste Channel ID is (begint met `C`),
niet de kanaalnaam zelf.

**Lijst in Slack toont geen inspringing**
Zorg dat je in de textarea subpunten laat beginnen met minimaal twee spaties
of een tab. Slack zelf verwacht in de uiteindelijke opmaak exact twee
spaties vóór het `-` teken; dit wordt automatisch door de server geregeld.

**Poort al in gebruik**
Wijzig `PORT` in je `.env` naar een andere waarde, bijvoorbeeld `3001`.
