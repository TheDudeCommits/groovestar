# Review evidence

Actual engine captures from local Chrome, 5 September 2026. The recorded sessions use explicit camera-free demo mode. No private camera footage is included. These files establish presentation and lifecycle behavior, not real-camera or network acceptance.

- `home-desktop.png`, `home-mobile.png`, `cast-desktop.png`: Kinetic catalog and crew.
- `game-{blade,box,rush,dance}.png`: actual game renders.
- `motion-fixtures.png` / `motion-report.json`: actual GLB retargeting under synthetic joint fixtures.
- `blade-demo.webm`, `rush-demo.webm`, `dance-demo.webm`: browser-recorded gameplay; video only.
- `smoke-report.json`: launch, pause, resume, restart, exit, menu/mobile checks.
- `rounds-report.json`: six full arcade demo rounds and results.
- `additional-rounds-report.json`: solo Dance and two-player Bowling full demo rounds.
- `recovery-report.json`: camera denial, context recovery, challenge settings and fallback checks.

Run the scripts from the repository root. `npm run dev -- --host 127.0.0.1 --port 5179` starts the local QA server. `GROOVESTAR_QA_URL` can point the smoke/recovery/round suites at a deployed build. Motion fixtures import source modules and require the local Vite server. All browser scripts close the browser in a `finally` block.

Deployed preview evidence: `preview-smoke-report.json`, `preview-services-report.json`, and `preview-*.png`. The protected preview was opened through a temporary share link; its access token and cookie are not stored in the repository.
