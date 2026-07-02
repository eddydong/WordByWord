import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, extname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const petRoot = resolve(repoRoot, 'data', 'pet');
const outputModulePath = resolve(__dirname, '..', 'src', 'generated-content.js');
const outputJsonPath = resolve(__dirname, '..', 'public', 'content', 'catalog.json');

const EXAM_CONFIG = {
  PET: {
    rootDir: petRoot,
    label: 'Cambridge B1 Preliminary (PET)',
    language: 'en',
    level: 'B1',
    order: 1,
    defaultExerciseId: 'pet-part2-001',
    partSections: {
      '1': { label: 'Part 1 · Short Descriptions', badgeLabel: 'Part 1', contextLabel: 'P1', order: 1, itemNoun: 'Exercise' },
      '2': { label: 'Part 2 · Monologue', badgeLabel: 'Part 2', contextLabel: 'P2', order: 2, itemNoun: 'Exercise' },
      '3': { label: 'Part 3 · Announcements', badgeLabel: 'Part 3', contextLabel: 'P3', order: 3, itemNoun: 'Exercise' },
      '4': { label: 'Part 4 · Conversation', badgeLabel: 'Part 4', contextLabel: 'P4', order: 4, itemNoun: 'Exercise' },
    },
  },
};

function collectMarkdownFiles(rootDir) {
  const results = [];

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (extname(entry.name).toLowerCase() !== '.md') continue;
      if (entry.name.toLowerCase() === 'index.md') continue;
      results.push(fullPath);
    }
  }

  walk(rootDir);
  return results;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

function parseFrontMatter(fileContent, filePath) {
  const normalized = fileContent.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error(`Missing front matter in ${filePath}`);
  }

  const end = normalized.indexOf('\n---\n', 4);
  const rawFrontMatter = end === -1
    ? normalized.slice(4)
    : normalized.slice(4, end);
  const lines = rawFrontMatter.split('\n');
  const data = {};

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line.trim()) continue;

    const match = /^([A-Za-z0-9_]+):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      throw new Error(`Unsupported front matter line in ${filePath}: ${line}`);
    }

    const [, key, rawValue = ''] = match;
    if (rawValue === '|') {
      const blockLines = [];
      lineIndex += 1;
      while (lineIndex < lines.length) {
        const blockLine = lines[lineIndex];
        if (blockLine.startsWith('  ')) {
          blockLines.push(blockLine.slice(2));
          lineIndex += 1;
          continue;
        }
        if (!blockLine.trim()) {
          blockLines.push('');
          lineIndex += 1;
          continue;
        }
        lineIndex -= 1;
        break;
      }
      data[key] = blockLines.join('\n').trimEnd();
      continue;
    }

    data[key] = parseScalar(rawValue);
  }

  return data;
}

function normalizeText(rawText) {
  return String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePreferredReadingOrder(examRoot) {
  const indexPath = resolve(examRoot, 'index.md');
  const indexContent = readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');
  const matches = [...indexContent.matchAll(/\|\s*\[([^\]]+)\]\([^)]*\)\s*\|/g)];
  return new Map(matches.map((match, index) => [match[1].trim(), index]));
}

function getSectionInfo(entry, examConfig, preferredReadingOrder) {
  const part = entry.part;
  const parentDir = basename(dirname(entry.sourceFullPath));

  if (Number.isInteger(part) || /^\d+$/.test(String(part))) {
    const normalizedPart = String(part);
    const config = examConfig.partSections[normalizedPart];
    if (!config) {
      throw new Error(`No section config for ${entry.exam} part ${normalizedPart} (${entry.sourcePath})`);
    }
    return {
      part: Number.parseInt(normalizedPart, 10),
      sectionKey: `part-${normalizedPart}`,
      sectionLabel: config.label,
      sectionBadgeLabel: config.badgeLabel,
      sectionContextLabel: config.contextLabel,
      sectionOrder: config.order,
      itemNoun: config.itemNoun,
    };
  }

  const partText = String(part).toLowerCase();
  if (partText === 'reading') {
    const preferredIndex = preferredReadingOrder.has(parentDir)
      ? preferredReadingOrder.get(parentDir)
      : 1000;
    return {
      part: String(part),
      sectionKey: `reading-${slugify(parentDir)}`,
      sectionLabel: parentDir,
      sectionBadgeLabel: parentDir,
      sectionContextLabel: parentDir,
      sectionOrder: 100 + preferredIndex,
      itemNoun: 'Chapter',
    };
  }

  return {
    part: String(part),
    sectionKey: slugify(part),
    sectionLabel: String(part),
    sectionBadgeLabel: String(part),
    sectionContextLabel: String(part),
    sectionOrder: 500,
    itemNoun: 'Exercise',
  };
}

