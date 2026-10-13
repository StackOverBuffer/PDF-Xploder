import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import * as forms from '../src/lib/forms';

async function blank(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 400]);
  return doc.save();
}
const field = async (bytes: Uint8Array, name: string) => (await forms.getFormFields(bytes)).find((f) => f.name === name)!;

describe('form design', () => {
  it('creates every field kind with unique names and widget positions', async () => {
    let bytes = await blank(2);
    for (const kind of ['text', 'text', 'checkbox', 'dropdown', 'list', 'radio'] as const) {
      bytes = (await forms.createField(bytes, kind, 1, { x: 20, y: 300, w: 150, h: 22 })).bytes;
    }
    const fields = await forms.getFormFields(bytes);
    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ['Text1', 'text'], ['Text2', 'text'], ['Check1', 'checkbox'], ['Dropdown1', 'dropdown'], ['List1', 'list'], ['Radio1', 'radio'],
    ]);
    expect(fields[0].widgets).toEqual([{ page: 1, rect: { x: 20, y: 300, w: 150, h: 22 } }]);
    expect(fields[0].props).toMatchObject({ readOnly: false, required: false, locked: false, visibility: 'visible', alignment: 'left' });
  });

  it('sets read-only, required, locked, tooltip, visibility and text options', async () => {
    let { bytes } = await forms.createField(await blank(), 'text', 0, { x: 10, y: 10, w: 200, h: 20 }, 'Name');
    bytes = await forms.updateField(bytes, 'Name', {
      readOnly: true, required: true, noExport: true, tooltip: 'Your full name', visibility: 'noPrint',
      maxLength: 10, comb: true, alignment: 'center', fontSize: 9, lockedContents: true,
    });
    const f = await field(bytes, 'Name');
    expect(f.readOnly).toBe(true);
    expect(f.props).toMatchObject({
      readOnly: true, required: true, noExport: true, tooltip: 'Your full name', visibility: 'noPrint',
      multiline: false, maxLength: 10, comb: true, alignment: 'center', fontSize: 9, lockedContents: true, locked: false,
    });
    // Clearing flags works too.
    bytes = await forms.updateField(bytes, 'Name', { readOnly: false, required: false, lockedContents: false, maxLength: 0, visibility: 'visible' });
    expect((await field(bytes, 'Name')).props).toMatchObject({ readOnly: false, required: false, lockedContents: false, maxLength: undefined, comb: false, visibility: 'visible' });
    bytes = await forms.updateField(bytes, 'Name', { multiline: true, password: false });
    expect((await field(bytes, 'Name')).props.multiline).toBe(true);
  });

  it('protects locked fields until they are unlocked', async () => {
    let { bytes } = await forms.createField(await blank(), 'checkbox', 0, { x: 10, y: 10, w: 15, h: 15 }, 'Agree');
    bytes = await forms.updateField(bytes, 'Agree', { locked: true });
    expect((await field(bytes, 'Agree')).props.locked).toBe(true);
    await expect(forms.updateField(bytes, 'Agree', { required: true })).rejects.toThrow('locked');
    await expect(forms.setWidgetRect(bytes, 'Agree', 0, { x: 50, y: 50, w: 20, h: 20 })).rejects.toThrow('locked');
    await expect(forms.deleteField(bytes, 'Agree')).rejects.toThrow('locked');
    bytes = await forms.updateField(bytes, 'Agree', { locked: false });
    bytes = await forms.setWidgetRect(bytes, 'Agree', 0, { x: 50, y: 50, w: 20, h: 20 });
    expect((await field(bytes, 'Agree')).widgets[0].rect).toEqual({ x: 50, y: 50, w: 20, h: 20 });
    bytes = await forms.deleteField(bytes, 'Agree');
    expect(await forms.getFormFields(bytes)).toEqual([]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it('renames fields, edits choice options and adds radio buttons', async () => {
    let { bytes } = await forms.createField(await blank(), 'dropdown', 0, { x: 10, y: 300, w: 120, h: 20 });
    bytes = await forms.updateField(bytes, 'Dropdown1', { name: 'Country', options: ['Germany', 'France', ' ', 'Spain'], editable: true, sort: true });
    const d = await field(bytes, 'Country');
    expect(d).toMatchObject({ kind: 'dropdown', options: ['Germany', 'France', 'Spain'], props: { editable: true, sort: true } });
    await expect(forms.updateField(bytes, 'Country', { name: 'a.b' })).rejects.toThrow();

    let r = await forms.createField(bytes, 'radio', 0, { x: 10, y: 200, w: 14, h: 14 });
    bytes = await forms.addRadioOption(r.bytes, r.name);
    const radio = await field(bytes, r.name);
    expect(radio).toMatchObject({ kind: 'radio', options: ['Choice1', 'Choice2'] });
    expect(radio.widgets.map((w) => w.rect.y)).toEqual([200, 200 - 14 * 1.6]);
  });
});
