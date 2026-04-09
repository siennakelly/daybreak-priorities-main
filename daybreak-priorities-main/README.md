# Daybreak Product Priorities — Setup Guide

## What this is
A shared, real-time product prioritization board for your leadership team.
Everyone gets the same URL. Votes and comments sync live across all users.

---

## Step 1 — Set up Supabase (your database, free)

1. Go to **supabase.com** and sign up for a free account
2. Click "New project" — name it `daybreak-priorities`, pick any region, set a password
3. Wait ~2 minutes for the project to spin up
4. In the left sidebar, click **SQL Editor**
5. Copy the entire contents of `schema.sql` and paste it into the editor — click **Run**
6. Then copy the entire contents of `seed.sql` and paste it — click **Run**
   (This loads all your existing initiatives)
7. Go to **Settings → API** in the left sidebar
8. Copy two values — you'll need them shortly:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon / public** key (long JWT string starting with `eyJ...`)

---

## Step 2 — Deploy to Vercel (your hosting, free)

### Option A — Deploy via GitHub (recommended, enables auto-updates)

1. Create a free account at **github.com** if you don't have one
2. Create a new repository called `daybreak-priorities`
3. Upload all files from this folder to the repository
   (drag and drop them into the GitHub web interface)
4. Go to **vercel.com** and sign up with your GitHub account
5. Click "Add New Project" → import your `daybreak-priorities` repository
6. Leave all settings as defaults — click **Deploy**
7. Vercel gives you a URL like `daybreak-priorities.vercel.app`
   You can set a custom domain in Vercel settings if you want

### Option B — Deploy directly (no GitHub needed)

1. Install Node.js from nodejs.org if you don't have it
2. Run in terminal: `npm install -g vercel`
3. `cd` into this folder
4. Run `vercel` and follow the prompts (sign up/log in)
5. Vercel gives you a live URL instantly

---

## Step 3 — Share with your team

1. Send your team the Vercel URL
2. Each person opens it and enters:
   - The **Supabase project URL** (from Step 1)
   - The **Supabase anon key** (from Step 1)
   - Their **name** (shown on their votes and comments)
3. These credentials are saved in each person's browser — they only enter them once

> **Tip**: Create a Notion page or shared doc with the URL and credentials
> pre-filled so your team doesn't have to type the Supabase details manually.
> The anon key is safe to share — it only allows read/write access, not admin access.

---

## Using presentation mode

Click **"Presentation mode"** in the top right before your weekly sync.

This opens a full-screen view optimized for screen sharing:
- Large stats bar showing totals
- Top 6 initiatives in a visual card grid (top-ranked has a gold border)
- Full ranked list below with phase badges, revenue impact, and vote counts
- Press **Escape** or click "Exit presentation" to return to normal view

---

## Adding new initiatives

Click **"+ Add initiative"** and fill in:
- Jira key (e.g. `DAY-2600`)
- Title, requestor, and phase
- Revenue impact (optional but useful)
- Notes / context
- Scores for Effort, Value, Importance, and Urgency
  (the formula score calculates live as you adjust)

New initiatives get a yellow "New" badge until manually edited.

---

## Voting and commenting

- Click **▲** or **▼** on any initiative to vote — your name is attached
- Click **Details** to expand an initiative and read/add comments
- Reply to specific comments inline
- Votes shift the community rank on top of the formula score
- Sort by "community rank" to see what the team thinks is most urgent

---

## Files in this project

| File | Purpose |
|---|---|
| `public/index.html` | The entire app (single file) |
| `schema.sql` | Run once in Supabase to create tables |
| `seed.sql` | Run once in Supabase to load existing initiatives |
| `vercel.json` | Tells Vercel how to route requests |
| `package.json` | Project metadata |

---

## Troubleshooting

**"Could not connect"** on first load
→ Double-check your Supabase URL and anon key. Make sure you ran `schema.sql` first.

**Changes not showing for other users**
→ Supabase realtime must be enabled. Re-run the `schema.sql` file — it includes the realtime setup.

**Blank page after deploy**
→ Make sure the `public/index.html` file is in the `public/` folder, not the root.

**Want to reset all votes and comments**
→ In Supabase SQL Editor run: `delete from votes; delete from comments;`

**Want to wipe and reload all initiatives**
→ In Supabase SQL Editor run: `delete from initiatives;` then re-run `seed.sql`
