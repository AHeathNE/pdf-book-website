// Zine project data model: defaults, factory functions, normalization.
// Reuses shared/schema.js's object factories (text/image) so every panel
// can be rendered by the exact same shared/renderer.js used by the book
// editor and viewer — a panel is just a page-shaped { objects } bag in its
// own local (panel-relative) coordinate space.
//
// front/back are symmetric: each is either a single { objects: [] } bag
// (a poster side) or a map of panelId -> { objects: [] } (a panel-grid
// side) — whichever the project's current template says that side is
// (see templates.js's isPosterSide). Most templates only need panels on
// the front, but one (pants-16up) has a real cut/fold grid on both
// sides, so neither side is hardcoded here.

import { uid, newTextObject, newImageObject } from '../../shared/schema.js';
import { getTemplate, isPosterSide, getSidePanels } from './templates.js';

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

// Ensures project[side] has the right shape for the project's current
// template (a poster { objects } bag, or a panelId -> { objects } map)
// and that every panel a grid side's template defines has an entry —
// used both for a brand-new project and when switching templates live
// (see panels.js), so existing content survives whenever the old and
// new templates agree on that side's shape/panel ids (as all three
// templates currently do on the front, and pants-16up's back does with
// no punk-8up/no-cut-8up counterpart to preserve anyway).
export function ensureSideShape(project, side) {
  const template = getTemplate(project.templateId);
  if (isPosterSide(template, side)) {
    const existingObjects = (project[side] && Array.isArray(project[side].objects)) ? project[side].objects : [];
    project[side] = { objects: existingObjects };
  } else {
    const existing = (project[side] && !Array.isArray(project[side].objects)) ? project[side] : {};
    project[side] = existing;
    for (const panel of getSidePanels(template, side)) {
      if (!project[side][panel.id]) project[side][panel.id] = { objects: [] };
    }
  }
}

export function ensurePanelsForTemplate(project) {
  ensureSideShape(project, 'front');
  ensureSideShape(project, 'back');
}

export function newZineProject(overrides = {}) {
  const templateId = overrides.templateId || 'punk-8up';
  const paperPreset = overrides.paperPreset || 'letter';
  const project = {
    version: SCHEMA_VERSION,
    title: 'Untitled Zine',
    templateId,
    paperPreset,
    // Safe-margin guide (native px) — a pure editing aid for snapping/
    // visual guidance, not enforced or printed. Front and back keep
    // independent values because they're often wildly different physical
    // sizes (e.g. a ~2.75x4.25in panel vs. an ~11x8.5in poster) — a
    // margin sized for one can easily exceed half the other's width/
    // height, which clamps the guide to 0 and makes it look "stuck"
    // when you switch sides and try to adjust it there.
    frontMargin: 18,
    backMargin: 18,
    pageSize: pageSizeForPreset(paperPreset),
    front: {},
    back: {},
    ...overrides,
  };
  ensurePanelsForTemplate(project);
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

function normalizeSide(raw, template, side) {
  if (isPosterSide(template, side)) {
    const objects = Array.isArray(raw && raw.objects) ? raw.objects.map(normalizeObject) : [];
    return { objects };
  }
  const result = {};
  for (const panel of getSidePanels(template, side)) {
    const rawPanel = raw && raw[panel.id];
    result[panel.id] = {
      objects: Array.isArray(rawPanel && rawPanel.objects) ? rawPanel.objects.map(normalizeObject) : [],
    };
  }
  return result;
}

// Fills in any missing fields on a possibly-partial/older project so the
// rest of the app can assume a fully-shaped object, including adding any
// panel a template gained since the project was saved.
export function normalizeProject(raw) {
  const templateId = raw.templateId || 'punk-8up';
  const template = getTemplate(templateId);
  const defaults = newZineProject({ templateId, paperPreset: raw.paperPreset });
  return {
    ...defaults,
    ...raw,
    templateId,
    pageSize: { ...defaults.pageSize, ...(raw.pageSize || {}) },
    // raw.margin is an older, single-field save (from before front/back
    // had independent margins) — fall back to it for both sides.
    frontMargin: typeof raw.frontMargin === 'number' ? raw.frontMargin
      : (typeof raw.margin === 'number' ? raw.margin : defaults.frontMargin),
    backMargin: typeof raw.backMargin === 'number' ? raw.backMargin
      : (typeof raw.margin === 'number' ? raw.margin : defaults.backMargin),
    front: normalizeSide(raw.front, template, 'front'),
    back: normalizeSide(raw.back, template, 'back'),
  };
}
