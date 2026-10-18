/** All German strings (loaded on demand, see loadLanguage in lib/i18n). */
import DE_ORGANIZE from './organize';
import DE_CONTEXT from './context';
import DE_UI from './ui';
import DE_OCR from './ocr';
import DE_BOOKMARKS from './bookmarks';

const DE_MAIN: Record<string, string> = {
  // tabs
  File: 'Datei', Home: 'Start', View: 'Ansicht', Comment: 'Anmerkungen', Protect: 'Schützen', Form: 'Formular',
  Organize: 'Dokumentaufbau', Convert: 'Umwandeln', Share: 'Teilen', Review: 'Überprüfen', Accessibility: 'Barrierefreiheit',
  // Home
  Tools: 'Werkzeuge', Hand: 'Hand', 'Select Text': 'Textauswahl', 'Edit Comments': 'Anmerkungen bearbeiten',
  Snapshot: 'Bildschirmfoto', Clipboard: 'Zwischenablage', Find: 'Suche', Objects: 'Objekte',
  'Edit Text': 'Text bearbeiten', 'Edit Objects': 'Objekte bearbeiten', Add: 'Hinzufügen', Select: 'Auswahl',
  'Zoom out': 'Verkleinern', 'Zoom in': 'Vergrößern', 'Zoom level': 'Zoomfaktor', 'Actual size': 'Tatsächliche Größe',
  'Fit page': 'Ganze Seite', 'Fit width': 'Seitenbreite', 'Rotate view left': 'Ansicht nach links drehen',
  'Rotate view right': 'Ansicht nach rechts drehen', Bookmarks: 'Lesezeichen', Thumbnails: 'Seitenminiaturen',
  Comments: 'Kommentare', Attachments: 'Dateianlagen', 'Form fields': 'Formularfelder',
  'Snapshot tool': 'Bildschirmfoto-Werkzeug', 'Copy page as image': 'Seite als Bild kopieren',
  'Save page as image': 'Seite als Bild speichern', 'Copy selected text': 'Markierten Text kopieren',
  'Paste image as comment': 'Bild als Kommentar einfügen', 'Find…': 'Suchen…', 'Next result': 'Nächstes Ergebnis',
  'Previous result': 'Vorheriges Ergebnis', 'All objects': 'Alle Objekte', 'Text objects': 'Textobjekte',
  'Image objects': 'Bildobjekte', 'Shape objects': 'Formobjekte', Text: 'Text', Image: 'Bild', Rectangle: 'Rechteck',
  Ellipse: 'Ellipse', Line: 'Linie', 'Select all': 'Alles auswählen', 'Invert selection': 'Auswahl umkehren',
  'Select none': 'Auswahl aufheben',
  // File
  Document: 'Dokument', New: 'Neu', Open: 'Öffnen', Save: 'Speichern', 'Save as': 'Speichern unter',
  'Save flattened': 'Reduziert speichern', Close: 'Schließen', Output: 'Ausgabe', Print: 'Drucken',
  'Page to PNG': 'Seite als PNG', Info: 'Info', Properties: 'Eigenschaften',
  // Comment
  'Text markup': 'Textmarkierung', Highlight: 'Hervorheben', Underline: 'Unterstreichen', Strikeout: 'Durchstreichen',
  Drawing: 'Zeichnen', Pencil: 'Stift', Arrow: 'Pfeil', Polygon: 'Vieleck', Polyline: 'Linienzug', Cloud: 'Wolke', 'Text box': 'Textfeld', Note: 'Notiz', Stamp: 'Stempel',
  Manage: 'Verwalten', Flatten: 'Reduzieren',
  // Organize
  Pages: 'Seiten', 'Rotate left': 'Links drehen', 'Rotate right': 'Rechts drehen', Rotate: 'Drehen', Insert: 'Einfügen',
  'Blank page': 'Leere Seite', 'From file': 'Aus Datei', Duplicate: 'Duplizieren', Delete: 'Löschen',
  Extract: 'Extrahieren', Split: 'Teilen', Reverse: 'Umkehren', Crop: 'Zuschneiden', 'Page marks': 'Seitenmarkierungen',
  Watermark: 'Wasserzeichen', 'Header/Footer': 'Kopf-/Fußzeile',
  // Edit content
  'Add to page': 'Zur Seite hinzufügen', Signature: 'Unterschrift',
  // Form
  Fill: 'Ausfüllen', Design: 'Gestalten', 'Edit form': 'Formular bearbeiten', 'Text field': 'Textfeld',
  'Check box': 'Kontrollkästchen', Radio: 'Optionsfeld', Dropdown: 'Kombinationsfeld', 'List box': 'Listenfeld',
  Lock: 'Sperren', 'Make editable': 'Bearbeitbar machen', 'Unlock all': 'Alle entsperren', 'Lock all': 'Alle sperren',
  Finish: 'Abschließen', 'Flatten form': 'Formular reduzieren',
  // Protect
  Redaction: 'Schwärzung', 'Mark area': 'Bereich markieren', Apply: 'Anwenden', Security: 'Sicherheit',
  Password: 'Kennwort', Permissions: 'Berechtigungen', Unlock: 'Entsperren', 'Digital signatures': 'Digitale Signaturen',
  Sign: 'Signieren', 'Sign invisibly': 'Unsichtbar signieren', Signatures: 'Signaturen',
  // View
  Panes: 'Fenster', Search: 'Suche', Sidebar: 'Seitenleiste', Zoom: 'Zoom', Help: 'Hilfe', Shortcuts: 'Tastenkürzel',
  Language: 'Sprache', More: 'Weitere Optionen',
  // Convert
  'OCR Pages': 'Seiten OCR', 'Recognise text in scanned pages (runs locally in the browser)': 'Text in gescannten Seiten erkennen (läuft lokal im Browser)',
  'To image': 'In Bild', 'Region to image': 'Bereich als Bild', 'Flatten comments': 'Kommentare reduzieren',
  'Flattened copy': 'Reduzierte Kopie',
  // Share
  Send: 'Senden', 'Share file': 'Datei teilen', Download: 'Herunterladen', 'Attach file': 'Datei anhängen',
  // Review
  'Comments list': 'Kommentarliste', Validate: 'Prüfen', 'Document properties': 'Dokumenteigenschaften',
  // Accessibility
  Check: 'Prüfen', 'Accessibility check': 'Barrierefreiheit prüfen', Reading: 'Lesen', 'Read aloud': 'Vorlesen',
  'Stop reading': 'Vorlesen beenden', Display: 'Anzeige', 'Invert colours': 'Farben umkehren',
};

const DE: Record<string, string> = { ...DE_UI, ...DE_ORGANIZE, ...DE_CONTEXT, ...DE_OCR, ...DE_BOOKMARKS, ...DE_MAIN };
export default DE;
