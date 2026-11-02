# Local AI assistant — Open WebUI + the existing `Olama` container

A ChatGPT-style interface running entirely on this machine. No cloud provider,
no API key, no public hosting. This folder is the whole deployment: the Open
WebUI application itself is used as the official published Docker image, so
none of the application source in this repository is built or modified.

## Start and stop

| Action | Do this |
| --- | --- |
| Start | Double-click **Local AI Assistant** on the desktop (or `local-ai\start-local-ai.bat`) |
| Stop | Double-click **Stop Local AI Assistant** (or `local-ai\stop-local-ai.bat`) |
| Open the UI | <http://localhost:8080> |

The start script checks Docker Desktop, starts the existing `Olama` container
if it is stopped, starts the interface, waits for it to answer, then opens the
browser. The stop script stops the interface only — Ollama keeps running
because other tools may be using it. Use `stop-local-ai.bat --with-ollama` to
stop Ollama as well.

Nothing in either script deletes a container, a volume or a model.

### First run

Open WebUI asks you to create an account on first use. It is stored locally in
the SQLite database below; it is not sent anywhere. The first account becomes
the administrator, and signup closes automatically afterwards.

## Why port 8080 and not 3000

Port 3000 on this machine is already taken by a local Node/Next.js dev server.
Binding the assistant there would make the two fight over the port. 8080 is
Open WebUI's own default port and was free.

To change it, edit `OPEN_WEBUI_PORT` in `local-ai\.env` and restart.

## How the interface reaches Ollama

The interface runs in its own container, so `localhost` inside it is *not* the
Windows host. It uses the Docker Desktop host gateway instead:

```
ai-chat-ui container ──► http://host.docker.internal:11434 ──► Olama container
```

The `Olama` container keeps its name, port, GPU access and `D:\olama` model
directory, and is deliberately not declared in `docker-compose.yml`, so
`docker compose` can never recreate it.

It was recreated once by hand, with approval, to add three settings that
cannot be changed on a running container:

| Setting | Was | Why |
| --- | --- | --- |
| `OLLAMA_KEEP_ALIVE=30m` | 5 min | Reloading a model from disk cost 33s on every pause longer than 5 minutes |
| `OLLAMA_MAX_LOADED_MODELS=1` | unset | Stops two models competing for the 4 GB of VRAM |
| `--restart unless-stopped` | `no` | It did not come back when Docker Desktop started |

The previous container was renamed `Olama-pre-keepalive` and kept (stopped) as
a rollback. Remove it once you are satisfied:

```powershell
docker rm Olama-pre-keepalive
```

That loses nothing — the models live in the `D:\olama` bind mount, not in the
container.

## Where data is stored

| Data | Location |
| --- | --- |
| Ollama models | `D:\olama\models` (unchanged) |
| Chats, folders, titles | `D:\olama\open-webui\webui.db` (SQLite) |
| Accounts and settings | `D:\olama\open-webui\webui.db` |
| Uploaded files | `D:\olama\open-webui\uploads\` |
| Document index (RAG) | `D:\olama\open-webui\vector_db\` |
| Cached helper models | `D:\olama\open-webui\cache\` |
| Session signing key | `D:\olama\open-webui\.webui_secret_key` |

All of it is a bind mount from the Windows host, so it survives container
restart, recreation and image upgrades. Upgrading is just changing
`WEBUI_DOCKER_TAG` in `.env` and starting again.

A local SQLite file is Open WebUI's native storage. No database server is
involved and nothing leaves this machine.

## Models

The model list in the interface is read live from the Ollama API, so whatever
`ollama list` shows is what the dropdown offers. Nothing is hardcoded.

All four were measured on this machine, same prompt, warm unless stated:

| Model | On GPU | Speed | Cold load | Vision | Use |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5:3b` | **100%** | **34 tok/s** | 25–33s | no | Everyday chat. The only one that fits entirely in VRAM |
| `gemma3:4b` | 55% | 10 tok/s | 83s | yes | Images, when you want them sooner |
| `gemma4:e4b` | 100%* | 7 tok/s | 105s | yes | Images, best quality |
| `qwen2.5:7b` | 45% | 6 tok/s | — | no | Harder text and code |

\* Gemma 4 E4B loads selectively, so Ollama reports a small resident size; it
is still the slowest of the four.

The ranking is decided by VRAM, not by parameter count. Only `qwen2.5:3b`
(2.2 GB) fits in the 4 GB card. `gemma3:4b` needs 2.9 GB once its vision
projector is loaded and spills to the CPU — dropping `num_ctx` to 2048 does
**not** rescue it, which was measured, not assumed.

With 4 GB of VRAM only the 3B model fits on the GPU comfortably. Larger models
run split between GPU and CPU: they work, they are just slower. Switching
models in the middle of a chat makes Ollama load the new one, which takes a
few seconds the first time.

