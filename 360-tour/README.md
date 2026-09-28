# 360° House Tour

A small, mobile-friendly 360° virtual tour built with [Pannellum 2.5.6](https://pannellum.org/).
Plain HTML/CSS/JS: no framework and no build step.

```
360-tour/
  index.html        viewer page
  style.css         arrow + UI styling
  tour.js           loads tour.json, builds the viewer, edit mode
  tour.json         scenes + arrows (the only file you edit to add rooms)
  images/           web-optimised panoramas (max 6000 px wide)
  images/mobile/    lighter copies for phones (max 4096 px wide)
  images/original/  untouched originals (do NOT upload, see Deploy)
  assets/arrow.svg  arrow icon
```

## Run locally

```bash
npx serve 360-tour
```

Then open http://localhost:3000. Don't double-click `index.html`: browsers block
`tour.json` and the images when a page is opened straight from disk.

Everything loads from this folder except Pannellum itself, which comes from the jsDelivr CDN.

## Add a new room in 3 steps

1. **Add the image.** From the project root (the folder above `360-tour/`), run:
   ```bash
   npm install            # first time only
   npm run optimize -- path/to/kitchen.jpg
   ```
   This copies the original to `images/original/`, checks that it's 2:1, and writes
   `images/kitchen.jpg` (desktop) and `images/mobile/kitchen.jpg` (phones).
   If a warning says the image isn't 2:1, re-export the panorama. Otherwise it will look distorted.

2. **Add the scene to `tour.json`.**
   ```json
   "kitchen": {
     "title": "Kitchen",
     "image": "images/kitchen.jpg",
     "imageMobile": "images/mobile/kitchen.jpg",
     "startYaw": 0,
     "hotspots": [
       { "to": "reception", "label": "Back to Reception", "pitch": -20, "yaw": 0 }
     ]
   }
   ```
   Also add an arrow **to** the kitchen from the room it connects to, so no room is a dead end.
   The scene id (`"kitchen"`) is what `"to"` refers to, and it appears in the URL (`#kitchen`).

3. **Place the arrows with edit mode.** Open http://localhost:3000/?edit=1, go to the room and
   click the floor just in front of the door. The box in the bottom-left shows the scene id and
   the `pitch`/`yaw` of that point. Press **Copy hotspot**, paste the line into `tour.json` and
   fill in `"to"` and `"label"`. Reload to check it.

### tour.json reference

| Field | Where | Meaning |
|---|---|---|
| `firstScene` | top level | Scene shown when the tour opens |
| `title` | scene | Name shown top-left and in the room menu |
| `image` | scene | Desktop panorama (equirectangular, 2:1) |
| `imageMobile` | scene | *Optional.* Lighter image for phones |
| `startYaw` / `startPitch` | scene | *Optional.* Direction the camera faces when you open the room from the menu |
| `hfov` | scene | *Optional.* Zoom level (field of view in degrees). Defaults to 100 on landscape screens and 70 on portrait |
| `to` | hotspot | Scene id the arrow leads to |
| `label` | hotspot | Tooltip text |
| `pitch` / `yaw` | hotspot | Position of the arrow. Use `?edit=1` to find it |
| `targetYaw` / `targetPitch` | hotspot | *Optional.* Direction to face on arrival. Defaults to the target room's `startYaw` |

`yaw` runs from -180 to 180 (left/right) and `pitch` from -90 to 90 (down/up).
Edit mode also shows the current **View** yaw. Turn to the direction you want a room to open
facing, then press **Copy view yaw** and paste the value into `startYaw` or `targetYaw`.

You can link straight to a room with `index.html#room`.

## Deploy

Upload the `360-tour/` folder to any static host (Netlify, Vercel, or your own server).
**Leave out `images/original/`.** It holds the full-size source files (hundreds of MB) and the tour never loads them.

- **Netlify:** drag the folder (without `images/original`) onto https://app.netlify.com/drop
- **Vercel:** `npx vercel 360-tour` (the included `.vercelignore` already skips the originals)
- **Own server:** copy the folder into your web root, for example as `/360-tour/`

## Embed on the website

### Inline (iframe)

```html
<iframe src="https://YOUR-HOST/360-tour/" width="100%" height="600"
        style="border:0" allow="fullscreen" allowfullscreen></iframe>
```

Add `#room` to the URL to open a specific room first.

### "360°" button that opens the tour full-screen in a popup

```html
<button type="button" class="open-360">360° Tour</button>

<div class="tour-modal" hidden>
  <button type="button" class="tour-modal__close" aria-label="Close tour">×</button>
  <iframe title="360° house tour" allow="fullscreen" allowfullscreen></iframe>
</div>

<style>
  .tour-modal { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.9); }
  .tour-modal[hidden] { display: none; }
  .tour-modal iframe { width: 100%; height: 100%; border: 0; }
  .tour-modal__close {
    position: absolute; top: 12px; right: 64px; z-index: 1;
    width: 44px; height: 44px; border: 0; border-radius: 50%;
    background: rgba(0,0,0,.6); color: #fff; font-size: 28px; line-height: 1; cursor: pointer;
  }
</style>

<script>
  (function () {
    var TOUR_URL = 'https://YOUR-HOST/360-tour/';
    var modal = document.querySelector('.tour-modal');
    var frame = modal.querySelector('iframe');
    function close() { modal.hidden = true; frame.src = 'about:blank'; document.body.style.overflow = ''; }
    document.querySelectorAll('.open-360').forEach(function (btn) {
      btn.addEventListener('click', function () {
        frame.src = TOUR_URL + (btn.dataset.room ? '#' + btn.dataset.room : '');
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
      });
    });
    modal.querySelector('.tour-modal__close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) close(); });
  })();
</script>
```

To open a specific room, add `data-room="room"` to the button.
The iframe only loads when the button is clicked, so the tour doesn't slow down the page.

## Testing

From the project root, start `npx serve 360-tour` in one terminal and run `npm test` in another.
This runs a headless Chrome smoke test covering:

- arrows and the room menu
- edit mode
- a 375 px mobile viewport, with touch drag and pinch
- iframe embedding and fullscreen
- console errors

Screenshots are saved to `test-screenshots/`.
