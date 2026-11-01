import type { Photo, PlayerStyle } from "./schema";

export const DEFAULT_PHOTO_DIM = 0.25;

export function defaultPhoto(assetId: string, width: number, height: number): Photo {
  return { assetId, width, height, zoom: 1, focusX: 0.5, focusY: 0.5, dim: DEFAULT_PHOTO_DIM };
}

export interface PhotoRect { left: number; top: number; width: number; height: number }

/** Where the photo sits on a W×H canvas: scaled to cover it (times zoom) and positioned like CSS object-position. */
export function photoRect(ph: Pick<Photo, "width" | "height" | "zoom" | "focusX" | "focusY">, W: number, H: number): PhotoRect {
  const s = Math.max(W / ph.width, H / ph.height) * ph.zoom;
  const width = ph.width * s, height = ph.height * s;
  return { left: (W - width) * ph.focusX, top: (H - height) * ph.focusY, width, height };
}

/** Focus after dragging the picture by (dx, dy) canvas pixels. An axis with no overflow cannot move and keeps its focus. */
export function panFocus(ph: Photo, W: number, H: number, dx: number, dy: number): { focusX: number; focusY: number } {
  const r = photoRect(ph, W, H);
  const ox = W - r.width, oy = H - r.height;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    focusX: ox < -0.5 ? clamp((r.left + dx) / ox) : ph.focusX,
    focusY: oy < -0.5 ? clamp((r.top + dy) / oy) : ph.focusY,
  };
}

/** Player card height / width. The card is drawn on a fixed 1000-wide design grid and scaled, so it only resizes proportionally. */
export const PLAYER_RATIO: Record<PlayerStyle, number> = { apple: 0.44, "apple-tall": 1.72, spotify: 0.5 };
export const playerHeight = (style: PlayerStyle, w: number) => Math.round(w * PLAYER_RATIO[style]);
