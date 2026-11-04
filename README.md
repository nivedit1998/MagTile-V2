# MagTile V2

Stage 1 is a design-first browser simulator for the BOOX Picco. It provides a
responsive workbench around a portrait `480 × 800` monochrome display, with
orientation, dark-mode, and e-ink redraw controls. It is a visual and
interaction simulator, not proof of native firmware compatibility.

## Run the simulator

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. Use the simulator controls to
switch between portrait and landscape, test dark mode, and simulate a full
e-ink refresh with configurable redraw latency.

## Stage 1 delivery gates

1. Lock the Picco display profile and input constraints.
2. Design all 31 approved screens in one monochrome e-ink system.
3. Include setup, loading, empty, offline, error, detail, game setup/play/reveal,
   and results states.
4. Keep mock data behind reusable screen components and provider interfaces.
5. Approve every screen visually before firmware work or live integrations.

The Today Dashboard is the first completed static screen. Live APIs, Supabase
data, and firmware integration are intentionally not part of this simulator
shell yet.
