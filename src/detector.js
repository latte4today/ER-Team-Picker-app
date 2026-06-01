import { characters } from "./data.js";
import { weaponTemplates } from "./weaponTemplates.js";

const TEAM_SLOT_LAYOUTS = [
  {
    name: "route",
    slots: [
      { x: 0.493, y: 0.798, w: 0.142, h: 0.073, self: true },
      { x: 0.642, y: 0.798, w: 0.142, h: 0.073, self: false },
      { x: 0.79, y: 0.798, w: 0.142, h: 0.073, self: false },
    ],
    face: { x: 0.03, y: 0.07, w: 0.27, h: 0.82 },
    weapon: { x: 0.86, y: 0.12, w: 0.12, h: 0.64 },
  },
  {
    name: "character",
    slots: [
      { x: 0.49, y: 0.81, w: 0.145, h: 0.085, self: true },
      { x: 0.655, y: 0.81, w: 0.145, h: 0.085, self: false },
      { x: 0.82, y: 0.81, w: 0.145, h: 0.085, self: false },
    ],
    face: { x: 0.03, y: 0.05, w: 0.32, h: 0.9 },
    weapon: { x: 0.86, y: 0.12, w: 0.12, h: 0.64 },
  },
];
const SAMPLE_SIZE = 24;
const MIN_CONFIDENCE = 0.5;

function drawToCanvas(image, canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);
  return context;
}

function readThumbFromContext(context, rect) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const thumbContext = canvas.getContext("2d", { willReadFrequently: true });
  thumbContext.drawImage(
    context.canvas,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    0,
    0,
    SAMPLE_SIZE,
    SAMPLE_SIZE,
  );
  return thumbContext.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

function readThumbFromImage(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

function luminance(data, index) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function imageDistance(a, b) {
  let total = 0;
  let grayTotal = 0;
  let pixels = 0;

  for (let index = 0; index < a.length; index += 4) {
    const alphaA = a[index + 3] / 255;
    const alphaB = b[index + 3] / 255;
    total += Math.abs(a[index] * alphaA - b[index] * alphaB);
    total += Math.abs(a[index + 1] * alphaA - b[index + 1] * alphaB);
    total += Math.abs(a[index + 2] * alphaA - b[index + 2] * alphaB);
    grayTotal += Math.abs(luminance(a, index) * alphaA - luminance(b, index) * alphaB);
    pixels += 3;
  }

  const colorDistance = total / (pixels * 255);
  const grayDistance = grayTotal / ((pixels / 3) * 255);
  return colorDistance * 0.55 + grayDistance * 0.45;
}

function slotToRect(slot, ratio, width, height) {
  const slotRect = {
    x: Math.round(slot.x * width),
    y: Math.round(slot.y * height),
    w: Math.round(slot.w * width),
    h: Math.round(slot.h * height),
  };

  return {
    x: slotRect.x + Math.round(slotRect.w * ratio.x),
    y: slotRect.y + Math.round(slotRect.h * ratio.y),
    w: Math.round(slotRect.w * ratio.w),
    h: Math.round(slotRect.h * ratio.h),
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

let templatesPromise;
let weaponTemplatesPromise;

async function loadTemplates() {
  if (!templatesPromise) {
    templatesPromise = Promise.all(
      characters.flatMap((character) =>
        character.imageTemplates.map(async (src) => {
          const image = await loadImage(src);
          return {
            character,
            src,
            thumb: readThumbFromImage(image),
          };
        }),
      ),
    );
  }
  return templatesPromise;
}

async function loadWeaponTemplates() {
  if (!weaponTemplatesPromise) {
    const entries = Object.entries(weaponTemplates).flatMap(([weapon, paths]) =>
      paths.map(async (src) => {
        const image = await loadImage(src);
        return {
          weapon,
          src,
          thumb: readThumbFromImage(image),
        };
      }),
    );
    weaponTemplatesPromise = Promise.all(entries);
  }
  return weaponTemplatesPromise;
}

function bestMatch(slotThumb, templates) {
  const bestTemplates = templates
    .map((template) => ({
      character: template.character,
      template: template.src,
      confidence: Math.max(0, 1 - imageDistance(slotThumb, template.thumb)),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const grouped = new Map();
  for (const match of bestTemplates) {
    if (!grouped.has(match.character.id)) grouped.set(match.character.id, match);
  }

  return [...grouped.values()].sort((a, b) => b.confidence - a.confidence)[0];
}

function bestWeaponMatch(slotThumb, templates) {
  if (templates.length === 0) return undefined;
  return templates
    .map((template) => ({
      weapon: template.weapon,
      template: template.src,
      confidence: Math.max(0, 1 - imageDistance(slotThumb, template.thumb)),
    }))
    .sort((a, b) => b.confidence - a.confidence)[0];
}

function chooseBestLayout(layoutMatches) {
  return layoutMatches.sort((a, b) => b.averageConfidence - a.averageConfidence)[0];
}

export async function detectTeamFromScreenshot(image, canvas) {
  const context = drawToCanvas(image, canvas);
  const templates = await loadTemplates();
  const weaponTemplateList = await loadWeaponTemplates();
  const layoutMatches = TEAM_SLOT_LAYOUTS.map((layout) => {
    const matches = layout.slots.map((slot, slotIndex) => {
      const faceRect = slotToRect(slot, layout.face, canvas.width, canvas.height);
      const faceThumb = readThumbFromContext(context, faceRect);
      const characterMatch = bestMatch(faceThumb, templates);

      const weaponRect = slotToRect(slot, layout.weapon, canvas.width, canvas.height);
      const weaponThumb = readThumbFromContext(context, weaponRect);
      const weaponMatch = bestWeaponMatch(weaponThumb, weaponTemplateList);

      return {
        ...characterMatch,
        weapon: weaponMatch?.weapon,
        weaponConfidence: weaponMatch?.confidence ?? 0,
        slotIndex,
        isSelf: slot.self,
        layout: layout.name,
        rect: faceRect,
        weaponRect,
      };
    });

    return {
      layout: layout.name,
      matches,
      averageConfidence: matches.reduce((sum, match) => sum + match.confidence, 0) / matches.length,
    };
  });

  const { matches } = chooseBestLayout(layoutMatches);

  const unique = [];
  for (const match of matches) {
    if (match.confidence < MIN_CONFIDENCE) continue;
    if (unique.some((item) => item.character.id === match.character.id)) continue;
    unique.push(match);
  }

  return unique;
}
