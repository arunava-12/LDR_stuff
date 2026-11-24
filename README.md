# Miles Apart, Still Us ♥
A Next.js multiplayer wrapper around the uploaded LDR aesthetic showcase. It keeps the original nine experiences and relays game actions, tab changes, personalized inputs, Wordle keys, and scrapbook Polaroid positions between two browsers using Supabase Realtime Broadcast + Presence.

## 1. Requirements
- Node.js 20.9+ (Node 22/24 recommended)
- A free Supabase project
- Two browsers/devices

## 2. Supabase setup
1. Create a project at https://supabase.com/dashboard.
2. Open **Project Settings → API** (or the project's Connect dialog).
3. Copy the **Project URL** and **publishable key**.
4. In the project dashboard, make sure **Realtime** is enabled.
5. Create `.env.local` in this project root using:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

The app uses public Realtime channels (no database tables or service-role key required). Room codes are the access boundary: anyone who knows a code can join, so only share the invite privately. Do not put a Supabase secret/service-role key in this file.

## 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Enter your name (Arunava), create a room, then send Susmita the invite link or room code. She opens it on her device, enters her name, and joins. Both should see the same interactions as you use the scrapbook and games.

## 4. Deploy so you can play from different networks
Deploy this folder to Vercel (or another Next.js host), add the two `NEXT_PUBLIC_SUPABASE_*` environment variables to the hosting project's environment settings, and redeploy. Share the deployed room invite URL with Susmita.

## What syncs
- Tab changes and most clickable actions across all nine tabs
- Personalization form values when applied
- Randomized actions use a shared seed so both clients get the same note/dice/game selection
- Wordle keyboard input and Polaroid drag positions
- Online presence and room status

## Notes
- Join the same room before starting a round. Broadcast is live-session messaging, not permanent game history; refreshing/rejoining starts from the local default state.
- Audio is generated locally in each browser. Each person may need to press Play once because browsers require a user gesture before audio can start.
- For privacy, use a hard-to-guess room code and don't post it publicly.


## Design update

The entry screen now uses a bespoke paper-and-ink visual system inspired by Hallmark's material-led design principles: distinctive typography, paper grain, restrained accent color, clear task hierarchy, responsive layout, visible focus states, and reduced-motion support. The Supabase room flow and original scrapbook iframe bridge are preserved.

After replacing the files, run `npm install` and `npm run dev`.
