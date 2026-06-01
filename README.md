# Eternal Return Team Picker

Offline-first prototype for recommending an Eternal Return character from the
current team composition.

The current data is hand-tagged sample data so the recommendation flow can be
tested while waiting for an official API key.

## Run

### Browser Preview

The local preview is available at:

```text
http://127.0.0.1:8765/index.html
```

If the preview is not running, start it from this folder:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

### Desktop App

Install the desktop runtime once:

```powershell
npm install
```

Then run:

```powershell
npm run app
```

Or double-click `run-app.bat`.

To create a portable Windows app for sharing:

```powershell
npm run dist
```

The shareable `.exe` will be created under `dist/`.

### Easy Windows Installer

For non-technical users, prefer a single installer file instead of a zip.

1. Install Inno Setup 6 once.
2. Build the packaged app:

```powershell
npm run package-win
```

3. Build the installer:

```powershell
npm run installer-win
```

The shareable installer will be:

```text
dist/ER-Team-Picker-Setup.exe
```

You can also double-click `build-installer.bat` after Inno Setup is installed.

## Later API Integration

When the API key is ready, add it to a local `.env` file and connect the
collector under `tools/`. The app is shaped so collected match data can replace
the sample synergy values without changing the UI.

```powershell
$env:ER_API_KEY="your-personal-key"
python tools/collector.py --season 32 --server SEOUL --team-mode 3 --rankers 20 --games-per-user 20
```

## DAK.GG Meta Data Before The Official API

Until the official API is connected, app recommendations can read aggregate meta
data from `src/metaData.js`.

- `experimentTiers`: character tier values from `https://dak.gg/er/statistics`.
- `rankerCompositionStats`: leaderboard-derived team results from `https://dak.gg/er/leaderboard`.
- `oneTrickRatio`: high one-character specialist samples are down-weighted so one-trick data does not dominate normal team recommendations.

Recommended aggregate row shape:

```js
{
  teammates: ["lenox", "hart"],
  candidate: "yuki",
  games: 18,
  avgPlacement: 2.8,
  winRate: 0.22,
  top3Rate: 0.61,
  oneTrickRatio: 0.18,
}
```

The recommender still keeps role, damage type, weapon range, and user feedback in
the score, because real teammates may not always draft around the player.

To collect DAK.GG data from the public pages/API used by the website:

```powershell
npm run collect-dak
```

Default collection uses 200 leaderboard players and 12 recent ranked squad games
per player. It caches responses under `data/dak-cache/`, so interrupted runs can
resume without refetching everything.

For a quicker test:

```powershell
node tools/dak_collector.mjs --rankers 20 --matchesPerRanker 5 --delayMs 650
```

## Skin Templates

The screenshot detector can compare multiple images per character. Put extra
skin mini images under `assets/characters/skins/<character-id>/`, then add them
to `src/skinTemplates.js`.

```js
export const skinTemplates = {
  yuki: [
    "assets/characters/skins/yuki/yuki_skin_01.png",
    "assets/characters/skins/yuki/yuki_skin_02.png",
  ],
};
```

The default mini image is always used, so only additional skin images need to be
listed here.

## Weapon Templates

The screenshot detector can also compare weapon icons when template images are
available. Put weapon icon images under `assets/weapons/`, then add them to
`src/weaponTemplates.js`.

```js
export const weaponTemplates = {
  dagger: ["assets/weapons/dagger.png"],
  two_handed_sword: ["assets/weapons/two_handed_sword.png"],
  axe: ["assets/weapons/axe.png"],
};
```

If no weapon template exists, the detector still identifies the character and
uses that character's first registered weapon as a fallback.

## Feedback And Tiers

Local feedback is grouped by tier. In a future shared backend, store one vote per
user per `tier + team composition + recommended character` key.

Recommended anti-abuse rules for a shared service:

- Require a stable login or device identity before accepting feedback.
- Allow only one active vote per user for the same tier/composition/candidate.
- Rate-limit feedback writes per account and per IP.
- Weight votes by trust, such as account age, verified API profile, or enough
  normal usage history.
- Use Bayesian smoothing so a few votes cannot swing a recommendation heavily.
- Down-weight repeated identical votes from the same device/network cluster.
- Keep raw vote logs separate from aggregate scores so suspicious batches can be
  removed later.

## Supabase Setup

1. Create a Supabase project.
2. Enable anonymous sign-ins in Authentication settings.
3. Open the SQL editor and run `supabase/schema.sql`.
4. Copy your project URL and anon public key.
5. Fill `src/supabaseConfig.js`.

```js
export const supabaseConfig = {
  url: "https://your-project.supabase.co",
  anonKey: "your-anon-public-key",
};
```

When these values are empty, the app stays in local-only mode. Never put a
service role key in the browser app.
