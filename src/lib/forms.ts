/**
 * Form fields: reading their properties, and designing forms (create, delete,
 * move and resize fields; change flags such as read-only, required and locked).
 */
import {
  PDFArray,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFString,
  PDFTextField,
  PDFWidgetAnnotation,
  StandardFonts,
} from '@cantoo/pdf-lib';
import type { Rect } from './types';
import { saveDoc } from './pdfSave';

// Annotation flags (ISO 32000-1, table 165).
const F_HIDDEN = 1 << 1;
const F_PRINT = 1 << 2;
const F_NOVIEW = 1 << 5;
const F_READONLY = 1 << 6;
const F_LOCKED = 1 << 7;
const F_LOCKED_CONTENTS = 1 << 9;

export type Visibility = 'visible' | 'hidden' | 'noPrint' | 'printOnly';
export type Alignment = 'left' | 'center' | 'right';
export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button' | 'other';

export interface WidgetInfo {
  page: number;
  rect: Rect;
}

/** Properties shared by all fields, plus the kind-specific ones where they apply. */
export interface FieldProps {
  tooltip: string;
  readOnly: boolean;
  required: boolean;
  noExport: boolean;
  /** The field's widgets may not be moved, resized or deleted (annotation flag Locked). */
  locked: boolean;
  /** The field's value may not be changed (annotation flag LockedContents). */
  lockedContents: boolean;
  visibility: Visibility;
  // text fields
  multiline?: boolean;
  password?: boolean;
  comb?: boolean;
  scroll?: boolean;
  spellcheck?: boolean;
  maxLength?: number;
  alignment?: Alignment;
  /** 0 = auto. */
  fontSize?: number;
  // choice fields
  options?: string[];
  editable?: boolean;
  sort?: boolean;
  multiselect?: boolean;
}

interface Base {
  name: string;
  /** Read-only for filling: the read-only flag or locked contents. */
  readOnly: boolean;
  props: FieldProps;
  widgets: WidgetInfo[];
}

export type FieldInfo = Base &
  (
    | { kind: 'text'; value: string; multiline: boolean }
    | { kind: 'checkbox'; value: boolean }
    | { kind: 'radio' | 'dropdown'; value: string; options: string[] }
    | { kind: 'list'; value: string[]; options: string[] }
    | { kind: 'signature' | 'button' | 'other' }
  );

export type FieldValue = string | boolean | string[];

export type FieldPatch = Partial<FieldProps> & { name?: string };

// ---------------------------------------------------------------- helpers

/** Widget annotations of a field with their indirect references. */
function widgetsOf(field: PDFField): { widget: PDFWidgetAnnotation; ref: PDFRef }[] {
  const widgets = field.acroField.getWidgets();
  const kids = field.acroField.dict.lookup(PDFName.of('Kids'));
  const refs: PDFRef[] = kids instanceof PDFArray ? kids.asArray().filter((r): r is PDFRef => r instanceof PDFRef) : [field.ref];
  return widgets.map((widget, i) => {
    const ref = refs.find((r) => field.doc.context.lookup(r) === widget.dict) ?? refs[i] ?? field.ref;
    return { widget, ref };
  });
}

/** Page lookups for widgets (built once when listing all fields: forms can have thousands of widgets). */
type PageMaps = { byPage: Map<string, number>; byAnnot: Map<string, number> };
function pageMapsOf(doc: PDFDocument): PageMaps {
  const byPage = new Map<string, number>();
  const byAnnot = new Map<string, number>();
  doc.getPages().forEach((pg, i) => {
    byPage.set(pg.ref.toString(), i);
    const annots = pg.node.Annots();
    if (annots) for (const a of annots.asArray()) if (a instanceof PDFRef && !byAnnot.has(a.toString())) byAnnot.set(a.toString(), i);
  });
  return { byPage, byAnnot };
}

