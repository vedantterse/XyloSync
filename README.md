# XyloSync

Self-hosted, real-time file sharing rooms. Create a room, share its 5-digit code, and every file
dropped in shows up on every connected phone and laptop the moment the upload finishes — with a
live chat beside it, no accounts, and no third-party services. Everything runs locally in one
Docker Compose stack.

## Quick start

You only need [Docker](https://docs.docker.com/get-docker/) with Compose v2 (Docker Desktop on
Windows/macOS includes it).

```bash
git clone https://github.com/vedantterse/XyloSync.git
cd XyloSync
docker compose up -d --build
```

That's it. The first run builds the app image and pulls Redis, MinIO and Mailpit, which takes a
minute or two. Then open:

| What              | URL                    | Notes |
| ----------------- | ---------------------- | ----- |
| **XyloSync**      | http://localhost:3000  | The app |
| Mailpit inbox     | http://localhost:8025  | Every email XyloSync sends lands here |
| MinIO console     | http://localhost:9101  | Browse stored files (`xylosync` / `xylosync-secret`) |

No `.env` file is needed — every setting has a working default. To change something, copy the
example and edit it:

```bash
cp .env.example .env
```

### Everyday commands

```bash
docker compose ps                  # what's running and healthy
docker compose logs -f app worker  # follow the app and background worker logs
docker compose down                # stop everything (your data is kept)
docker compose down -v             # stop and delete all data (rooms, files, chat)
docker compose up -d --build       # rebuild after pulling new code
```

To try it with two people on one machine, open the app in a normal window and in a private/incognito
window — each gets its own identity. Other devices on your network can use
`http://<your-computer's-IP>:3000`.

## What it does

- **Rooms** — create a room and share its 5-digit code or invite link. Each person can own 3 rooms
  at a time; at the limit, "Create a room" opens your rooms so you can open or delete one.
- **Live everywhere** — uploads, deletions, chat and who's online reach every open screen instantly,
  without refreshing.
- **Streamed uploads** — files up to 15 MB each (`MAX_FILE_MB`) stream straight from the browser
  into object storage; nothing is held in memory. Bigger files are refused before upload starts. Downloads stream back with resume support.
- **Room chat** — a hideable chat column with replies, reactions (one per person), edits, deletes,
  typing indicators, unread counts and swipe-to-reply on phones.
- **Private rooms** — switch on "Private room" when creating one. Visitors wait until the owner
  admits them, must choose their own name, and can't take a name already used in the room (any
  letter case). The owner can admit, deny or remove people; a removed person loses access instantly
  and has to ask again.
- **Names stay in sync** — when someone changes their name it updates everywhere: chat history,
  reply quotes, files, the people list and the room's owner line.
- **Rooms expire** — every room deletes itself, with its files, chat and members, 8 hours after it
  was created (configurable). The room shows a countdown and warns 15 minutes before.
- **Email** — send files to up to 5 people as one ZIP: pick files already in the room, upload new
  ones, or both. You're told live when it has been delivered.
- **Notes, previews and more** — save text notes to the room, preview images, video, audio, PDFs and
  text, download a room as a ZIP, paste screenshots with Ctrl+V, drag and drop anywhere, keyboard
  shortcuts (`U` upload, `/` search, `C` chat), light and dark themes, and a phone layout.

## Configuration

All settings live in `.env` (see [.env.example](.env.example)). The most useful ones:

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_PORT` | `3000` | Port the app is served on |
| `APP_SECRET` | dev value | Signs identity cookies. **Change it** for anything beyond your own machine (changing it resets everyone's identity) |
| `WEBHOOK_SECRET` | dev value | Shared by MinIO and the app. **Change it** too |
| `MAX_ROOMS_PER_USER` | `3` | Rooms each person can own at once |
| `ROOM_TTL_HOURS` | `8` | Hours until a room deletes itself; `0` keeps rooms forever |
| `MAX_FILE_MB` | `15` | Largest single upload, in MB (also enforced by Caddy in production) |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `xylosync` / `xylosync-secret` | Storage credentials |
| `MINIO_CONSOLE_PORT` | `9101` | Port for the MinIO console |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | Mailpit | Where email is sent |
| `MAIL_FROM` | `XyloSync <no-reply@xylosync.local>` | Sender shown on emails |
| `LOG_WEBHOOKS` | `false` | Log every storage event (debugging) |

After editing `.env`, apply it with `docker compose up -d`.

### Sending real email

By default email goes to the local Mailpit inbox so nothing leaves your machine. To deliver real
email, point the SMTP settings at your provider and set a sender it accepts:

```dotenv
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password
MAIL_FROM=XyloSync <files@your-domain.com>
```

## How it works

```
browser ──HTTP + WebSocket──▶ app (Express + Socket.IO) ──▶ MinIO   (files)
                                 ▲        │
                                 │        └──────▶ Redis   (rooms, chat, queue)
   MinIO webhook: file added ────┘                   ▲
   or removed                               worker ──┘  (email, room clean-up, expiry)
