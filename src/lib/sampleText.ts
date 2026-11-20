/**
 * The words of the sample document (src/lib/sample.ts), in English and German.
 *
 * The sample is a made-up repair order from a bike workshop. It reads like a real
 * document on purpose: specific names, numbers and dates, short plain sentences, no
 * marketing words. Keep it that way when changing it: no em dashes, no "seamless",
 * "robust" or "unlock", no lists of three for the sake of rhythm, no emoji, headings
 * in sentence case, and nothing that praises the app.
 *
 * The letter on page 2 has one spelling mistake on purpose ("recieve" / "könen"):
 * the start page names it, so people can search for it and fix it.
 */
import type { Lang } from './i18n';

export interface TourRow {
  title: string;
  text: string;
}

export interface SampleText {
  docTitle: string;
  docSubject: string;
  keywords: string[];
  pageOf: (n: number, total: number) => string;
  money: (n: number) => string;
  /** Page 1. */
  kicker: string;
  title: string;
  intro: string;
  tourHeading: string;
  tour: TourRow[];
  alsoHeading: string;
  also: string;
  footer: string;
  /** Letterhead. */
  workshop: string;
  addressLine: string;
  senderLine: string;
  /** Page 2. */
  recipient: string[];
  date: string;
  subject: string;
  letter: string[];
  highlight: string;
  closing: string;
  signer: string[];
  /** Page 3. */
  estimateTitle: string;
  estimateFor: string[];
  columns: [string, string, string, string, string];
  items: { what: string; qty: string; unit: number; amount: number }[];
  total: string;
  vat: (n: number) => string;
  estimateNote: string;
  signHere: string;
  /** Page 4. */
  formTitle: string;
  formIntro: string;
  fields: {
    name: string;
    email: string;
    phone: string;
    bike: string;
    bikes: string[];
    frame: string;
    work: string;
    jobs: string[];
    collect: string;
    collectOptions: [string, string];
    date: string;
    notes: string;
    accept: string;
    /** Field names cannot hold periods, so the check box has a short name of its own. */
    acceptName: string;
  };
  formSign: string;
  formHint: string;
  /** Page 5. */
  planLabels: {
    counter: string;
    stand: (n: number) => string;
    bench: string;
    store: string;
    parking: string;
    door: string;
    window: string;
  };
  titleBlock: string[];
  /** Page 7. */
  recordTitle: string;
  internal: string;
  record: [string, string][];
  historyHeading: string;
  history: [string, string, number][];
  redactNote: string;
  /** Comments already in the file. */
  comments: {
    highlight: string;
    note: string;
    cloud: string;
    cloudReply: string;
  };
  attachmentDescription: string;
  partsCsv: string;
  outline: {
    start: string;
    order: string;
    letter: string;
    estimate: string;
    form: string;
    plan: string;
    receipt: string;
    record: string;
  };
}

const ITEMS_EN = [
  { what: 'Brake service, front and rear (labour)', qty: '0.75 h', unit: 52, amount: 39 },
  { what: 'Replace chain, adjust gears (labour)', qty: '0.5 h', unit: 52, amount: 26 },
  { what: 'Chain KMC X9, 116 links', qty: '1', unit: 24.9, amount: 24.9 },
  { what: 'Brake pads Shimano B05S, pair', qty: '2', unit: 9.8, amount: 19.6 },
  { what: 'Inner tube 28" Presta', qty: '2', unit: 6.5, amount: 13 },
  { what: 'Gear cable set', qty: '1', unit: 7.5, amount: 7.5 },
  { what: 'True the rear wheel (labour)', qty: '0.25 h', unit: 52, amount: 13 },
];

