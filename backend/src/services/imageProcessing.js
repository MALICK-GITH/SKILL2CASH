import { Jimp } from 'jimp';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function foldText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeText(value) {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

export function normalizeDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

export function normalizeScore(value) {
  const match = String(value || '').match(/\b(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : '';
}

export function extractScoreCandidates(text) {
  const candidates = [];
  const seen = new Set();
  const source = foldText(text);
  const patterns = [
    /\b(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g,
    /\bscore\s*(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g,
    /\bresult(?:at)?\s*(?:final)?\s*(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g,
    /\b(?:ft|full time|final)\s*(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const score = `${Number(match[1])}-${Number(match[2])}`;
      if (!seen.has(score)) {
        seen.add(score);
        candidates.push(score);
      }
    }
  }

  return candidates;
}

export function extractAmountCandidates(text) {
  const candidates = [];
  const seen = new Set();
  const source = foldText(text);
  const patterns = [
    /\b(?:amount|montant|deposit|depot|credit|sent|envoye|paiement|payment|recu|received)\s*[:\-]?\s*([0-9][0-9\s.,]{2,})\b/g,
    /\b([0-9][0-9\s.,]{2,})\s*(?:cfa|xfc|frs?|xaf|fr)\b/g,
    /\b(?:cfa|xfc|frs?|xaf|fr)\s*([0-9][0-9\s.,]{2,})\b/g
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const normalized = normalizeDigits(match[1]);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push(normalized);
    }
  }

  return candidates;
}

export function detectNamesFromText(text, names = []) {
  const normalizedText = normalizeText(text);
  const compact = compactText(text);

  return names.filter((name) => {
    const normalizedName = normalizeText(name);
    if (normalizedName.length < 3) return false;
    const compactName = compactText(name);
    if (compact.includes(compactName)) return true;
    if (normalizedText.includes(normalizedName)) return true;
    const tokens = normalizedName.split(/\s+/).filter((token) => token.length >= 3);
    return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
  });
}

export function decodeImageDataUrl(input, { minBytes = 10 * 1024, maxBytes = MAX_IMAGE_BYTES } = {}) {
  const match = String(input || '').match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (buffer.length < minBytes || buffer.length > maxBytes) return null;

  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return isPng || isJpeg || isWebp ? buffer : null;
}

function cropBox(image, crop) {
  const { width, height } = image.bitmap;
  const x = Math.max(0, Math.min(width - 1, Math.round(width * crop.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(height * crop.y)));
  const w = Math.max(1, Math.min(width - x, Math.round(width * crop.w)));
  const h = Math.max(1, Math.min(height - y, Math.round(height * crop.h)));
  return { x, y, w, h };
}

async function prepareVariant(buffer, variant) {
  const image = await Jimp.read(buffer);
  if (variant.crop) {
    const box = cropBox(image, variant.crop);
    image.crop(box);
  }

  image.greyscale();
  image.normalize();
  image.contrast(0.45);

  const targetWidth = variant.width || 1600;
  if (image.bitmap.width < targetWidth) {
    image.resize({ w: targetWidth });
  }

  return image.getBuffer('image/png');
}

export async function buildOcrVariants(buffer, profile = 'duel') {
  const variantsByProfile = {
    duel: [
      { name: 'full', width: 1800 },
      { name: 'top', crop: { x: 0, y: 0, w: 1, h: 0.58 }, width: 1800 },
      { name: 'middle', crop: { x: 0, y: 0.18, w: 1, h: 0.58 }, width: 1800 }
    ],
    deposit: [
      { name: 'full', width: 1800 },
      { name: 'top', crop: { x: 0, y: 0, w: 1, h: 0.54 }, width: 1800 },
      { name: 'middle', crop: { x: 0, y: 0.22, w: 1, h: 0.56 }, width: 1800 }
    ]
  };

  const variants = variantsByProfile[profile] || variantsByProfile.duel;
  return Promise.all(
    variants.map(async (variant) => ({
      name: variant.name,
      buffer: await prepareVariant(buffer, variant)
    }))
  );
}
