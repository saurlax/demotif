# Demotif studio

Vite + React + TypeScript front end for the Demotif workspace: project list, arrangement shell, producer chat, and
transport UI. Styling uses Tailwind v4 and shadcn/ui (`base-nova`, Base UI primitives).

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api to 127.0.0.1:8200
npm run build    # tsc -b && vite build
```

The audio engine (Web Audio/AudioWorklet transport, metronome, recording) is not wired yet; the playhead is visual and
explicitly labeled as such in the transport bar.