const en: SampleText = {
  docTitle: 'Repair order 2026-117 (PDF-Xploder sample)',
  docSubject: 'A made-up repair order from a bike workshop, for trying out PDF-Xploder',
  keywords: ['PDF-Xploder', 'sample', 'repair order'],
  pageOf: (n, t) => `Page ${n} of ${t}`,
  money: (n) => n.toFixed(2),

  kicker: 'PDF-Xploder sample file',
  title: 'A repair order to take apart',
  intro:
    'This is a made-up repair order from a bike workshop. Each page has something to try. ' +
    'The file was made in this browser tab and is not stored anywhere, so change or delete whatever you like. ' +
    'Ctrl+Z undoes the last step.',
  tourHeading: 'What to try on each page',
  tour: [
    {
      title: 'Letter to the customer',
      text: 'The second paragraph misspells "receive" as "recieve". Search for it with Ctrl+F and fix it with Home › Edit Text. Mara left a comment on the yellow sentence: answer it in the Comments pane.',
    },
    {
      title: 'Estimate',
      text: 'Put an Approved stamp on it and sign on the line with Comment › Signature. Theo and Mara disagree about item 7.',
    },
    {
      title: 'Booking form',
      text: 'Fill in the fields, then use Form › Flatten form to turn them into plain text. Form › Edit form moves fields or adds new ones.',
    },
    {
      title: 'Workshop floor plan',
      text: 'Drawn at 1:50 on a landscape page. Set Comment › Scale to 1:50 and measure the parts store with Area. It comes to about 7.5 m².',
    },
    {
      title: 'Scanned receipt',
      text: 'A picture with no text behind it: try selecting a word. Convert › OCR Pages makes it searchable. Extract images, Greyscale and Compress work on it too.',
    },
    {
      title: 'Customer record',
      text: 'Bank details and a date of birth that must not leave the workshop. Protect › Search & redact finds them and Apply removes them for good. Protect › Password locks the file.',
    },
  ],
  alsoHeading: 'Also in this file',
  also:
    'The Bookmarks pane lists every page. The Attachments pane holds the parts order as a CSV file. ' +
    'Drag thumbnails to put the pages in a different order, and press Ctrl+K to look up any command by name.',
  footer: 'PDF-Xploder is free and open source:',

  workshop: 'Kranich Bike Workshop',
  addressLine: 'Mühlenweg 14 · 04999 Elsterfeld · 0123 456 789 · werkstatt@kranich.example',
  senderLine: 'Kranich Bike Workshop, Mühlenweg 14, 04999 Elsterfeld',

  recipient: ['Ines Albrecht', 'Lindenstraße 22', '04999 Elsterfeld'],
  date: 'Elsterfeld, 13 November 2026',
  subject: 'Your bike repair, order 2026-117',
  letter: [
    'Dear Ms Albrecht,',
    'Thank you for bringing in your Gazelle trekking bike on Tuesday. We looked at it the same afternoon. The rear brake pads are worn down to the metal, and the chain has stretched by 0.75 %, so it has started to wear the cassette. We would replace both now. If we wait, the cassette will need replacing as well, which adds about 45 euros.',
    'The estimate on the next page lists the parts and the time. If you agree, sign it and send it back, or fill in the booking form on page 4. The bike will then be ready within two working days, and you will recieve a text message when you can collect it.',
    'The front tyre still has plenty of tread, so we left it alone.',
  ],
  highlight: 'the chain has stretched by 0.75 %',
  closing: 'Kind regards',
  signer: ['Theo Brandner', 'Workshop manager'],

  estimateTitle: 'Estimate 2026-117',
  estimateFor: ['For Ines Albrecht, Lindenstraße 22, 04999 Elsterfeld', 'Gazelle Medeo T9 trekking bike, frame no. GZ 5521 0784', 'Valid until 4 December 2026. Prices include VAT.'],
  columns: ['No.', 'Description', 'Qty', 'Unit (EUR)', 'Amount (EUR)'],
  items: ITEMS_EN,
  total: 'Total',
  vat: (n) => `includes 19 % VAT of ${n.toFixed(2)} euros`,
  estimateNote: 'Pay when you collect the bike, in cash or by card. Parts we take off are yours to keep if you ask for them.',
  signHere: 'Date and customer signature',

  formTitle: 'Booking form',
  formIntro: 'Fill this in if you want us to start the repair. Send it back by email or bring it to the workshop.',
  fields: {
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    bike: 'Type of bike',
    bikes: ['City bike', 'Trekking bike', 'Road bike', 'Cargo bike', 'E-bike'],
    frame: 'Frame number',
    work: 'Work to do',
    jobs: ['Brake service', 'New chain', 'True the rear wheel', 'Check the lights'],
    collect: 'Pick-up',
    collectOptions: ['I will collect it', 'Deliver it (8 euros in Elsterfeld)'],
    date: 'Earliest date',
    notes: 'Notes',
    accept: 'I accept estimate 2026-117 of 143.00 euros.',
    acceptName: 'Estimate accepted',
  },
  formSign: 'Signature',
  formHint: 'Sign here with Comment › Signature, or digitally with Protect › Sign.',

  planLabels: {
    counter: 'Counter',
    stand: (n) => `Repair stand ${n}`,
    bench: 'Workbench',
    store: 'Parts store',
    parking: 'Bikes waiting',
    door: 'Entrance',
    window: 'Window',
  },
  titleBlock: ['Kranich Bike Workshop', 'Ground floor', 'Scale 1:50 on A4', 'Drawn by T. Brandner', '3 September 2026'],

  recordTitle: 'Customer record',
  internal: 'Internal, do not forward',
  record: [
    ['Customer no.', 'K-0412'],
    ['Name', 'Ines Albrecht'],
    ['Address', 'Lindenstraße 22, 04999 Elsterfeld'],
    ['Phone', '0123 98 76 54'],
    ['Email', 'ines.albrecht@example.org'],
    ['Date of birth', '14/03/1986'],
    ['IBAN', 'DE89 3704 0044 0532 0130 00'],
    ['Payment', 'Direct debit, mandate KR-2025-031'],
    ['Bikes', 'Gazelle Medeo T9, frame GZ 5521 0784; Urban Arrow cargo bike'],
    ['Notes', 'Prefers email. Usually collects on Saturdays. Cargo bike due for a service each April.'],
  ],
  historyHeading: 'Earlier work',
  history: [
    ['12/04/2025', 'Spring service, cargo bike', 89],
    ['02/10/2025', 'Puncture, rear wheel, Gazelle', 18.5],
    ['09/04/2026', 'Spring service, cargo bike', 94],
  ],
  redactNote:
    'Before this page goes to anyone outside the workshop, black out the phone number, date of birth and IBAN. ' +
    'Covering them with a black box is not enough: the text would still be in the file underneath.',

  comments: {
    highlight: 'Measured with the chain checker in two places. The photo is in the order folder.',
    note: 'She prefers email to post. Send this as a PDF.',
    cloud: 'The rim looks true to me. Do we need this?',
    cloudReply: 'Spoke tension is uneven on the drive side. It stays in.',
  },
  attachmentDescription: 'Parts ordered for repair 2026-117',
  partsCsv: 'item,supplier,quantity,unit price EUR\nChain KMC X9 116 links,Brandt Bike Parts,1,24.90\nBrake pads Shimano B05S,Brandt Bike Parts,2,9.80\nInner tube 28" Presta,Brandt Bike Parts,2,6.50\nGear cable set,Brandt Bike Parts,1,7.50\n',
  outline: {
    start: 'Start here',
    order: 'Repair order 2026-117',
    letter: 'Letter to the customer',
    estimate: 'Estimate',
    form: 'Booking form',
    plan: 'Workshop floor plan',
    receipt: 'Scanned receipt',
    record: 'Customer record (internal)',
  },
};

