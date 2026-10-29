import "server-only";
import { deflateSync } from "node:zlib";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "../audit";
import { newQrSecret } from "../handover-rules";

// QR tags, hand-over proof methods, demo condition photos and a borrower statement (handover agent).

// ---------------------------------------------------------------- tiny PNG renderer (no dependencies)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type RGB = [number, number, number];

class Canvas {
  w: number;
  h: number;
  px: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }
  set(x: number, y: number, c: RGB, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a);
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, radius = 0) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const dx = Math.max(x0 + radius - x, 0, x - (x1 - 1 - radius));
        const dy = Math.max(y0 + radius - y, 0, y - (y1 - 1 - radius));
        if (dx * dx + dy * dy <= radius * radius) this.set(x, y, c);
      }
  }
  ring(cx: number, cy: number, r0: number, r1: number, c: RGB) {
    for (let y = Math.floor(cy - r1); y <= cy + r1; y++)
      for (let x = Math.floor(cx - r1); x <= cx + r1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= r0 && d <= r1) this.set(x, y, c);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, width = 1, a = 1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let oy = -width / 2; oy <= width / 2; oy++) for (let ox = -width / 2; ox <= width / 2; ox++) this.set(x + ox, y + oy, c, a);
    }
  }
  png() {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0; // filter: none
      Buffer.from(this.px.subarray(y * this.w * 3, (y + 1) * this.w * 3)).copy(raw, y * (this.w * 3 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
    return `data:image/png;base64,${png.toString("base64")}`;
  }
}

/** A stylised mirrorless camera on a desk. `damaged` adds a scratched lens hood, a scuff and a chipped corner. */
export function cameraPhoto(damaged: boolean) {
  const W = 320;
  const H = 240;
  const c = new Canvas(W, H);
  const light = damaged ? -6 : 0; // slightly different room lighting, as in real photos
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const shade = (v: number) => Math.max(0, Math.min(255, Math.round(v + light)));
    const row: RGB = y < 150 ? [shade(232 - 10 * t), shade(228 - 10 * t), shade(220 - 12 * t)] : [shade(188 - 20 * t), shade(160 - 20 * t), shade(128 - 18 * t)];
    for (let x = 0; x < W; x++) c.set(x, y, row);
  }
  // shadow
  c.rect(78, 176, 252, 186, [150, 126, 100], 5);
  // body and grip
  c.rect(70, 82, 250, 178, [38, 38, 44], 14);
  c.rect(70, 82, 112, 178, [28, 28, 32], 12);
  c.rect(130, 62, 196, 90, [44, 44, 52], 8); // viewfinder hump
  c.rect(206, 70, 232, 84, [70, 70, 80], 4); // dial
  c.rect(84, 74, 104, 84, [190, 40, 40], 3); // record button
  // lens with hood
  const cx = 166;
  const cy = 132;
  c.ring(cx, cy, 0, 46, [24, 24, 28]);
  c.ring(cx, cy, 40, 46, [12, 12, 14]); // hood rim
  c.ring(cx, cy, 30, 34, [80, 80, 90]);
  c.ring(cx, cy, 0, 24, [40, 60, 92]);
  c.ring(cx, cy, 0, 12, [70, 110, 160]);
  c.ring(cx - 8, cy - 9, 0, 5, [200, 220, 245]); // glint
  // brand strip
  c.rect(206, 98, 240, 104, [150, 150, 158], 2);

  if (damaged) {
    // Scratches across the lens hood (bright, as scraped plastic shows).
    c.line(cx - 40, cy - 22, cx - 4, cy - 44, [205, 205, 210], 2);
    c.line(cx - 36, cy - 14, cx - 6, cy - 34, [175, 175, 182], 1);
    c.line(cx + 18, cy + 40, cx + 44, cy + 14, [195, 195, 200], 2);
    // Scuff on the grip.
    for (let i = 0; i < 70; i++) {
      const a = (i * 137.5 * Math.PI) / 180;
      const rr = Math.sqrt(i) * 1.6;
      c.set(92 + Math.cos(a) * rr, 150 + Math.sin(a) * rr, [120, 116, 110], 0.8);
    }
    // Chipped corner.
    for (let y = 166; y < 178; y++) for (let x = 238; x < 250; x++) if (x - 238 + (y - 166) > 10) c.set(x, y, [214, 204, 188]);
  }
  return c.png();
}

// ---------------------------------------------------------------- seed

export async function seedHandover(now: number) {
  // 1. Every resource gets a printed-tag secret.
  const resources = await db.select().from(schema.resources);
  for (const r of resources) {
    if (!r.qrSecret) await db.update(schema.resources).set({ qrSecret: newQrSecret() }).where(eq(schema.resources.id, r.id));
  }

  // 2. Hand-overs that already happened record how presence was proven.
  const supervised = new Set(resources.filter((r) => r.supervisionRequired).map((r) => r.id));
  const outs = await db.select().from(schema.bookings).where(and(isNotNull(schema.bookings.checkOutAt), isNull(schema.bookings.checkOutMethod)));
  for (const b of outs) {
    const m = supervised.has(b.resourceId) ? "staff_code" : "qr";
    await db
      .update(schema.bookings)
      .set({ checkOutMethod: m, returnMethod: b.returnAt && !b.returnMethod ? m : b.returnMethod })
      .where(eq(schema.bookings.id, b.id));
  }

  // 3. Before/after photos for the camera kit that came back scratched, so the comparison view has content.
  const cam = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, "c4e9d2-camera") });
  if (cam) {
    await db
      .update(schema.bookings)
      .set({ checkOutPhoto: cameraPhoto(false), returnPhoto: cameraPhoto(true), aiConditionDiff: null })
      .where(eq(schema.bookings.id, cam.id));
  }

  // 4. Farhan's side of the camera incident (the owner and manager can still respond).
  const inc = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, "i-camera") });
  if (inc && cam) {
    const at = Math.min(now - 60 * 60_000, inc.createdAt + 3 * 60 * 60_000);
    await db.insert(schema.incidentStatements).values({
      id: "st-camera-farhan",
      incidentId: inc.id,
      userId: "u-farhan",
      role: "borrower",
      body:
        "The gimbal tipped over on the grass near the recycling yard when a gust caught the umbrella rig. The lens hood took the hit; the lens itself and the glass are fine (I checked through the viewfinder). " +
        "I was late because I went back to look for the hood's clip. I'm happy to pay for a replacement hood if needed.",
      createdAt: at,
    });
    await audit({ actorId: "u-farhan", action: "incident.statement", entityType: "incident", entityId: inc.id, bookingId: cam.id, details: { role: "borrower", photo: false, chars: 300 }, at });
  }
}