function pageIndexOf(maps: PageMaps, ref: PDFRef, widget: PDFWidgetAnnotation): number {
  const { byPage, byAnnot } = maps;
  const p = widget.P();
  const i = p ? byPage.get(p.toString()) : undefined;
  return i ?? byAnnot.get(ref.toString()) ?? -1;
}

function kindOf(f: PDFField): FieldKind {
  if (f instanceof PDFTextField) return 'text';
  if (f instanceof PDFCheckBox) return 'checkbox';
  if (f instanceof PDFRadioGroup) return 'radio';
  if (f instanceof PDFDropdown) return 'dropdown';
  if (f instanceof PDFOptionList) return 'list';
  const ft = f.acroField.dict.lookup(PDFName.of('FT'))?.toString();
  if (ft === '/Sig') return 'signature';
  if (ft === '/Btn') return 'button';
  return 'other';
}

function visibilityOf(flags: number): Visibility {
  if (flags & F_HIDDEN) return 'hidden';
  if (flags & F_NOVIEW) return flags & F_PRINT ? 'printOnly' : 'hidden';
  return flags & F_PRINT ? 'visible' : 'noPrint';
}

function applyVisibility(w: PDFWidgetAnnotation, v: Visibility) {
  let f = w.getFlags() & ~(F_HIDDEN | F_PRINT | F_NOVIEW);
  if (v === 'visible') f |= F_PRINT;
  if (v === 'hidden') f |= F_HIDDEN;
  if (v === 'printOnly') f |= F_NOVIEW | F_PRINT;
  w.setFlags(f);
}

const ALIGN: Alignment[] = ['left', 'center', 'right'];

function fontSizeOf(f: PDFField): number {
  const da = f.acroField.getDefaultAppearance() ?? '';
  const m = da.match(/([\d.]+)\s+Tf/);
  return m ? Number(m[1]) : 0;
}

function tooltipOf(f: PDFField): string {
  const t = f.acroField.dict.lookup(PDFName.of('TU'));
  return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
}

export function describeField(doc: PDFDocument, f: PDFField, maps: PageMaps = pageMapsOf(doc)): FieldInfo {
  const ws = widgetsOf(f);
  const flags = ws.reduce((acc, { widget }) => acc | widget.getFlags(), 0);
  const kind = kindOf(f);
  const props: FieldProps = {
    tooltip: tooltipOf(f),
    // Read-only can be set on the field (Ff bit 1) or, by some producers, on its widgets (F bit 7).
    readOnly: f.isReadOnly() || ws.some(({ widget }) => widget.hasFlag(F_READONLY)),
    required: f.isRequired(),
    noExport: !f.isExported(),
    locked: ws.some(({ widget }) => widget.hasFlag(F_LOCKED)),
    lockedContents: ws.some(({ widget }) => widget.hasFlag(F_LOCKED_CONTENTS)),
    visibility: visibilityOf(ws[0]?.widget.getFlags() ?? flags),
  };
  if (f instanceof PDFTextField) {
    Object.assign(props, {
      multiline: f.isMultiline(), password: f.isPassword(), comb: f.isCombed(), scroll: f.isScrollable(),
      spellcheck: f.isSpellChecked(), maxLength: f.getMaxLength(), alignment: ALIGN[f.getAlignment() as number] ?? 'left',
      fontSize: fontSizeOf(f),
    });
  } else if (f instanceof PDFDropdown) {
    Object.assign(props, { options: f.getOptions(), editable: f.isEditable(), sort: f.isSorted(), multiselect: f.isMultiselect(), fontSize: fontSizeOf(f) });
  } else if (f instanceof PDFOptionList) {
    Object.assign(props, { options: f.getOptions(), sort: f.isSorted(), multiselect: f.isMultiselect(), fontSize: fontSizeOf(f) });
  } else if (f instanceof PDFRadioGroup) {
    Object.assign(props, { options: f.getOptions() });
  }
  const widgets = ws
    .map(({ widget, ref }) => {
      const r = widget.getRectangle();
      return { page: pageIndexOf(maps, ref, widget), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    })
    .filter((w) => w.page >= 0);
  const base = { name: f.getName(), readOnly: props.readOnly || props.lockedContents, props, widgets };
  if (f instanceof PDFTextField) return { ...base, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline() };
  if (f instanceof PDFCheckBox) return { ...base, kind: 'checkbox', value: f.isChecked() };
  if (f instanceof PDFRadioGroup) return { ...base, kind: 'radio', value: f.getSelected() ?? '', options: f.getOptions() };
  if (f instanceof PDFDropdown) return { ...base, kind: 'dropdown', value: f.getSelected()[0] ?? '', options: f.getOptions() };
  if (f instanceof PDFOptionList) return { ...base, kind: 'list', value: f.getSelected(), options: f.getOptions() };
  return { ...base, kind: kind as 'signature' | 'button' | 'other' };
}

async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

export async function getFormFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  const doc = await load(bytes);
  const maps = pageMapsOf(doc);
  return doc.getForm().getFields().map((f) => describeField(doc, f, maps));
}