const de: SampleText = {
  docTitle: 'Reparaturauftrag 2026-117 (PDF-Xploder-Beispiel)',
  docSubject: 'Ein ausgedachter Reparaturauftrag einer Fahrradwerkstatt zum Ausprobieren von PDF-Xploder',
  keywords: ['PDF-Xploder', 'Beispiel', 'Reparaturauftrag'],
  pageOf: (n, t) => `Seite ${n} von ${t}`,
  money: (n) => n.toFixed(2).replace('.', ','),

  kicker: 'PDF-Xploder-Beispieldatei',
  title: 'Ein Reparaturauftrag zum Ausprobieren',
  intro:
    'Das hier ist ein ausgedachter Reparaturauftrag einer Fahrradwerkstatt. Auf jeder Seite gibt es etwas auszuprobieren. ' +
    'Die Datei ist in diesem Browser-Tab entstanden und nirgends gespeichert, Sie können also alles ändern oder löschen. ' +
    'Strg+Z macht den letzten Schritt rückgängig.',
  tourHeading: 'Was Sie auf welcher Seite ausprobieren können',
  tour: [
    {
      title: 'Brief an die Kundin',
      text: 'Im zweiten Absatz steht „könen“ statt „können“. Suchen Sie das Wort mit Strg+F und korrigieren Sie es mit Start › Text bearbeiten. Mara hat den gelben Satz kommentiert: Antworten Sie ihr im Bereich Kommentare.',
    },
    {
      title: 'Kostenvoranschlag',
      text: 'Setzen Sie einen Stempel und unterschreiben Sie auf der Linie mit Anmerkungen › Unterschrift. Bei Position 7 sind sich Theo und Mara nicht einig.',
    },
    {
      title: 'Auftragsformular',
      text: 'Füllen Sie die Felder aus und machen Sie sie mit Formular › Formular reduzieren zu normalem Text. Mit Formular › Formular bearbeiten verschieben Sie Felder oder legen neue an.',
    },
    {
      title: 'Grundriss der Werkstatt',
      text: 'Im Maßstab 1:50 auf einer Seite im Querformat. Stellen Sie Anmerkungen › Maßstab auf 1:50 und messen Sie das Teilelager mit Fläche. Es sind etwa 7,5 m².',
    },
    {
      title: 'Eingescannter Kassenbon',
      text: 'Ein Bild ohne Text dahinter: Versuchen Sie, ein Wort zu markieren. Umwandeln › Seiten OCR macht es durchsuchbar. Bilder extrahieren, Graustufen und Komprimieren gehen damit auch.',
    },
    {
      title: 'Kundenkarte',
      text: 'Bankverbindung und Geburtsdatum, die in der Werkstatt bleiben müssen. Schützen › Suchen und schwärzen findet sie, Anwenden entfernt sie endgültig. Schützen › Kennwort sperrt die Datei.',
    },
  ],
  alsoHeading: 'Außerdem in der Datei',
  also:
    'Im Bereich Lesezeichen stehen alle Seiten. Unter Dateianlagen liegt die Teilebestellung als CSV-Datei. ' +
    'Ziehen Sie Seitenminiaturen, um die Reihenfolge zu ändern, und suchen Sie mit Strg+K jeden Befehl über seinen Namen.',
  footer: 'PDF-Xploder ist kostenlos und quelloffen:',

  workshop: 'Fahrradwerkstatt Kranich',
  addressLine: 'Mühlenweg 14 · 04999 Elsterfeld · 0123 456 789 · werkstatt@kranich.example',
  senderLine: 'Fahrradwerkstatt Kranich, Mühlenweg 14, 04999 Elsterfeld',

  recipient: ['Frau', 'Ines Albrecht', 'Lindenstraße 22', '04999 Elsterfeld'],
  date: 'Elsterfeld, 13. November 2026',
  subject: 'Reparatur Ihres Fahrrads, Auftrag 2026-117',
  letter: [
    'Sehr geehrte Frau Albrecht,',
    'danke, dass Sie Ihr Gazelle-Trekkingrad am Dienstag vorbeigebracht haben. Wir haben es uns noch am selben Nachmittag angesehen. Die hinteren Bremsbeläge sind bis aufs Metall abgefahren, und die Kette ist um 0,75 % gelängt. Sie hat schon begonnen, die Kassette abzunutzen. Wir würden beides jetzt tauschen. Wenn wir warten, ist auch die Kassette fällig, das wären noch einmal rund 45 Euro.',
    'Der Kostenvoranschlag auf der nächsten Seite listet Teile und Arbeitszeit auf. Wenn Sie einverstanden sind, unterschreiben Sie ihn und schicken ihn zurück, oder füllen Sie das Auftragsformular auf Seite 4 aus. Das Rad ist dann innerhalb von zwei Werktagen fertig, und Sie bekommen eine SMS, sobald Sie es abholen könen.',
    'Der Vorderreifen hat noch genug Profil, den haben wir so gelassen.',
  ],
  highlight: 'die Kette ist um 0,75 % gelängt',
  closing: 'Mit freundlichen Grüßen',
  signer: ['Theo Brandner', 'Werkstattleitung'],

  estimateTitle: 'Kostenvoranschlag 2026-117',
  estimateFor: ['Für Ines Albrecht, Lindenstraße 22, 04999 Elsterfeld', 'Trekkingrad Gazelle Medeo T9, Rahmennr. GZ 5521 0784', 'Gültig bis 4. Dezember 2026. Alle Preise inklusive MwSt.'],
  columns: ['Pos.', 'Beschreibung', 'Menge', 'Einzeln (EUR)', 'Betrag (EUR)'],
  items: [
    { what: 'Bremsen vorne und hinten warten (Arbeit)', qty: '0,75 Std.', unit: 52, amount: 39 },
    { what: 'Kette tauschen, Schaltung einstellen (Arbeit)', qty: '0,5 Std.', unit: 52, amount: 26 },
    { what: 'Kette KMC X9, 116 Glieder', qty: '1', unit: 24.9, amount: 24.9 },
    { what: 'Bremsbeläge Shimano B05S, Paar', qty: '2', unit: 9.8, amount: 19.6 },
    { what: 'Schlauch 28" Presta', qty: '2', unit: 6.5, amount: 13 },
    { what: 'Schaltzug-Set', qty: '1', unit: 7.5, amount: 7.5 },
    { what: 'Hinterrad zentrieren (Arbeit)', qty: '0,25 Std.', unit: 52, amount: 13 },
  ],
  total: 'Summe',
  vat: (n) => `darin 19 % MwSt.: ${n.toFixed(2).replace('.', ',')} Euro`,
  estimateNote: 'Bezahlt wird bei Abholung, bar oder mit Karte. Ausgebaute Teile geben wir Ihnen auf Wunsch mit.',
  signHere: 'Datum und Unterschrift Kundin',

  formTitle: 'Auftragsformular',
  formIntro: 'Füllen Sie das Formular aus, wenn wir mit der Reparatur anfangen sollen. Schicken Sie es per E-Mail zurück oder bringen Sie es vorbei.',
  fields: {
    name: 'Name',
    email: 'E-Mail',
    phone: 'Telefon',
    bike: 'Art des Fahrrads',
    bikes: ['Stadtrad', 'Trekkingrad', 'Rennrad', 'Lastenrad', 'E-Bike'],
    frame: 'Rahmennummer',
    work: 'Arbeiten',
    jobs: ['Bremsen warten', 'Neue Kette', 'Hinterrad zentrieren', 'Licht prüfen'],
    collect: 'Abholung',
    collectOptions: ['Ich hole es ab', 'Bitte liefern (8 Euro in Elsterfeld)'],
    date: 'Frühester Termin',
    notes: 'Hinweise',
    accept: 'Ich nehme den Kostenvoranschlag 2026-117 über 143,00 Euro an.',
    acceptName: 'Kostenvoranschlag angenommen',
  },
  formSign: 'Unterschrift',
  formHint: 'Unterschreiben Sie hier mit Anmerkungen › Unterschrift oder digital mit Schützen › Signieren.',

  planLabels: {
    counter: 'Theke',
    stand: (n) => `Montageständer ${n}`,
    bench: 'Werkbank',
    store: 'Teilelager',
    parking: 'Wartende Räder',
    door: 'Eingang',
    window: 'Fenster',
  },
  titleBlock: ['Fahrradwerkstatt Kranich', 'Erdgeschoss', 'Maßstab 1:50 auf A4', 'Gezeichnet: T. Brandner', '3. September 2026'],

  recordTitle: 'Kundenkarte',
  internal: 'Intern, nicht weitergeben',
  record: [
    ['Kundennr.', 'K-0412'],
    ['Name', 'Ines Albrecht'],
    ['Anschrift', 'Lindenstraße 22, 04999 Elsterfeld'],
    ['Telefon', '0123 98 76 54'],
    ['E-Mail', 'ines.albrecht@example.org'],
    ['Geburtsdatum', '14.03.1986'],
    ['IBAN', 'DE89 3704 0044 0532 0130 00'],
    ['Zahlung', 'Lastschrift, Mandat KR-2025-031'],
    ['Räder', 'Gazelle Medeo T9, Rahmen GZ 5521 0784; Lastenrad Urban Arrow'],
    ['Hinweise', 'Lieber per E-Mail. Holt meist samstags ab. Lastenrad jedes Jahr im April zur Inspektion.'],
  ],
  historyHeading: 'Frühere Aufträge',
  history: [
    ['12.04.2025', 'Frühjahrsinspektion, Lastenrad', 89],
    ['02.10.2025', 'Platten hinten, Gazelle', 18.5],
    ['09.04.2026', 'Frühjahrsinspektion, Lastenrad', 94],
  ],
  redactNote:
    'Bevor diese Seite die Werkstatt verlässt, Telefonnummer, Geburtsdatum und IBAN schwärzen. ' +
    'Ein schwarzes Rechteck darüber reicht nicht: Der Text steckt sonst weiter in der Datei.',

  comments: {
    highlight: 'Mit der Kettenlehre an zwei Stellen gemessen. Das Foto liegt im Auftragsordner.',
    note: 'Sie möchte lieber E-Mails als Briefe. Bitte als PDF schicken.',
    cloud: 'Die Felge läuft für mich rund. Brauchen wir das?',
    cloudReply: 'Die Speichenspannung ist auf der Antriebsseite ungleich. Bleibt drin.',
  },
  attachmentDescription: 'Bestellte Teile für Auftrag 2026-117',
  partsCsv: 'Teil;Lieferant;Menge;Einzelpreis EUR\nKette KMC X9 116 Glieder;Radteile Brandt;1;24,90\nBremsbeläge Shimano B05S;Radteile Brandt;2;9,80\nSchlauch 28" Presta;Radteile Brandt;2;6,50\nSchaltzug-Set;Radteile Brandt;1;7,50\n',
  outline: {
    start: 'Hier anfangen',
    order: 'Reparaturauftrag 2026-117',
    letter: 'Brief an die Kundin',
    estimate: 'Kostenvoranschlag',
    form: 'Auftragsformular',
    plan: 'Grundriss der Werkstatt',
    receipt: 'Eingescannter Kassenbon',
    record: 'Kundenkarte (intern)',
  },
};

export const SAMPLE_TEXT: Record<Lang, SampleText> = { en, de };