Avoid keeping two large models loaded at once. `docker exec Olama ollama ps`
shows what is currently resident.

## Files and documents

Attach a file to a message with the **+** button, or add it to a Knowledge
collection in the Workspace for reuse across chats.

What actually happens: the text is extracted locally (PDF, DOCX, TXT, CSV,
Markdown, code), split into chunks, embedded with a small local embedding
model, and only the chunks that match your question are placed into the
prompt. The model therefore sees relevant excerpts, not the whole document —
with a 4 GB card and small models, a large PDF will never fit in context in
one go. For a short file, ask Open WebUI to use the full document instead of
retrieval (the per-file setting in the chat input).

The embedding model is downloaded at **first startup**, not on first upload,
and startup blocks until it completes. Open WebUI pulls the whole
`all-MiniLM-L6-v2` repository (every weight format, not just the one it uses),
which came to **888 MB** here, cached in `D:\olama\open-webui\cache\embedding`.
One-time cost, and it runs on the CPU so the GPU stays free for the chat model.

## Voice input

Open WebUI ships local Whisper transcription. The first time the microphone
button is used, the Whisper model (~145 MB for `base`) downloads and then runs
on the CPU. No cloud transcription, no API key.

The Qwen and Gemma models themselves do not take audio — Whisper turns speech
into text and the text goes to the model.

## Privacy

- The UI is published on `127.0.0.1` only, so it is not reachable from the LAN.
- `ENABLE_OPENAI_API=false` — no external provider can be used, even by accident.
- Telemetry off: `ANONYMIZED_TELEMETRY=false`, `DO_NOT_TRACK=true`,
  `SCARF_NO_ANALYTICS=true`, and the version update check is disabled.
- Authentication stays on, with the signing key persisted in the data folder so
  logins survive container recreation.

**One thing worth knowing:** the pre-existing `Olama` container publishes
`0.0.0.0:11434`, and the Windows firewall allows inbound Docker traffic on the
Public profile. On an untrusted Wi-Fi network, another device could reach the
Ollama API. Closing that means recreating the `Olama` container, which this
setup deliberately does not do on its own — see "Optional hardening" below.

## Optional hardening (not applied)

To keep Ollama off the LAN, both containers can talk over a private Docker
network instead of the host port:

```powershell
docker network create local-ai-net
docker network connect local-ai-net Olama          # no recreation, no data loss
```

Then set `OLLAMA_BASE_URL=http://Olama:11434` in `local-ai\.env`, add the
network to `docker-compose.yml`, and recreate `Olama` with
`-p 127.0.0.1:11434:11434` so only this machine can reach it. Recreating the
container keeps every model, because they live in the `D:\olama` bind mount —
but it is a deliberate step, so it is left to you.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Launcher says Docker is unavailable | Start Docker Desktop, wait for the whale icon to settle |
| No models in the dropdown | `docker exec Olama ollama list`, then reload the page |
| Port already in use | Change `OPEN_WEBUI_PORT` in `.env` |
| Interface will not start | `docker logs ai-chat-ui` |
| Model answers very slowly | Expected for 7B on 4 GB VRAM; use `qwen2.5:3b` |
| "Connection lost" in the UI | The browser origin must be listed in `CORS_ALLOW_ORIGIN`. `localhost` and `127.0.0.1` count as different origins — both are listed in `.env` |
| Long pause before the first words | The model unloaded after 5 minutes idle and is reloading from disk (33s for `qwen2.5:3b`, longer for Gemma). Raise **Settings → General → Advanced Parameters → Keep Alive** |

## Files in this folder

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | The interface container definition |
| `.env` | Local settings (git-ignored) |
| `.env.example` | Safe copy of the settings, no secrets |
| `start-local-ai.bat` / `.ps1` | Launcher |
| `stop-local-ai.bat` / `.ps1` | Safe stop |
| `create-desktop-shortcuts.ps1` | Re-creates the two desktop shortcuts |

## Small models and built-in tools

Open WebUI hands every model that advertises a `tools` capability the full set
of built-in tool definitions (automations, calendar, notes, code interpreter,
memory, tasks, skills). `qwen2.5:3b` advertises that capability but is far too
small to judge *when not to* call a tool, so it would answer an ordinary
question by trying to schedule an automation instead.

Automations and the calendar are therefore switched off for this install:

| Key | Value |
| --- | --- |
| `automations.enable` | `false` |
| `calendar.enable` | `false` |
| `memories.enable` | `false` |
| `code_interpreter.enable` | `false` |
| `notes.enable` | `false` |

`ui.default_models` is set to `qwen2.5:3b` so new chats start on the model that
fits entirely in the 4 GB of VRAM.