/** Save after form changes, regenerating field appearances where pdf-lib needs to. */
export async function saveForm(doc: PDFDocument, unicodeFont?: () => Promise<Uint8Array | null>): Promise<Uint8Array> {
  try {
    return await saveDoc(doc);
  } catch (e) {
    // Values Helvetica cannot encode: regenerate appearances with a Unicode font.
    if (!unicodeFont || !/encode|WinAnsi/i.test(String((e as Error).message))) throw e;
    const bytes = await unicodeFont();
    if (!bytes) throw e;
    const { loadFontkit } = await import('./fonts');
    doc.registerFontkit(await loadFontkit());
    doc.getForm().updateFieldAppearances(await doc.embedFont(bytes, { subset: false }));
    return saveDoc(doc);
  }
}

function fieldNamed(doc: PDFDocument, name: string): PDFField {
  const f = doc.getForm().getFieldMaybe(name);
  if (!f) throw new Error(`No form field named “${name}”.`);
  return f;
}

// ---------------------------------------------------------------- design

/** Change field properties. Locked fields only accept changes to the lock itself. */
export async function updateField(bytes: Uint8Array, name: string, patch: FieldPatch): Promise<Uint8Array> {
  const doc = await load(bytes);
  const f = fieldNamed(doc, name);
  const ws = widgetsOf(f).map((w) => w.widget);
  const current = describeField(doc, f).props;
  const onlyLock = Object.keys(patch).every((k) => k === 'locked');
  if (current.locked && patch.locked !== false && !onlyLock) throw new Error(`“${name}” is locked. Unlock it first.`);

  if (patch.name !== undefined && patch.name !== name) {
    const trimmed = patch.name.trim();
    if (!trimmed || /\./.test(trimmed)) throw new Error('Field names must be non-empty and contain no dots.');
    const parent = name.includes('.') ? name.slice(0, name.lastIndexOf('.') + 1) : '';
    if (doc.getForm().getFieldMaybe(parent + trimmed)) throw new Error(`A field named “${parent + trimmed}” already exists.`);
    f.acroField.setPartialName(trimmed);
  }
  if (patch.tooltip !== undefined) {
    if (patch.tooltip) f.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(patch.tooltip));
    else f.acroField.dict.delete(PDFName.of('TU'));
  }
  if (patch.readOnly !== undefined) {
    if (patch.readOnly) f.enableReadOnly();
    else {
      f.disableReadOnly();
      ws.forEach((w) => w.setFlagTo(F_READONLY, false));
    }
  }
  if (patch.required !== undefined) (patch.required ? f.enableRequired() : f.disableRequired());
  if (patch.noExport !== undefined) (patch.noExport ? f.disableExporting() : f.enableExporting());
  if (patch.locked !== undefined) ws.forEach((w) => w.setFlagTo(F_LOCKED, patch.locked!));
  if (patch.lockedContents !== undefined) ws.forEach((w) => w.setFlagTo(F_LOCKED_CONTENTS, patch.lockedContents!));
  if (patch.visibility) ws.forEach((w) => applyVisibility(w, patch.visibility!));

  if (f instanceof PDFTextField) {
    if (patch.multiline !== undefined) (patch.multiline ? f.enableMultiline() : f.disableMultiline());
    if (patch.password !== undefined) (patch.password ? f.enablePassword() : f.disablePassword());
    if (patch.scroll !== undefined) (patch.scroll ? f.enableScrolling() : f.disableScrolling());
    if (patch.spellcheck !== undefined) (patch.spellcheck ? f.enableSpellChecking() : f.disableSpellChecking());
    if ('maxLength' in patch) {
      const max = patch.maxLength && patch.maxLength > 0 ? Math.floor(patch.maxLength) : undefined;
      if (max !== undefined && (f.getText() ?? '').length > max) f.setText((f.getText() ?? '').slice(0, max));
      if (!max && (patch.comb ?? f.isCombed())) f.disableCombing();
      f.setMaxLength(max);
    }
    if (patch.comb !== undefined) {
      if (patch.comb && !f.getMaxLength()) throw new Error('Comb fields need a maximum length.');
      if (patch.comb) f.enableCombing();
      else f.disableCombing();
    }
    if (patch.alignment) f.setAlignment(ALIGN.indexOf(patch.alignment) as never);
    if (patch.fontSize !== undefined) f.setFontSize(Math.max(0, patch.fontSize));
  }
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
    if (patch.options) {
      const options = patch.options.map((o) => o.trim()).filter(Boolean);
      const selected = f.getSelected().filter((s) => options.includes(s));
      f.setOptions(options);
      if (selected.length) f.select(f instanceof PDFDropdown ? selected[0] : selected);
    }
    if (patch.sort !== undefined) (patch.sort ? f.enableSorting() : f.disableSorting());
    if (patch.multiselect !== undefined) (patch.multiselect ? f.enableMultiselect() : f.disableMultiselect());
    if (patch.fontSize !== undefined) f.setFontSize(Math.max(0, patch.fontSize));
  }
  if (f instanceof PDFDropdown && patch.editable !== undefined) (patch.editable ? f.enableEditing() : f.disableEditing());
  return saveForm(doc);
}

