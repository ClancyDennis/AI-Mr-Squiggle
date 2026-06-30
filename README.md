# DrawAssistant

An AI Mr Squiggle-style drawing playground: draw a few marks on the canvas, ask for a playful critique, and let the assistant discover what the squiggle wants to become.

The canvas includes a toggleable normalized coordinate grid. Collaboration uses native OpenAI tool calling with a `draw_strokes` tool: the model calls the tool with stable `0..1000` x/y coordinates, the app maps those points onto the live iPad canvas, then the next loop receives updated grid-stamped vision feedback. The model can loop for up to 10 playful reveal passes or stop with a final critique.

The drawing tool now accepts native marks as well as freehand paths: `stroke`, `line`, `curve`, `ellipse`, `rectangle`, `dot`, `hatch`, `highlight`, `smudge`, and `star`. After every tool call the model receives the full updated image, a focused crop around the latest edit, and a hot-pink diff crop that repeats the newest AI marks so it can correct placement on the next pass.

## OpenAI proxy setup

Copy `.env.example` to `.env.local` and fill in your proxy details:

```bash
VITE_OPENAI_BASE_URL=https://your-proxy.example.edu/v1
VITE_OPENAI_API_KEY=your-key
VITE_OPENAI_MODEL=your-model
VITE_OPENAI_ENDPOINT_PATH=chat/completions
VITE_OPENAI_REASONING_EFFORT=auto
VITE_OPENAI_MAX_COMPLETION_TOKENS=2200
```

You can also paste these values into the API panel in the app while developing. The app supports OpenAI-compatible `chat/completions` endpoints and the newer `responses` endpoint path. Reasoning effort and max completion/output tokens are available in the main AI controls.

On a physical iPad, use a proxy URL the iPad can reach, such as `http://<your-mac-lan-ip>:4000/v1` or an HTTPS proxy. `localhost` on the device points at the device, not your Mac.

For production, prefer a proxy that keeps the real OpenAI key server-side. Browser-visible Vite env vars are public to anyone using the built app.

## Run

```bash
npm install
npm run dev
```

## Tauri desktop and iPad

This project is also configured as a Tauri 2 app. The native project lives in `src-tauri/`, and the iOS project is generated at `src-tauri/gen/apple/`.

```bash
npm run tauri:dev       # desktop dev shell
npm run tauri:build     # desktop app/dmg
npm run ios:init        # regenerate the iOS Xcode project
npm run ios:open        # open the iOS project in Xcode
npm run ios:dev -- --host <your-lan-ip>
npm run ios:build
```

For a physical iPad or App Store/TestFlight build, configure Apple signing with either `APPLE_DEVELOPMENT_TEAM` or `bundle.iOS.developmentTeam` in `src-tauri/tauri.conf.json`. The generated iOS target is universal (`TARGETED_DEVICE_FAMILY = 1,2`), uses iOS 15+, and supports iPad portrait and landscape orientations.

## Generated visual assets

The app icon master artwork is saved at `assets/generated/app-icon-1024-v2.png`, with Tauri, iOS, Android, ICNS, and ICO outputs generated into `src-tauri/icons/` and `src-tauri/gen/apple/Assets.xcassets/`. The transparent mascot master is `assets/generated/squiggle-mascot-1024.png`, and the in-app optimized copy lives at `src/assets/squiggle-mascot-512.png`.

To regenerate icons from a new square PNG:

```bash
npm run tauri -- icon assets/generated/app-icon-1024-v2.png --ios-color '#fff4dc'
```
