/** German strings: Panels, dialogs, status bar, welcome screen and messages. Keys are the English text. */
const DE: Record<string, string> = {
  // welcome screen
  'View, annotate, organise, fill and sign PDFs — entirely in your browser. Files never leave your device.':
    'PDFs anzeigen, kommentieren, organisieren, ausfüllen und unterschreiben – vollständig im Browser. Ihre Dateien verlassen nie Ihr Gerät.',
  'Open PDF…': 'PDF öffnen…', 'New blank': 'Neues leeres Dokument', 'Try a sample': 'Beispiel ausprobieren',
  '…or drop PDF files here. Dropping several combines them into one document.':
    '…oder PDF-Dateien hier ablegen. Mehrere Dateien werden zu einem Dokument zusammengeführt.',
  'Creating sample…': 'Beispiel wird erstellt…',

  // common
  'Loading…': 'Wird geladen…', Cancel: 'Abbrechen', Apply: 'Anwenden', Close: 'Schließen', Save: 'Speichern', Open: 'Öffnen',
  Delete: 'Löschen', Duplicate: 'Duplizieren', Remove: 'Entfernen', Done: 'Fertig', Next: 'Weiter', Previous: 'Zurück',
  None: 'Keine', Text: 'Text', Name: 'Name', Pages: 'Seiten', 'Page {n}': 'Seite {n}', 'page {n}': 'Seite {n}', 'p.{n}': 'S. {n}',
  '{n} page(s)': '{n} Seite(n)', Colour: 'Farbe', 'Custom colour': 'Benutzerdefinierte Farbe', 'Fill colour': 'Füllfarbe', Stroke: 'Kontur',
  Opacity: 'Deckkraft', Thickness: 'Linienstärke', 'Font size': 'Schriftgröße', Font: 'Schriftart', Size: 'Größe', Width: 'Breite', Height: 'Höhe',
  Left: 'Links', Right: 'Rechts', Top: 'Oben', Bottom: 'Unten', Centre: 'Zentriert', and: 'und', valid: 'gültig', 'self-signed': 'selbstsigniert',

  // sidebar panes
  Bookmarks: 'Lesezeichen', Comments: 'Kommentare', Attachments: 'Dateianlagen', 'Form fields': 'Formularfelder', Search: 'Suche', Signatures: 'Signaturen',
  'This document has no bookmarks.': 'Dieses Dokument enthält keine Lesezeichen.',
  'Attach files': 'Dateien anhängen', 'This document has no attached files.': 'Dieses Dokument enthält keine Dateianlagen.', 'Save to disk': 'Auf Datenträger speichern',
  'Highlight fields on the page': 'Felder auf der Seite hervorheben', 'This document has no fillable form fields.': 'Dieses Dokument enthält keine ausfüllbaren Formularfelder.',
  'Cannot be filled in: {reasons}.': 'Kann nicht ausgefüllt werden: {reasons}.', 'Unsupported field type': 'Nicht unterstützter Feldtyp',
  '{n} field(s) changed — saved with the document.': '{n} Feld(er) geändert – wird mit dem Dokument gespeichert.',
  'Fill fields here or directly on the page.': 'Füllen Sie die Felder hier oder direkt auf der Seite aus.', 'Reset changes': 'Änderungen zurücksetzen',
  'Flatten form': 'Formular reduzieren', 'Flatten the form? Fields will no longer be editable.': 'Formular reduzieren? Die Felder können danach nicht mehr bearbeitet werden.',
  'Burn all annotations into the page content': 'Alle Kommentare fest in den Seiteninhalt einbetten', 'Flatten all': 'Alle reduzieren',
  'No comments yet. Use the Comment tab to highlight, draw, or add notes.':
    'Noch keine Kommentare. Verwenden Sie die Registerkarte „Anmerkungen“, um Text hervorzuheben, zu zeichnen oder Notizen hinzuzufügen.',
  'Find text…': 'Text suchen…', 'Match case': 'Groß/Klein beachten', 'Highlight all matches': 'Alle Treffer hervorheben', 'Searching…': 'Suche läuft…',
  '{n} match(es)': '{n} Treffer', '{i} of {n}': '{i} von {n}', 'Highlighted {n} match(es).': '{n} Treffer hervorgehoben.',
  'Drag a box on the page for a visible signature': 'Ziehen Sie auf der Seite einen Rahmen für eine sichtbare Signatur auf', 'Sign…': 'Signieren…',
  'This document has no digital signatures.': 'Dieses Dokument enthält keine digitalen Signaturen.', Signed: 'Signiert', Reason: 'Grund', Location: 'Ort',
  Issuer: 'Aussteller', Certificate: 'Zertifikat', Algorithm: 'Algorithmus', Field: 'Feld', invisible: 'unsichtbar',
  'Signer identity is not checked against a list of trusted certificates.': 'Die Identität des Unterzeichners wird nicht mit einer Liste vertrauenswürdiger Zertifikate abgeglichen.',
  'Rotate left': 'Links drehen', 'Rotate right': 'Rechts drehen', 'Insert blank page after': 'Leere Seite dahinter einfügen', 'Extract to new file': 'In neue Datei extrahieren',
  '{n} sel.': '{n} ausgew.', 'Has annotations': 'Enthält Kommentare',

  // signature status and banner
  Valid: 'Gültig', 'Valid, but changed later': 'Gültig, aber später geändert', Invalid: 'Ungültig', 'Could not be checked': 'Konnte nicht geprüft werden',
  'Restricted by the document’s security: {actions} is not allowed.': 'Durch die Sicherheitseinstellungen des Dokuments eingeschränkt – nicht erlaubt: {actions}.',
  'Restricted by the document’s security: {actions} are not allowed.': 'Durch die Sicherheitseinstellungen des Dokuments eingeschränkt – nicht erlaubt: {actions}.',
  'Permissions…': 'Berechtigungen…', 'At least one signature is invalid.': 'Mindestens eine Signatur ist ungültig.',
  'Some signatures could not be checked.': 'Einige Signaturen konnten nicht geprüft werden.',
  'Signed by {signer}: signatures are intact.': 'Signiert von {signer}: Die Signaturen sind intakt.',
  'Signed by {signer} and {n} other(s): signatures are intact.': 'Signiert von {signer} und {n} weiteren: Die Signaturen sind intakt.',
  'Unsaved changes will invalidate them when saved.': 'Nicht gespeicherte Änderungen machen sie beim Speichern ungültig.', 'Signature panel': 'Signaturfenster',
  // signature check details (src/lib/signature.ts)
  'The signature contains no signer.': 'Die Signatur enthält keinen Unterzeichner.', 'The signer certificate is missing.': 'Das Zertifikat des Unterzeichners fehlt.',
  'The document has been altered since it was signed.': 'Das Dokument wurde nach dem Signieren verändert.',
  'The signature uses a key type that cannot be checked here.': 'Die Signatur verwendet einen Schlüsseltyp, der hier nicht geprüft werden kann.',
  'The signature does not match the signer’s certificate.': 'Die Signatur passt nicht zum Zertifikat des Unterzeichners.',
  'The document has not been modified since this signature was applied.': 'Das Dokument wurde seit dem Anbringen dieser Signatur nicht verändert.',
  'The signature dictionary is malformed.': 'Das Signaturverzeichnis ist fehlerhaft.', 'The signed byte range does not fit the file.': 'Der signierte Bytebereich passt nicht zur Datei.',
  'The signed revision is intact, but the document was changed after this signature was applied.':
    'Die signierte Version ist intakt, das Dokument wurde jedoch nach dem Anbringen dieser Signatur geändert.',

  // status bar
  'First page': 'Erste Seite', 'Previous page': 'Vorherige Seite', 'Page number': 'Seitenzahl', 'Next page': 'Nächste Seite', 'Last page': 'Letzte Seite',
  'rotated {deg}°': 'um {deg}° gedreht', 'view rotated': 'Ansicht gedreht', 'Zoom in': 'Vergrößern', 'Zoom out': 'Verkleinern', 'Fit width': 'Seitenbreite', 'Fit page': 'Ganze Seite',

  // properties pane
  Properties: 'Eigenschaften', 'Edit form': 'Formular bearbeiten',
  'Click a field to change its properties; drag it to move it, or use the field tools to add new ones.':
    'Klicken Sie auf ein Feld, um seine Eigenschaften zu ändern, ziehen Sie es, um es zu verschieben, oder fügen Sie mit den Feldwerkzeugen neue hinzu.',
  'This document’s security settings do not allow changing form fields. Unlock it with the permissions password (Protect → Permissions).':
    'Die Sicherheitseinstellungen dieses Dokuments erlauben keine Änderung von Formularfeldern. Entsperren Sie es mit dem Berechtigungskennwort (Schützen → Berechtigungen).',
  'This document’s security settings do not allow changing form fields or filling them in. Unlock it with the permissions password (Protect → Permissions).':
    'Die Sicherheitseinstellungen dieses Dokuments erlauben weder das Ändern noch das Ausfüllen von Formularfeldern. Entsperren Sie es mit dem Berechtigungskennwort (Schützen → Berechtigungen).',
  'Some fields are protected by the document:': 'Einige Felder sind durch das Dokument geschützt:',
  'read-only (dashed outline): cannot be filled in.': 'schreibgeschützt (gestrichelter Rahmen): können nicht ausgefüllt werden.',
  'with a locked value: cannot be filled in.': 'mit gesperrtem Wert: können nicht ausgefüllt werden.',
  'locked (lock icon): cannot be moved, resized, deleted or changed. Filling in is not affected.':
    'gesperrt (Schloss-Symbol): können nicht verschoben, in der Größe geändert, gelöscht oder geändert werden. Das Ausfüllen ist nicht betroffen.',
  'Make all fields editable': 'Alle Felder bearbeitbar machen', 'Only unlock (keep read-only)': 'Nur entsperren (Schreibschutz beibehalten)',
  'Edit page content': 'Seiteninhalt bearbeiten',
  'Click an object on the page to select it, or drag around several. Double-click text to edit it.':
    'Klicken Sie auf ein Objekt, um es auszuwählen, oder ziehen Sie einen Rahmen um mehrere. Doppelklicken Sie auf Text, um ihn zu bearbeiten.',
  'Click on the page where the new text should start, type, then press Enter.':
    'Klicken Sie auf die Stelle, an der der neue Text beginnen soll, tippen Sie ihn ein und drücken Sie die Eingabetaste.',
  'Drag to draw a rectangle into the page content.': 'Ziehen Sie, um ein Rechteck in den Seiteninhalt zu zeichnen.',
  'Drag to draw an ellipse into the page content.': 'Ziehen Sie, um eine Ellipse in den Seiteninhalt zu zeichnen.',
  'Drag to draw a line into the page content.': 'Ziehen Sie, um eine Linie in den Seiteninhalt zu zeichnen.',
  Select: 'Auswahl', 'All content': 'Alle Inhalte', 'Text only': 'Nur Text', 'Images only': 'Nur Bilder', 'Shapes only': 'Nur Formen',
  'Changes are made to the page itself (not as comments) and can be undone with Ctrl+Z.':
    'Die Änderungen erfolgen direkt im Seiteninhalt (nicht als Kommentare) und können mit Strg+Z rückgängig gemacht werden.',
  'Stamp text': 'Stempeltext', Border: 'Rahmen', Note: 'Notiz', 'Type your note…': 'Notiz eingeben…', 'Comment text': 'Kommentar', 'Add a comment…': 'Kommentar hinzufügen…',
  'Redaction marks are only previews. Use': 'Schwärzungsmarkierungen sind nur eine Vorschau. Mit', 'Protect → Apply redactions': 'Schützen → Schwärzung anwenden',
  'to permanently remove the content underneath.': 'wird der Inhalt darunter dauerhaft entfernt.',
  'Select an annotation to edit it, or pick a tool from the Comment tab.': 'Wählen Sie einen Kommentar zum Bearbeiten aus oder ein Werkzeug auf der Registerkarte „Anmerkungen“.',
  'Author name': 'Name des Autors',
  // annotation types (src/lib/annotGeom.ts)
  Highlight: 'Hervorheben', Underline: 'Unterstreichen', Strikeout: 'Durchstreichen', Pencil: 'Stift', Rectangle: 'Rechteck', Ellipse: 'Ellipse', Line: 'Linie',
  Arrow: 'Pfeil', 'Text box': 'Textfeld', 'Sticky note': 'Notiz', Image: 'Bild', Stamp: 'Stempel', 'Redaction mark': 'Schwärzungsmarkierung', Signature: 'Unterschrift',
  // tools
  'Highlight tool': 'Werkzeug Hervorheben', 'Underline tool': 'Werkzeug Unterstreichen', 'Strikeout tool': 'Werkzeug Durchstreichen', 'Pencil tool': 'Werkzeug Stift',
  'Rectangle tool': 'Werkzeug Rechteck', 'Ellipse tool': 'Werkzeug Ellipse', 'Line tool': 'Werkzeug Linie', 'Arrow tool': 'Werkzeug Pfeil', 'Text box tool': 'Werkzeug Textfeld',
  'Sticky note tool': 'Werkzeug Notiz', 'Stamp tool': 'Werkzeug Stempel', 'Redact tool': 'Werkzeug Schwärzen', 'Signature tool': 'Werkzeug Unterschrift',
  'Text field tool': 'Werkzeug Textfeld (Formular)', 'Check box tool': 'Werkzeug Kontrollkästchen', 'Dropdown tool': 'Werkzeug Kombinationsfeld', 'List box tool': 'Werkzeug Listenfeld',
  'Radio button tool': 'Werkzeug Optionsfeld',
  'Select text on the page to highlight it.': 'Markieren Sie Text auf der Seite, um ihn hervorzuheben.',
  'Select text on the page to underline it.': 'Markieren Sie Text auf der Seite, um ihn zu unterstreichen.',
  'Select text on the page to strike it out.': 'Markieren Sie Text auf der Seite, um ihn durchzustreichen.',
  'Draw freehand on the page.': 'Zeichnen Sie freihand auf der Seite.',
  'Drag to draw. Hold Shift for a square.': 'Zum Zeichnen ziehen. Umschalttaste halten für ein Quadrat.',
  'Drag to draw. Hold Shift for a circle.': 'Zum Zeichnen ziehen. Umschalttaste halten für einen Kreis.',
  'Drag to draw. Hold Shift to snap to 45°.': 'Zum Zeichnen ziehen. Umschalttaste halten zum Einrasten in 45°-Schritten.',
  'Click or drag to place a text box, then type.': 'Klicken oder ziehen Sie, um ein Textfeld zu platzieren, und tippen Sie dann.',
  'Click to place a sticky note.': 'Klicken Sie, um eine Notiz zu platzieren.', 'Click or drag to place the stamp.': 'Klicken oder ziehen Sie, um den Stempel zu platzieren.',
  'Drag a box for the new text field.': 'Ziehen Sie einen Rahmen für das neue Textfeld auf.', 'Click or drag to place a check box.': 'Klicken oder ziehen Sie, um ein Kontrollkästchen zu platzieren.',
  'Drag a box for the new dropdown.': 'Ziehen Sie einen Rahmen für das neue Kombinationsfeld auf.', 'Drag a box for the new list box.': 'Ziehen Sie einen Rahmen für das neue Listenfeld auf.',
  'Click to place a radio button; add more from its properties.': 'Klicken Sie, um ein Optionsfeld zu platzieren; weitere fügen Sie in seinen Eigenschaften hinzu.',
  'Drag a box where the signature should appear.': 'Ziehen Sie einen Rahmen an der Stelle auf, an der die Signatur erscheinen soll.',
  'Drag over content to mark it for redaction.': 'Ziehen Sie über Inhalte, um sie zum Schwärzen zu markieren.',

  // field properties
  'Text field': 'Textfeld', 'Check box': 'Kontrollkästchen', 'Radio buttons': 'Optionsfelder', Dropdown: 'Kombinationsfeld', 'List box': 'Listenfeld',
  'Signature field': 'Signaturfeld', Button: 'Schaltfläche', '{n} widget(s)': '{n} Widget(s)',
  'This document’s security settings do not allow changing form fields.': 'Die Sicherheitseinstellungen dieses Dokuments erlauben keine Änderung von Formularfeldern.',
  Locked: 'Gesperrt', 'The field cannot be moved, resized, deleted or changed until it is unlocked':
    'Das Feld kann erst nach dem Entsperren verschoben, in der Größe geändert, gelöscht oder geändert werden',
  'This field has the PDF “Locked” flag: it cannot be moved, resized, deleted or changed until you untick Locked (or use Form → Unlock all). Filling it in still works.':
    'Dieses Feld hat das PDF-Kennzeichen „Gesperrt“: Es kann erst verschoben, in der Größe geändert, gelöscht oder geändert werden, wenn Sie „Gesperrt“ deaktivieren (oder Formular → Alle entsperren verwenden). Ausfüllen ist weiterhin möglich.',
  Tooltip: 'QuickInfo', 'Shown when hovering the field': 'Wird angezeigt, wenn der Mauszeiger auf dem Feld steht', Behaviour: 'Verhalten', 'Read only': 'Schreibgeschützt',
  'The value cannot be changed when filling in the form': 'Der Wert kann beim Ausfüllen des Formulars nicht geändert werden', Required: 'Erforderlich',
  'Value locked': 'Wert gesperrt', "The field's value cannot be changed (annotation flag LockedContents)": 'Der Wert des Feldes kann nicht geändert werden (Kennzeichen LockedContents)',
  'Exclude from export': 'Nicht exportieren', 'Not included when the form data is submitted or exported': 'Wird beim Senden oder Exportieren der Formulardaten nicht berücksichtigt',
  Visibility: 'Sichtbarkeit', Visible: 'Sichtbar', Hidden: 'Ausgeblendet', 'Visible but doesn’t print': 'Sichtbar, aber nicht drucken', 'Hidden but printable': 'Ausgeblendet, aber druckbar',
  'Text options': 'Textoptionen', Alignment: 'Ausrichtung', 'Font size (0 = auto)': 'Schriftgröße (0 = automatisch)', 'Maximum length (empty = none)': 'Maximale Länge (leer = keine)',
  'Multi-line': 'Mehrzeilig', 'Password (hide characters)': 'Kennwort (Zeichen verbergen)', 'Comb of characters': 'Zeichenkamm', 'Needs a maximum length': 'Erfordert eine maximale Länge',
  'Scroll long text': 'Langen Text scrollen', 'Check spelling': 'Rechtschreibung prüfen', 'Options (one per line)': 'Optionen (eine pro Zeile)', 'Allow custom text': 'Eigenen Text zulassen',
  'Sort options': 'Optionen sortieren', 'Multiple selection': 'Mehrfachauswahl', 'Buttons:': 'Schaltflächen:', 'Add button': 'Schaltfläche hinzufügen', 'Delete field': 'Feld löschen',
  // fill blockers (src/lib/forms.ts) and form widgets
  'it is marked read-only': 'es ist schreibgeschützt', 'its value is locked': 'sein Wert ist gesperrt',
  'it is a signature field (use Protect → Sign)': 'es ist ein Signaturfeld (verwenden Sie Schützen → Signieren)',
  'this field type cannot be filled in here': 'dieser Feldtyp kann hier nicht ausgefüllt werden',
  'the document’s security settings do not allow filling in forms': 'die Sicherheitseinstellungen des Dokuments erlauben kein Ausfüllen von Formularen',
  '{name}: cannot be filled in because {reasons}.': '{name}: kann nicht ausgefüllt werden, da {reasons}.',
  'Open this link in a new tab?': 'Diesen Link in einem neuen Tab öffnen?', 'Go to destination': 'Zum Ziel springen',
  locked: 'gesperrt', 'read-only': 'schreibgeschützt', required: 'erforderlich', 'Double-click to edit': 'Zum Bearbeiten doppelklicken',

  // content properties
  Shape: 'Form', 'Form XObject': 'Formular-XObject', Shading: 'Schattierung', '{n} objects': '{n} Objekte', clipped: 'beschnitten',
  'This document’s security settings do not allow changing it.': 'Die Sicherheitseinstellungen dieses Dokuments erlauben keine Änderungen.',
  'Rotate by': 'Drehen um', 'Flip horizontally': 'Horizontal spiegeln', 'Flip vertically': 'Vertikal spiegeln', 'Bring to front': 'In den Vordergrund',
  'Bring forward': 'Eine Ebene nach vorne', 'Send backward': 'Eine Ebene nach hinten', 'Send to back': 'In den Hintergrund',
  'Align to page': 'An Seite ausrichten', 'Align to selection': 'An Auswahl ausrichten', 'Align left': 'Links ausrichten', 'Align centre': 'Horizontal zentrieren',
  'Align right': 'Rechts ausrichten', 'Align top': 'Oben ausrichten', 'Align middle': 'Vertikal zentrieren', 'Align bottom': 'Unten ausrichten',
  'Distribute horizontally': 'Horizontal verteilen', 'Distribute vertically': 'Vertikal verteilen', 'Same width': 'Gleiche Breite', 'Same height': 'Gleiche Höhe',
  'Change font…': 'Schriftart ändern…', 'Horizontal scale': 'Horizontale Skalierung', 'Char spacing': 'Zeichenabstand', 'Word spacing': 'Wortabstand',
  'Baseline shift': 'Grundlinienversatz', 'Line width': 'Linienstärke', 'Replace image…': 'Bild ersetzen…', 'Export as PNG': 'Als PNG exportieren',
  'Remove the clipping path': 'Beschneidungspfad entfernen', 'Remove clip': 'Beschneidung entfernen', Content: 'Inhalt',
  'Drag to move, drag the handles to resize or rotate (Shift: keep proportions / 15° steps). Double-click text to edit it. Arrow keys nudge.':
    'Zum Verschieben ziehen, an den Griffen ziehen zum Skalieren oder Drehen (Umschalttaste: Proportionen beibehalten / 15°-Schritte). Doppelklick auf Text zum Bearbeiten. Pfeiltasten verschieben schrittweise.',

  // dialogs
  'all, or e.g. 1-3, 5': 'alle, oder z. B. 1-3, 5', all: 'alle',
  'Add watermark': 'Wasserzeichen hinzufügen', CONFIDENTIAL: 'VERTRAULICH', Angle: 'Winkel',
  'Header, footer & Bates numbering': 'Kopf- und Fußzeile & Bates-Nummerierung', 'Page {page} of {pages}': 'Seite {page} von {pages}', 'Placeholders:': 'Platzhalter:',
  Presets: 'Vorlagen', 'Page X of Y': 'Seite X von Y', 'Number only': 'Nur Nummer', Position: 'Position',
  'top left': 'oben links', 'top center': 'oben Mitte', 'top right': 'oben rechts', 'bottom left': 'unten links', 'bottom center': 'unten Mitte', 'bottom right': 'unten rechts',
  'Margin (pt)': 'Rand (pt)', 'Start number': 'Startnummer', 'Bates prefix': 'Bates-Präfix', 'Bates digits': 'Bates-Stellen',
  'Crop pages': 'Seiten zuschneiden', Crop: 'Zuschneiden', 'Margins in points (72 pt = 1 inch), measured on the page as displayed.':
    'Ränder in Punkt (72 pt = 1 Zoll), gemessen an der angezeigten Seite.',
  'Split document': 'Dokument aufteilen', Split: 'Teilen', 'Pages per file': 'Seiten pro Datei',
  'Creates {n} file(s). Your browser may ask permission to download multiple files.': 'Erstellt {n} Datei(en). Ihr Browser fragt eventuell nach der Erlaubnis, mehrere Dateien herunterzuladen.',
  'Document properties': 'Dokumenteigenschaften', Title: 'Titel', Author: 'Autor', Subject: 'Thema', Keywords: 'Stichwörter', Creator: 'Anwendung', Producer: 'PDF-Erzeuger',
  'Go to page': 'Gehe zu Seite', Go: 'Gehe zu', 'Page (1–{count})': 'Seite (1–{count})',
  'Add signature': 'Unterschrift hinzufügen', 'Place signature': 'Unterschrift platzieren', Draw: 'Zeichnen', Type: 'Eingeben', Upload: 'Hochladen', Ink: 'Tinte',
  'Sign above with your mouse, pen or finger.': 'Unterschreiben Sie oben mit Maus, Stift oder Finger.', Clear: 'Löschen', 'Your name': 'Ihr Name',
  'Signature preview': 'Vorschau der Unterschrift',
  'This places a visual signature image. Cryptographic (certificate-based) digital signatures are on the roadmap.':
    'Hiermit wird ein Bild der Unterschrift platziert. Kryptografische (zertifikatbasierte) digitale Signaturen sind geplant.',
  'Keyboard shortcuts': 'Tastenkürzel', Print: 'Drucken', 'Undo / Redo': 'Rückgängig / Wiederholen', Find: 'Suche', 'Zoom in / out': 'Vergrößern / Verkleinern',
  'Delete selected annotation': 'Ausgewählten Kommentar löschen', 'Select tool / deselect': 'Auswahlwerkzeug / Auswahl aufheben', 'Edit comments': 'Anmerkungen bearbeiten',
  'Select text': 'Textauswahl', Snapshot: 'Bildschirmfoto', Hand: 'Hand', 'Previous / next page': 'Vorherige / nächste Seite',
  'Accessibility check': 'Barrierefreiheit prüfen', 'Checking…': 'Wird geprüft…', '{n} of {count} checks need attention.': '{n} von {count} Prüfungen erfordern Aufmerksamkeit.',
  'All checks passed.': 'Alle Prüfungen bestanden.', 'This is a quick structural check, not a full PDF/UA validation.': 'Dies ist eine schnelle Strukturprüfung, keine vollständige PDF/UA-Validierung.',
  Fix: 'Beheben', Passed: 'Bestanden', Warning: 'Warnung', Failed: 'Nicht bestanden',
  // accessibility checks (src/lib/accessibility.ts)
  'Tagged PDF': 'PDF mit Tags', 'The document has a structure tree for screen readers.': 'Das Dokument hat eine Strukturhierarchie für Bildschirmleseprogramme.',
  'The document is not tagged; screen readers have to guess the reading order.': 'Das Dokument hat keine Tags; Bildschirmleseprogramme müssen die Lesereihenfolge erraten.',
  'Document language': 'Dokumentsprache', 'Language is set to “{lang}”.': 'Die Sprache ist auf „{lang}“ festgelegt.',
  'No language is set, so text may be read with the wrong pronunciation.': 'Es ist keine Sprache festgelegt, daher wird Text möglicherweise falsch ausgesprochen.',
  'Title: “{title}”.': 'Titel: „{title}“.', 'The document has no title.': 'Das Dokument hat keinen Titel.', 'Title shown in window': 'Titel in der Titelleiste',
  'Viewers show the title instead of the file name.': 'Anzeigeprogramme zeigen den Titel statt des Dateinamens an.',
  'Viewers show the file name instead of the title.': 'Anzeigeprogramme zeigen den Dateinamen statt des Titels an.',
  'Real text': 'Echter Text', 'Page {pages} contains no text (scanned or image-only?).': 'Seite {pages} enthält keinen Text (gescannt oder nur Bilder?).',
  'Pages {pages} contain no text (scanned or image-only?).': 'Die Seiten {pages} enthalten keinen Text (gescannt oder nur Bilder?).',
  'Every page has extractable text.': 'Jede Seite enthält extrahierbaren Text.', 'Form field descriptions': 'Beschreibungen der Formularfelder',
  '{n} field(s) have no tooltip: {names}.': '{n} Feld(er) ohne QuickInfo: {names}.', 'Every form field has a tooltip.': 'Jedes Formularfeld hat eine QuickInfo.',
  'Assistive technology access': 'Zugriff für Hilfstechnologien', 'Security settings allow screen readers to extract text.':
    'Die Sicherheitseinstellungen erlauben Bildschirmleseprogrammen, Text zu extrahieren.',
  'Security settings block text extraction for accessibility.': 'Die Sicherheitseinstellungen verhindern die Textextraktion für die Barrierefreiheit.',

  // security dialogs
  'That is not the permissions (owner) password.': 'Das ist nicht das Berechtigungskennwort (Besitzerkennwort).',
  'Changing this document’s security requires its': 'Zum Ändern der Sicherheit dieses Dokuments benötigen Sie sein', 'permissions password': 'Berechtigungskennwort',
  '(owner password). Enter it to lift the restrictions for this session.': '(Besitzerkennwort). Geben Sie es ein, um die Einschränkungen für diese Sitzung aufzuheben.',
  Password: 'Kennwort', Unlock: 'Entsperren', 'Unlocking…': 'Wird entsperrt…', Allowed: 'Erlaubt', 'Not allowed': 'Nicht erlaubt',
  'Printing is limited to low resolution.': 'Drucken ist auf niedrige Auflösung beschränkt.', Printing: 'Drucken',
  'Low resolution (150 dpi)': 'Niedrige Auflösung (150 dpi)', 'High resolution': 'Hohe Auflösung',
  'Changing the document': 'Ändern des Dokuments', 'content, page marks, form design': 'Inhalt, Seitenmarkierungen, Formulargestaltung',
  'Inserting, deleting and rotating pages': 'Einfügen, Löschen und Drehen von Seiten', Commenting: 'Kommentieren', 'also allows filling in forms': 'erlaubt auch das Ausfüllen von Formularen',
  'Filling in form fields and signing': 'Ausfüllen von Formularfeldern und Signieren', 'Copying text and images, extracting pages': 'Kopieren von Text und Bildern, Extrahieren von Seiten',
  'Text access for screen readers': 'Textzugriff für Bildschirmleseprogramme', 'Allow all': 'Alles erlauben', 'Read & print only': 'Nur lesen und drucken',
  'Comments & forms only': 'Nur Kommentare und Formulare', 'Forms only': 'Nur Formulare',
  'Security settings will be applied when you save.': 'Die Sicherheitseinstellungen werden beim Speichern angewendet.',
  'Security will be removed when you save.': 'Die Sicherheit wird beim Speichern entfernt.',
  'Set a permissions password: it is needed to change these settings later.': 'Legen Sie ein Berechtigungskennwort fest: Es wird benötigt, um diese Einstellungen später zu ändern.',
  'The permissions password must differ from the open password.': 'Das Berechtigungskennwort muss sich vom Kennwort zum Öffnen unterscheiden.',
  'Document permissions': 'Dokumentberechtigungen', 'Restrictions in effect': 'Geltende Einschränkungen', 'Allow others to': 'Anderen erlauben',
  // Soft hyphen: the dialog's label column is narrow.
  'Permissions password': 'Berechtigungs\u00ADkennwort', 'needed to change permissions later': 'wird zum späteren Ändern der Berechtigungen benötigt',
  'This document is signed. Changing its security rewrites the file and invalidates the signatures.':
    'Dieses Dokument ist signiert. Eine Änderung der Sicherheit schreibt die Datei neu und macht die Signaturen ungültig.',
  'Permissions are enforced by PDF software (this app included) for anyone without the permissions password. PDF has no permission that prevents saving a copy: to stop others from saving changes, disallow changing, commenting and form filling. Permissions are applied when you save.':
    'Berechtigungen werden von PDF-Programmen (auch von diesem) für alle ohne Berechtigungskennwort durchgesetzt. PDF kennt keine Berechtigung, die das Speichern einer Kopie verhindert: Um zu verhindern, dass andere Änderungen speichern, verbieten Sie das Ändern, Kommentieren und Ausfüllen von Formularen. Die Berechtigungen werden beim Speichern angewendet.',
  'Password security': 'Kennwortschutz', 'Enter the password needed to open the document.': 'Geben Sie das Kennwort zum Öffnen des Dokuments ein.',
  'This document restricts permissions: keep a permissions password.': 'Dieses Dokument schränkt Berechtigungen ein: Behalten Sie ein Berechtigungskennwort bei.',
  'The two passwords must differ, or anyone who can open the file could lift the restrictions.':
    'Die beiden Kennwörter müssen sich unterscheiden, sonst könnte jeder, der die Datei öffnen kann, die Einschränkungen aufheben.',
  'On save: encrypted with {algorithm}.': 'Beim Speichern: verschlüsselt mit {algorithm}.', 'On save: no encryption.': 'Beim Speichern: keine Verschlüsselung.',
  'On save: unchanged ({algorithm}).': 'Beim Speichern: unverändert ({algorithm}).', 'Remove security': 'Sicherheit entfernen',
  'Opened file: encrypted ({algorithm}).': 'Geöffnete Datei: verschlüsselt ({algorithm}).', 'Opened file: not encrypted.': 'Geöffnete Datei: nicht verschlüsselt.',
  'Require a password to open the document': 'Kennwort zum Öffnen des Dokuments verlangen', 'Open password': 'Kennwort zum Öffnen',
  optional: 'optional', Permissions: 'Berechtigungen', 'Some actions are restricted.': 'Einige Aktionen sind eingeschränkt.', 'Everything is allowed.': 'Alles ist erlaubt.',
  'Edit permissions…': 'Berechtigungen bearbeiten…', Encryption: 'Verschlüsselung', 'AES-256 (Acrobat X and later)': 'AES-256 (Acrobat X und höher)',
  'AES-128 (Acrobat 7 and later)': 'AES-128 (Acrobat 7 und höher)',
  'Creates a self-signed certificate for trying out signing. Signatures made with it are mathematically valid, but other people’s software will not recognise you as a trusted signer.':
    'Erstellt ein selbstsigniertes Zertifikat zum Ausprobieren des Signierens. Damit erstellte Signaturen sind mathematisch gültig, aber die Software anderer erkennt Sie nicht als vertrauenswürdigen Unterzeichner.',
  Email: 'E-Mail', 'Protect with': 'Schützen mit', password: 'Kennwort', 'Creating…': 'Wird erstellt…', 'Create and download .p12': '.p12 erstellen und herunterladen',
  'I approve this document': 'Ich genehmige dieses Dokument', 'Sign with a certificate': 'Mit einem Zertifikat signieren', 'Sign and save': 'Signieren und speichern',
  'Issued by {issuer}': 'Ausgestellt von {issuer}', 'This certificate is not valid today.': 'Dieses Zertifikat ist heute nicht gültig.', Hide: 'Ausblenden',
  'No certificate? Create a test certificate…': 'Kein Zertifikat? Testzertifikat erstellen…', 'test certificate': 'Testzertifikat', Contact: 'Kontakt',
  'A visible signature is placed on page {n} where you drew it.': 'Eine sichtbare Signatur wird auf Seite {n} an der aufgezogenen Stelle platziert.',
  'Invisible signature. To show it on a page, use Protect → Sign and drag a box.':
    'Unsichtbare Signatur. Um sie auf einer Seite anzuzeigen, verwenden Sie Schützen → Signieren und ziehen Sie einen Rahmen auf.',
  'The signed file is downloaded and reopened; existing signatures stay valid.': 'Die signierte Datei wird heruntergeladen und erneut geöffnet; vorhandene Signaturen bleiben gültig.',

  // permissions (src/store/permissions.ts)
  'Filling in form fields': 'Ausfüllen von Formularfeldern', 'Creating and changing form fields': 'Erstellen und Ändern von Formularfeldern',
  'Copying content and extracting pages': 'Kopieren von Inhalten und Extrahieren von Seiten', 'Changing security': 'Ändern der Sicherheit',
  'This document is read-only.': 'Dieses Dokument ist schreibgeschützt.',
  '{action} is not allowed by this document’s security settings. Unlock it with the permissions password to change them.':
    '{action} ist durch die Sicherheitseinstellungen dieses Dokuments nicht erlaubt. Entsperren Sie es mit dem Berechtigungskennwort, um sie zu ändern.',

  // store messages, prompts and progress
  'Incorrect password. Try again:': 'Falsches Kennwort. Versuchen Sie es erneut:',
  'This document is password protected. Enter password:': 'Dieses Dokument ist kennwortgeschützt. Geben Sie das Kennwort ein:',
  'This document is damaged or uses unsupported encryption: it is open read-only.':
    'Dieses Dokument ist beschädigt oder verwendet eine nicht unterstützte Verschlüsselung: Es ist schreibgeschützt geöffnet.',
  'Please choose a PDF file.': 'Bitte wählen Sie eine PDF-Datei.', 'Discard unsaved changes?': 'Nicht gespeicherte Änderungen verwerfen?',
  'This document is digitally signed. Saving your changes rewrites the file, which invalidates the existing signatures. Continue?':
    'Dieses Dokument ist digital signiert. Beim Speichern Ihrer Änderungen wird die Datei neu geschrieben, wodurch die vorhandenen Signaturen ungültig werden. Fortfahren?',
  'File name': 'Dateiname', 'A document must keep at least one page.': 'Ein Dokument muss mindestens eine Seite behalten.',
  'Delete {n} page(s)?': '{n} Seite(n) löschen?', 'There are no annotations to flatten.': 'Es gibt keine Kommentare zum Reduzieren.',
  'Mark areas with the Redact tool first.': 'Markieren Sie zuerst Bereiche mit dem Schwärzungswerkzeug.',
  'Apply redactions on {n} page(s)? Those pages will be converted to images: their text will no longer be selectable or searchable.':
    'Schwärzungen auf {n} Seite(n) anwenden? Diese Seiten werden in Bilder umgewandelt: Ihr Text ist danach nicht mehr auswählbar oder durchsuchbar.',
  'Redacted {n} page(s).': '{n} Seite(n) geschwärzt.',
  'Remove password protection before signing (signing encrypted files is not supported yet).':
    'Entfernen Sie vor dem Signieren den Kennwortschutz (das Signieren verschlüsselter Dateien wird noch nicht unterstützt).',
  'Signed and saved. Further changes will invalidate the signature unless you sign again.':
    'Signiert und gespeichert. Weitere Änderungen machen die Signatur ungültig, sofern Sie nicht erneut signieren.',
  'Delete the form field “{name}”?': 'Formularfeld „{name}“ löschen?', 'All fields are already locked.': 'Alle Felder sind bereits gesperrt.',
  'No fields are locked.': 'Keine Felder sind gesperrt.', 'Locked {n} field widget(s).': '{n} Feld-Widget(s) gesperrt.', 'Unlocked {n} field widget(s).': '{n} Feld-Widget(s) entsperrt.',
  'All fields are already editable.': 'Alle Felder sind bereits bearbeitbar.', 'Made {n} field(s) editable.': '{n} Feld(er) bearbeitbar gemacht.',
  'Image copied to the clipboard.': 'Bild in die Zwischenablage kopiert.',
  'The browser does not allow copying images here, so the image was downloaded instead.': 'Der Browser erlaubt hier kein Kopieren von Bildern, daher wurde das Bild stattdessen heruntergeladen.',
  'Select some text with the Select Text tool first.': 'Markieren Sie zuerst Text mit dem Werkzeug Textauswahl.', 'Text copied to the clipboard.': 'Text in die Zwischenablage kopiert.',
  'The browser blocked clipboard access; use Ctrl+C instead.': 'Der Browser hat den Zugriff auf die Zwischenablage blockiert; verwenden Sie stattdessen Strg+C.',
  'The clipboard does not contain an image.': 'Die Zwischenablage enthält kein Bild.',
  'The browser blocked clipboard access. Paste images with Ctrl+V into a dialog or insert them from a file instead.':
    'Der Browser hat den Zugriff auf die Zwischenablage blockiert. Fügen Sie Bilder mit Strg+V in einen Dialog ein oder fügen Sie sie stattdessen aus einer Datei ein.',
  'This browser cannot share files directly, so the PDF was downloaded for you to send.': 'Dieser Browser kann Dateien nicht direkt teilen, daher wurde die PDF-Datei zum Versenden heruntergeladen.',
  'Remove the attachment “{name}”?': 'Dateianlage „{name}“ entfernen?', 'This browser cannot read text aloud.': 'Dieser Browser kann keinen Text vorlesen.',
  'This document’s security settings do not allow text extraction for accessibility.': 'Die Sicherheitseinstellungen dieses Dokuments erlauben keine Textextraktion für die Barrierefreiheit.',
  'Document language (e.g. de-DE, en-US):': 'Dokumentsprache (z. B. de-DE, en-US):', 'Document title:': 'Dokumenttitel:',
  'This page uses content the editor cannot reproduce exactly ({pct}% of the page would look different{ops}). Edit it anyway?':
    'Diese Seite enthält Inhalte, die der Editor nicht exakt wiedergeben kann ({pct} % der Seite würden anders aussehen{ops}). Trotzdem bearbeiten?',
  '; unsupported operators: {ops}': '; nicht unterstützte Operatoren: {ops}',
  'Opening…': 'Wird geöffnet…', 'Saving…': 'Wird gespeichert…', 'Preparing to print…': 'Druck wird vorbereitet…', 'Rotating…': 'Wird gedreht…',
  'Deleting…': 'Wird gelöscht…', 'Inserting…': 'Wird eingefügt…', 'Duplicating…': 'Wird dupliziert…', 'Moving pages…': 'Seiten werden verschoben…',
  'Reversing…': 'Reihenfolge wird umgekehrt…', 'Inserting pages…': 'Seiten werden eingefügt…', 'Extracting…': 'Wird extrahiert…', 'Splitting…': 'Wird aufgeteilt…',
  'Cropping…': 'Wird zugeschnitten…', 'Rendering image…': 'Bild wird erzeugt…', 'Adding watermark…': 'Wasserzeichen wird hinzugefügt…',
  'Adding header/footer…': 'Kopf-/Fußzeile wird hinzugefügt…', 'Updating properties…': 'Eigenschaften werden aktualisiert…', 'Flattening form…': 'Formular wird reduziert…',
  'Updating form…': 'Formular wird aktualisiert…', 'Flattening…': 'Wird reduziert…', 'Applying redactions…': 'Schwärzungen werden angewendet…', 'Loading image…': 'Bild wird geladen…',
  'Signing…': 'Wird signiert…', 'Adding field…': 'Feld wird hinzugefügt…', 'Updating field…': 'Feld wird aktualisiert…', 'Deleting field…': 'Feld wird gelöscht…',
  'Moving field…': 'Feld wird verschoben…', 'Adding button…': 'Schaltfläche wird hinzugefügt…', 'Locking fields…': 'Felder werden gesperrt…', 'Unlocking fields…': 'Felder werden entsperrt…',
  'Updating fields…': 'Felder werden aktualisiert…', 'Undoing…': 'Wird rückgängig gemacht…', 'Redoing…': 'Wird wiederhergestellt…', 'Preparing file…': 'Datei wird vorbereitet…',
  'Attaching…': 'Wird angehängt…', 'Removing attachment…': 'Dateianlage wird entfernt…', 'Updating document…': 'Dokument wird aktualisiert…', 'Editing page…': 'Seite wird bearbeitet…',
  'Exporting image…': 'Bild wird exportiert…',
  // error messages from src/lib that reach the status message
  'Set at least one password.': 'Legen Sie mindestens ein Kennwort fest.', 'The original document is not encrypted.': 'Das ursprüngliche Dokument ist nicht verschlüsselt.',
  'The original document has no file identifier.': 'Das ursprüngliche Dokument hat keine Dateikennung.',
  'The certificate file contains no private key.': 'Die Zertifikatsdatei enthält keinen privaten Schlüssel.',
  'The certificate file contains no certificate.': 'Die Zertifikatsdatei enthält kein Zertifikat.',
  'Signing password-protected documents is not supported yet.': 'Das Signieren kennwortgeschützter Dokumente wird noch nicht unterstützt.',
  'Comb fields need a maximum length.': 'Zeichenkamm-Felder benötigen eine maximale Länge.', 'Only radio groups take extra buttons.': 'Nur Optionsfeldgruppen können weitere Schaltflächen aufnehmen.',
  'Wrong certificate password.': 'Falsches Zertifikatskennwort.', 'Only RSA certificates can be used for signing at the moment.': 'Zum Signieren können derzeit nur RSA-Zertifikate verwendet werden.',
  'Field names must be non-empty and contain no dots.': 'Feldnamen dürfen nicht leer sein und keine Punkte enthalten.', 'No such widget.': 'Dieses Widget gibt es nicht.',
  'The radio group has no buttons on a page.': 'Die Optionsfeldgruppe hat keine Schaltflächen auf einer Seite.', 'Nothing selected': 'Nichts ausgewählt',
  // Bookmarks pane
  'Go to bookmark': 'Zum Lesezeichen gehen', 'Add bookmark': 'Lesezeichen hinzufügen', 'Add child bookmark': 'Untergeordnetes Lesezeichen hinzufügen',
  'Set destination to current view': 'Ziel auf aktuelle Ansicht setzen', Rename: 'Umbenennen', Bold: 'Fett', Italic: 'Kursiv',
  Default: 'Standard', 'Move up': 'Nach oben', 'Move down': 'Nach unten', Indent: 'Einrücken', Outdent: 'Ausrücken',
  'Expand all': 'Alle erweitern', 'Collapse all': 'Alle reduzieren', Untitled: 'Ohne Titel', '(untitled)': '(ohne Titel)',
  'Use + to add one for the current view.': 'Mit + fügen Sie eines für die aktuelle Ansicht hinzu.',
  'Delete “{title}” and its {count} sub-bookmark(s)?': '„{title}“ und {count} untergeordnete(s) Lesezeichen löschen?',
  'Updating bookmarks…': 'Lesezeichen werden aktualisiert…',
  // Lifting restrictions without the permissions password
  'Lift restrictions without the password…': 'Einschränkungen ohne Kennwort aufheben…',
  'PDF permissions are not encryption: the restrictions are a request by the author that PDF software honours. PDF-Xploder can lift them for this session without the permissions password.': 'PDF-Berechtigungen sind keine Verschlüsselung: Die Einschränkungen sind eine Vorgabe des Autors, an die sich PDF-Programme halten. PDF-Xploder kann sie für diese Sitzung ohne Berechtigungskennwort aufheben.',
  'The author set these restrictions on purpose. Circumventing protection of copyrighted works can be unlawful (in Germany § 95a UrhG). Only continue for your own documents or with the rights holder’s permission.': 'Der Autor hat diese Einschränkungen bewusst gesetzt. Das Umgehen von Schutzmaßnahmen an urheberrechtlich geschützten Werken kann rechtswidrig sein (§ 95a UrhG). Fahren Sie nur bei eigenen Dokumenten oder mit Zustimmung des Rechteinhabers fort.',
  'I am entitled to edit this document (e.g. it is my own, or the rights holder agreed).': 'Ich bin berechtigt, dieses Dokument zu bearbeiten (z. B. eigenes Dokument oder Zustimmung des Rechteinhabers).',
  'Saving keeps the original encryption and restrictions unless you change the security under Protect → Password.': 'Beim Speichern bleiben die ursprüngliche Verschlüsselung und die Einschränkungen erhalten, sofern Sie die Sicherheit nicht unter Schützen → Kennwort ändern.',
  'Lift restrictions': 'Einschränkungen aufheben', 'Restrictions lifted for this session.': 'Einschränkungen für diese Sitzung aufgehoben.',
};

export default DE;
