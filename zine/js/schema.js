// Zine project data model: defaults, factory functions, normalization.
// Reuses shared/schema.js's object factories (text/image) so every panel
// can be rendered by the exact same shared/renderer.js used by the book
// editor and viewer — a panel is just a page-shaped { objects } bag in its
// own local (panel-relative) coordinate space.

import { uid, newTextObject, newImageObject } from '../../shared/schema.js';
import { getTemplate } from './templates.js';

export const SCHEMA_VERSION = 1;

// Kept in inches regardless of DPI — matches how the book editor's own
// page-size presets are specified (see editor/js/panels.js).
export const PAPER_PRESETS = {
  letter: { id: 'letter', name: '11 x 8.5 (Letter, landscape)', wIn: 11, hIn: 8.5 },
  a4: { id: 'a4', name: '11.69 x 8.27 (A4, landscape)', wIn: 11.69, hIn: 8.27 },
};

const DEFAULT_DPI = 150;

export function pageSizeForPreset(presetId, dpi = DEFAULT_DPI) {
  const preset = PAPER_PRESETS[presetId] || PAPER_PRESETS.letter;
  return {
    widthPx: Math.round(preset.wIn * dpi),
    heightPx: Math.round(preset.hIn * dpi),
    dpi,
  };
}

export function newZineProject(overrides = {}) {
  const templateId = overrides.templateId || 'punk-8up';
  const template = getTemplate(templateId);
  const paperPreset = overrides.paperPreset || 'letter';
  const project = {
    version: SCHEMA_VERSION,
    title: 'Untitled Zine',
    templateId,
    paperPreset,
    // Uniform safe-margin guide (native px) shown per panel — a pure
    // editing aid for snapping/visual guidance, not enforced or printed.
    margin: 18,
    pageSize: pageSizeForPreset(paperPreset),
    front: {},
    back: { objects: [] },
    ...overrides,
  };
  project.front = {};
  for (const panel of template.panels) {
    project.front[panel.id] = { objects: [] };
  }
  return project;
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

function normalizeObject(raw) {
  const type = raw.type === 'image' ? 'image' : 'text';
  const factory = type === 'image' ? newImageObject : newTextObject;
  return { ...factory(), ...raw, id: raw.id || uid('obj') };
}

// Fills in any missing fields on a possibly-partial/older project so the
// rest of the app can assume a fully-shaped object, including adding any
// panel a template gained since the project was saved.
export function normalizeProject(raw) {
  const templateId = raw.templateId || 'punk-8up';
  const template = getTemplate(templateId);
  const defaults = newZineProject({ templateId, paperPreset: raw.paperPreset });
  const project = {
    ...defaults,
    ...raw,
    templateId,
    pageSize: { ...defaults.pageSize, ...(raw.pageSize || {}) },
    margin: typeof raw.margin === 'number' ? raw.margin : defaults.margin,
    front: {},
    back: {
      objects: Array.isArray(raw.back && raw.back.objects) ? raw.back.objects.map(normalizeObject) : [],
    },
  };
  for (const panel of template.panels) {
    const rawPanel = raw.front && raw.front[panel.id];
    project.front[panel.id] = {
      objects: Array.isArray(rawPanel && rawPanel.objects) ? rawPanel.objects.map(normalizeObject) : [],
    };
  }
  return project;
}
