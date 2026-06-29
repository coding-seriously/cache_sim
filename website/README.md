# Website Cache Visualizer

This folder contains a small web app that:

1. Accepts C++ source code input
2. Compiles it with `g++`
3. Runs the binary through Intel Pin using your pintool (`memtrace2.so`)
4. Reads `memtrace.out`
5. Compiles and runs `cache_sim`
6. Animates cache events in the browser

## Files

- `server.js`: HTTP server + `/api/run` endpoint for command execution
- `index.html`: UI
- `styles.css`: styling and animation colors
- `app.js`: frontend pipeline calls + cache event animation

## Run

From project root:

```bash
cd website
node server.js
```

Open:

```text
http://127.0.0.1:8080
```

## Turn Off And Relaunch Server

Use these commands from the `website` directory.

### Go to website directory

```bash
cd /home/sqln/Documents/Project_cs204/website
```

### Stop server

```bash
fuser -k 8080/tcp
```

### Relaunch (foreground)

```bash
node server.js
```

Use this mode when you want to see live logs in terminal. Press `Ctrl+C` to stop.

### Relaunch (background / detached)

```bash
fuser -k 8080/tcp || true
nohup node server.js > server.log 2>&1 &
```

### Check server status

```bash
ss -ltnp '( sport = :8080 )'
curl -I --max-time 3 http://127.0.0.1:8080
```

If the server is running, `ss` shows a listening `node` process and `curl` returns an HTTP response.

### Common error: EADDRINUSE

If you see `EADDRINUSE: address already in use 0.0.0.0:8080`, run:

```bash
fuser -k 8080/tcp
node server.js
```

## Pin configuration

Provide either:

- Pin path and pintool `.so` path in the UI, or
- Environment variables before startup:

```bash
export PIN_PATH=/opt/pin/pin
export PIN_TOOL_SO=/absolute/path/to/memtrace2.so
```

## Animation semantics

- Entry (inserted line): green flash
- Exit (evicted line): red flash
- Write-back (dirty eviction): yellow flash

The animation is processed line-by-line from normalized trace content.