```

| Service   | Role |
| --------- | ---- |
| `app`     | The website, the API, real-time updates over Socket.IO, and the endpoint MinIO notifies |
| `worker`  | Background jobs: zipping and sending email, deleting rooms' files, expiring rooms |
| `redis`   | Rooms, members and waiting lists, chat history, rate limits, the job queue, real-time fan-out |
| `minio`   | Object storage for room files and email attachments |
| `mailpit` | Local mail server with a web inbox |

**Live updates:** MinIO calls the app's webhook whenever a file is created or removed in a room, and
the app pushes that to everyone in the room over Socket.IO. Because it's driven by storage events,
files added any way — the app, the API or the MinIO console — appear for everyone.

**Identity:** visitors get an anonymous identity (a random name they can change) in a signed,
httpOnly cookie, so it can't be edited to impersonate someone else or a room owner. Every room
action is checked on the server, and failed room-code guesses are rate-limited.

## Tests

End-to-end tests run real Chromium (a desktop and a phone profile) against the running stack:

```bash
docker compose up -d --build
docker compose --profile test run --rm e2e
```

They cover live file sync between two people, the chat (send, reply, react, edit, delete, typing,
unread), hiding the chat, room deletion and the room limit, email delivery checked in Mailpit, name
changes reaching every screen, and private rooms: name rules, admit, deny, remove — including every
way back in after being removed (HTTP routes, old and new sockets, email, re-requests and forged
cookies). `e2e/tests/visual.spec.js` also saves screenshots of every main screen to
`e2e/screenshots/` for design review.

## API

Every endpoint uses the identity cookie set on the first visit. Chat sending, editing and reactions
go over Socket.IO.

| Method | Path | Description |
| --- | --- | --- |
| GET / PATCH | `/api/me` | Current identity / change name `{ name }` |
| GET / POST | `/api/rooms` | Rooms you own / create one `{ requiresApproval }` |
| GET / DELETE | `/api/rooms/:code` | Room info and your access / delete (owner) |
| PATCH | `/api/rooms/:code/me` | Change your name inside a private room |
| POST / DELETE | `/api/rooms/:code/requests` (`/me`) | Ask to join a private room `{ name }` / cancel |
| GET | `/api/rooms/:code/requests` | Waiting list (owner) |
| POST | `/api/rooms/:code/requests/:id/admit` · `/deny` | Decide on a request (owner) |
| GET / DELETE | `/api/rooms/:code/members` (`/:id`) | Admitted people / remove someone (owner) |
| GET | `/api/rooms/:code/messages?before=` | Chat history |
| GET / POST | `/api/rooms/:code/files` | List files / upload (raw body, `X-File-Name` URI-encoded, `X-File-Type`) |
| GET / DELETE | `/api/rooms/:code/files/:name` | Download (`?inline=1` to preview) / delete (owner) |
| POST | `/api/rooms/:code/notes` | Save a note `{ name?, content }` |
| GET | `/api/rooms/:code/archive` | The whole room as a ZIP |
| PUT | `/api/mail/drafts/:draftId/files` | Upload an email attachment (raw body) |
| POST | `/api/mail/send` | `{ recipients[], message?, draftId?, roomCode?, roomFiles?[] }` |

## Deploying

Production runs on one small VM behind Caddy (automatic HTTPS). Every push to `main` is tested,
built into an image by GitHub Actions and deployed over SSH, with automatic and one-click rollback.
Step-by-step guide for Azure and `xylosync.in`: [deploy/README.md](deploy/README.md).

## Project layout

```
server/        Express app, Socket.IO, storage, chat, rooms, background worker
public/        The website: index.html (landing), room.html, css/, js/
e2e/           Playwright end-to-end tests
deploy/        Production: compose file, Caddyfile, deploy/rollback/setup scripts, guide
.github/       GitHub Actions workflow: test, build, push, deploy
Dockerfile     Image for the app and the worker
docker-compose.yml
```

## Development without Docker for the app

Run the services in Docker and the app on your machine with live reload (Node 20+):

```bash
docker compose up -d redis minio mailpit
npm install
REDIS_URL=redis://localhost:6379 MINIO_ENDPOINT=localhost SMTP_HOST=localhost npm run dev
```

For this, publish MinIO's API port (`9000`) and Mailpit's SMTP port (`1025`) in
`docker-compose.yml`, and point `MINIO_NOTIFY_WEBHOOK_ENDPOINT_XYLOSYNC` at
`http://host.docker.internal:3000/webhooks/storage` so live updates reach your local app.

## Troubleshooting

- **A port is already in use** — another program is using 3000, 8025 or 9101. Set `APP_PORT`,
  `MAILPIT_PORT` or `MINIO_CONSOLE_PORT` in `.env`, then `docker compose up -d`.
- **Files don't appear live** — check `docker compose logs app` for `bucket events ->`; set
  `LOG_WEBHOOKS=true` to see every storage event.
- **About the MinIO image** — the official `minio/minio` image is no longer published on Docker Hub,
  so the stack uses Chainguard's maintained build (`cgr.dev/chainguard/minio`). Any MinIO-compatible
  image works.