**These live in the database, not in `.env`.** Open WebUI seeds config from
environment variables only on a fresh database and then the stored value wins
("Existing DB values take precedence over defaults"), so setting
`ENABLE_AUTOMATIONS=false` in `.env` on an existing install does nothing.

Change them in **Admin Settings**, or directly:

```powershell
docker stop ai-chat-ui
docker run --rm -v "D:\olama\open-webui:/data" --entrypoint python ghcr.io/open-webui/open-webui:v0.12.4 -c "import sqlite3;c=sqlite3.connect('/data/webui.db');c.execute(\"update config set value='true' where key='automations.enable'\");c.commit()"
docker start ai-chat-ui
```

If a small model still misfires on `notes`, `code_interpreter` or `memory`,
switch those off the same way — or just use `qwen2.5:7b` for anything that
needs tools and keep `qwen2.5:3b` for plain conversation.

A backup of the database from before this change is at
`D:\olama\open-webui\webui.db.bak-before-tooltoggle`.

## Speed: what to expect

Measured on this machine with `qwen2.5:3b`:

| Situation | Time |
| --- | --- |
| Model already resident | **2.6s** for a full 80-token answer (34 tok/s, 100% GPU) |
| Model not resident | **+25-33s** while it loads from disk |

So latency is dominated by *loading*, not thinking. Three things keep it fast:

1. `OLLAMA_KEEP_ALIVE=30m` on the Ollama container — a model stays resident for
   30 minutes of idling instead of 5.
2. `PRELOAD_MODEL=qwen2.5:3b` in `.env` — the launcher runs `preload-model.ps1`
   detached at startup, so the model loads while the browser is still opening.
3. `ui.default_models=qwen2.5:3b` — new chats start on the model that fits in
   VRAM instead of one that spills to CPU.

You can warm any model by hand:

```powershell
powershell -File preload-model.ps1 -Model qwen2.5:7b
```

Switching models mid-conversation always costs one load of the new model, and
`OLLAMA_MAX_LOADED_MODELS=1` means the previous one is evicted. That is
deliberate: two models do not fit in 4 GB of VRAM.

`docker exec Olama ollama ps` shows what is resident and for how long.

## The status panel

A card-style panel is added to the interface, opened with the **Status** tab on
the middle of the right edge. It sits there rather than in a corner because
Open WebUI owns the top-right (chat controls, profile) and the bottom centre
(the message box); mid-height is the one place that never collides. The dot on
that tab is green when a model is loaded and grey when none is.

| Card | Shows |
| --- | --- |
| Environment | Ollama reachability, how many models are installed |
| Context | How much of the model's context window this chat is using, split into messages, system prompt and free space |
| GPU memory | How much of the 4 GB of VRAM the loaded model occupies, and how much spilled to system RAM |
| Active model | Which model is hot, its size and quantisation, how much is on the GPU, and a live countdown to unload |
| Installed models | Every model with its size, a purple **vision** badge where supported, and a green **loaded** badge for the hot one |
| Storage | Where chats and models live on `D:` |

### Things you can do from it

- **Click any model** in *Installed models* to load it in advance, so you do not
  wait when you switch to it. The loaded one is not clickable.
- **Unload** in *Active model* frees the VRAM immediately.
- The dot on the **Status** button pulses green while a model is hot and goes
  grey when none is, so you can tell at a glance whether the next message is
  instant or has to wait.

Two honest limits. The context figure is **estimated** at roughly four
characters per token, because the exact count is only known to the model at
generation time; treat it as a guide, not a measurement. And the GPU card
assumes 4096 MiB of VRAM — change `GPU_TOTAL_BYTES` at the top of
`ui/loader.js` if the hardware changes.

The panel is open the first time you load the app. Close it and it stays
closed — your last choice is remembered from then on. Cards collapse when
clicked and remember that too.

### How it is built

Open WebUI ships two official customisation hooks, both empty by default and
referenced from `app.html`:

```html
<script src="/static/loader.js" defer></script>
<link rel="stylesheet" href="/static/custom.css" />
```

`ui/custom.css` and `ui/loader.js` are bind-mounted onto them read-only. This
means **no fork, no image rebuild, and no application source is modified**, so
upgrading is still just a change of `WEBUI_DOCKER_TAG`.

Because they are bind mounts, editing either file and reloading the browser is
enough — the container does not need restarting.

The panel only *adds* elements and never touches Open WebUI's own DOM, so
Svelte re-renders cannot remove it, and Open WebUI branding is left intact as
`static/BRANDING.md` requires.

Live data comes from Open WebUI's own authenticated Ollama proxy
(`/ollama/api/ps` and `/ollama/api/tags`) using the browser session, so the
panel reports exactly what the chat sees. It stays hidden until you sign in.

To change the paths in the Storage card, edit `PATHS` at the top of
`ui/loader.js`. To remove the panel entirely, delete the two `ui/` mounts from
`docker-compose.yml` and restart.