function buildExercises() {
  const exercises = [];
  const examMeta = {};

  for (const [examKey, examConfig] of Object.entries(EXAM_CONFIG)) {
    examMeta[examKey] = {
      language: examConfig.language,
      level: examConfig.level,
      label: examConfig.label,
      order: examConfig.order,
    };

    const preferredReadingOrder = parsePreferredReadingOrder(examConfig.rootDir);
    const files = collectMarkdownFiles(examConfig.rootDir);
    for (const filePath of files) {
      const raw = readFileSync(filePath, 'utf8');
      const entry = parseFrontMatter(raw, filePath);
      const sourcePath = relative(repoRoot, filePath).replace(/\\/g, '/');
      const text = normalizeText(entry.transcript || entry.audio_text || entry.reading_text);

      if (!entry.id || !entry.exam || !entry.title || !text) {
        throw new Error(`Missing required content fields in ${sourcePath}`);
      }

      const exam = String(entry.exam).toUpperCase();
      if (exam !== examKey) {
        throw new Error(`Unexpected exam ${entry.exam} in ${sourcePath}; expected ${examKey}`);
      }

      const itemNumber = Number.parseInt(basename(filePath, '.md'), 10) || 0;
      const section = getSectionInfo({ ...entry, exam, sourcePath, sourceFullPath: filePath }, examConfig, preferredReadingOrder);

      exercises.push({
        id: String(entry.id),
        exam,
        part: section.part,
        level: String(entry.level || examConfig.level),
        title: String(entry.title),
        text,
        source: entry.source ? String(entry.source) : '',
        sourcePath,
        sectionKey: section.sectionKey,
        sectionLabel: section.sectionLabel,
        sectionBadgeLabel: section.sectionBadgeLabel,
        sectionContextLabel: section.sectionContextLabel,
        sectionOrder: section.sectionOrder,
        itemNumber,
        itemLabel: `${section.itemNoun} ${String(itemNumber || 1).padStart(2, '0')}`,
      });
    }
  }

  exercises.sort((left, right) => {
    const examOrder = (examMeta[left.exam]?.order || 999) - (examMeta[right.exam]?.order || 999);
    if (examOrder !== 0) return examOrder;
    if (left.sectionOrder !== right.sectionOrder) return left.sectionOrder - right.sectionOrder;
    const sectionLabelOrder = left.sectionLabel.localeCompare(right.sectionLabel, 'en');
    if (sectionLabelOrder !== 0) return sectionLabelOrder;
    if (left.itemNumber !== right.itemNumber) return left.itemNumber - right.itemNumber;
    return left.title.localeCompare(right.title, 'en');
  });

  return { exercises, examMeta };
}

function writeOutputs(catalog) {
  const moduleText = [
    '// Auto-generated by scripts/generate-content-catalog.js. Do not edit manually.',
    `export const CONTENT_CATALOG = ${JSON.stringify(catalog, null, 2)};`,
    '',
  ].join('\n');

  mkdirSync(dirname(outputModulePath), { recursive: true });
  mkdirSync(dirname(outputJsonPath), { recursive: true });
  writeFileSync(outputModulePath, moduleText, 'utf8');
  writeFileSync(outputJsonPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

function main() {
  const { exercises, examMeta } = buildExercises();
  const defaultExerciseId = Object.values(EXAM_CONFIG)
    .map((config) => config.defaultExerciseId)
    .find((exerciseId) => exercises.some((exercise) => exercise.id === exerciseId))
    || exercises[0]?.id
    || null;

  const catalog = {
    generatedAt: new Date().toISOString(),
    defaultExerciseId,
    examMeta,
    exercises,
  };

  writeOutputs(catalog);
  console.log(`[content] Generated catalog with ${exercises.length} exercises`);
  console.log(`[content] Module: ${relative(repoRoot, outputModulePath)}`);
  console.log(`[content] JSON: ${relative(repoRoot, outputJsonPath)}`);
}

main();