export type NewFieldKind = 'text' | 'checkbox' | 'dropdown' | 'list' | 'radio';

/** Pick a free field name like "Text3". */
export function uniqueFieldName(existing: string[], kind: NewFieldKind): string {
  const prefix = { text: 'Text', checkbox: 'Check', dropdown: 'Dropdown', list: 'List', radio: 'Radio' }[kind];
  let n = 1;
  while (existing.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export async function createField(bytes: Uint8Array, kind: NewFieldKind, page: number, rect: Rect, name?: string): Promise<{ bytes: Uint8Array; name: string }> {
  const doc = await load(bytes);
  const form = doc.getForm();
  const fieldName = name ?? uniqueFieldName(form.getFields().map((f) => f.getName()), kind);
  if (form.getFieldMaybe(fieldName)) throw new Error(`A field named “${fieldName}” already exists.`);
  const pg = doc.getPage(page);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // pdf-lib grows the widget by half its border width on each side; compensate.
  const b = 0.5;
  const at = { x: rect.x + b, y: rect.y + b, width: Math.max(4, rect.w - 2 * b), height: Math.max(4, rect.h - 2 * b), font };
  switch (kind) {
    case 'text':
      form.createTextField(fieldName).addToPage(pg, at);
      break;
    case 'checkbox':
      form.createCheckBox(fieldName).addToPage(pg, at);
      break;
    case 'dropdown': {
      const d = form.createDropdown(fieldName);
      d.addOptions(['Option 1', 'Option 2', 'Option 3']);
      d.addToPage(pg, at);
      break;
    }
    case 'list': {
      const l = form.createOptionList(fieldName);
      l.addOptions(['Option 1', 'Option 2', 'Option 3']);
      l.addToPage(pg, at);
      break;
    }
    case 'radio':
      form.createRadioGroup(fieldName).addOptionToPage('Choice1', pg, at);
      break;
  }
  return { bytes: await saveForm(doc), name: fieldName };
}

/** Add another button to a radio group, below its last one. */
export async function addRadioOption(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const doc = await load(bytes);
  const f = fieldNamed(doc, name);
  if (!(f instanceof PDFRadioGroup)) throw new Error('Only radio groups take extra buttons.');
  const info = describeField(doc, f);
  const last = info.widgets[info.widgets.length - 1];
  if (!last) throw new Error('The radio group has no buttons on a page.');
  const options = f.getOptions();
  let n = options.length + 1;
  while (options.includes(`Choice${n}`)) n++;
  const b = 0.5; // see createField
  f.addOptionToPage(`Choice${n}`, doc.getPage(last.page), { x: last.rect.x + b, y: last.rect.y - last.rect.h * 1.6 + b, width: last.rect.w - 2 * b, height: last.rect.h - 2 * b });
  return saveForm(doc);
}

export async function deleteField(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const doc = await load(bytes);
  const f = fieldNamed(doc, name);
  if (describeField(doc, f).props.locked) throw new Error(`“${name}” is locked. Unlock it first.`);
  doc.getForm().removeField(f);
  return saveForm(doc);
}

/** Move/resize one widget of a field (user-space rectangle). */
export async function setWidgetRect(bytes: Uint8Array, name: string, index: number, rect: Rect): Promise<Uint8Array> {
  const doc = await load(bytes);
  const f = fieldNamed(doc, name);
  const ws = widgetsOf(f);
  const w = ws[index]?.widget;
  if (!w) throw new Error('No such widget.');
  if (w.hasFlag(F_LOCKED)) throw new Error(`“${name}” is locked. Unlock it first.`);
  w.setRectangle({ x: rect.x, y: rect.y, width: Math.max(4, rect.w), height: Math.max(4, rect.h) });
  // Regenerate the appearance at the new size on save.
  doc.getForm().markFieldAsDirty(f.ref);
  return saveForm(doc);
}


/** Lock or unlock every field (or the named ones) at once. */
export async function setFieldsLocked(bytes: Uint8Array, locked: boolean, names?: string[]): Promise<{ bytes: Uint8Array; changed: number }> {
  const doc = await load(bytes);
  let changed = 0;
  for (const f of doc.getForm().getFields()) {
    if (names && !names.includes(f.getName())) continue;
    for (const { widget } of widgetsOf(f)) {
      if (widget.hasFlag(F_LOCKED) !== locked) {
        widget.setFlagTo(F_LOCKED, locked);
        changed++;
      }
    }
  }
  return { bytes: changed ? await saveForm(doc) : bytes, changed };
}

/** Why a field cannot be filled in, in words (empty when it can). */
export function fillBlockers(f: FieldInfo): string[] {
  const out: string[] = [];
  if (f.props.readOnly) out.push('it is marked read-only');
  if (f.props.lockedContents) out.push('its value is locked');
  if (f.kind === 'signature') out.push('it is a signature field (use Protect → Sign)');
  if (f.kind === 'button' || f.kind === 'other') out.push('this field type cannot be filled in here');
  return out;
}

/**
 * Make every field editable and fillable: clear read-only (field and widget
 * flags), value locks and the Locked flag.
 */
export async function makeFieldsEditable(bytes: Uint8Array): Promise<{ bytes: Uint8Array; changed: number }> {
  const doc = await load(bytes);
  let changed = 0;
  for (const f of doc.getForm().getFields()) {
    let touched = false;
    if (f.isReadOnly()) {
      f.disableReadOnly();
      touched = true;
    }
    for (const { widget } of widgetsOf(f)) {
      for (const flag of [F_READONLY, F_LOCKED, F_LOCKED_CONTENTS]) {
        if (widget.hasFlag(flag)) {
          widget.setFlagTo(flag, false);
          touched = true;
        }
      }
    }
    if (touched) changed++;
  }
  return { bytes: changed ? await saveForm(doc) : bytes, changed };
}
