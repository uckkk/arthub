# Screenshot / Recording – Test Steps

## Flow Summary

- **Fullscreen + hotkey**: Hotkey → switch to tab → if save dir set, run capture; else toast to choose dir.
- **Region + hotkey**: Hotkey → switch to tab → open region picker → user drags → on release run capture with region.
- **Buttons**: Choose fullscreen/region, set save path, then "Screenshot" / "Start record" or "Frame region" then capture.

## Guards in Place

- No save path → toast, no capture.
- Region mode and no FFmpeg → after picker, toast and clear pending (no stuck state).
- Region coords: CSS pixels × devicePixelRatio → physical pixels for backend.

## Manual Test (run `npm run tauri dev`)

1. **Fullscreen screenshot**: Set path, mode "Fullscreen", click Screenshot → fullscreen image + prompt.
2. **Region screenshot (UI)**: Mode "Region" → "Frame region" → drag on overlay → release → click "Region screenshot" → only that area.
3. **Hotkey + fullscreen**: Mode "Fullscreen", path set → press screenshot hotkey → switch to tab + fullscreen capture.
4. **Hotkey + region**: Mode "Region", path set → press hotkey → switch to tab + region picker → after drag, auto capture region.
5. **Recording**: Start record → top bar "Recording 00:00" + Stop → Stop → file saved + download prompt.
6. **No path**: Clear path → hotkey → toast to choose dir, no capture.
7. **Region + no FFmpeg**: No FFmpeg, region mode, complete pick → toast install FFmpeg, state cleared.
