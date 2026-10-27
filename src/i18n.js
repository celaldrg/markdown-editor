/**
 * User interface strings in English (default) and Turkish.
 */

/** Supported interface languages. */
export const LANGS = Object.freeze(['en', 'tr']);

/** Storage key of the chosen interface language. */
export const LANG_STORAGE_KEY = 'markdown-editor:lang';

const LOCALES = { en: 'en-US', tr: 'tr-TR' };

/** Strings per language. Keys ending in "_one" are the singular forms used when count is 1. */
export const STRINGS = Object.freeze({
  en: {
    appTitle: 'Markdown Editor',
    langToggle: 'TR',
    langToggleLabel: 'Switch to Turkish',
    reset: 'Reset',
    resetConfirm: 'Delete all documents and start again with the sample document?',
    menu: 'Menu',
    close: 'Close',
    documents: 'Documents',
    newDoc: 'New document',
    untitled: 'Untitled',
    rename: 'Rename',
    renamePrompt: 'New name for the document',
    delete: 'Delete',
    confirmDelete: 'Delete "{title}"? This cannot be undone.',
    import: 'Import .md',
    exportMd: 'Export .md',
    exportHtml: 'Export .html',
    copyHtml: 'Copy HTML',
    copied: 'HTML copied to the clipboard',
    copyFailed: 'Could not copy',
    imported: 'Imported "{title}"',
    importTooLarge: 'The file is too large (limit {limit} characters).',
    importFailed: 'Could not read the file.',
    tabEdit: 'Edit',
    tabPreview: 'Preview',
    toc: 'Contents',
    tocEmpty: 'Add headings to see a table of contents.',
    statusSaved: 'Saved',
    statusSaving: 'Saving…',
    statusError: 'Not saved: storage is unavailable',
    statsWords: '{count} words',
    statsWords_one: '{count} word',
    statsChars: '{count} characters',
    statsChars_one: '{count} character',
    statsReading: '{count} min read',
    toolbarLabel: 'Formatting',
    bold: 'Bold (Ctrl+B)',
    italic: 'Italic (Ctrl+I)',
    heading: 'Heading',
    list: 'Bulleted list',
    task: 'Task list',
    link: 'Link (Ctrl+K)',
    code: 'Code',
    quote: 'Quote',
    table: 'Table',
    tableHeader: 'Header',
    tableCell: 'Cell',
    editorLabel: 'Markdown source',
    previewLabel: 'Preview',
    footerLicense: 'MIT',
    footerSource: 'Source on GitHub',
    cancel: 'Cancel',
    renameDoc: 'Rename "{title}"',
    deleteDoc: 'Delete "{title}"',
    deleted: 'Deleted "{title}"',
    downloaded: 'Downloaded {file}',
    editorPlaceholder: 'Start writing Markdown…',
    editorHint: 'Tab inserts two spaces. Press Esc, then Tab, to leave the editor.',
    previewEmpty: 'Nothing to preview yet. Start writing on the Edit side.',
    splitter: 'Resize the editor and the preview',
    dropHint: 'Drop a Markdown file to import it',
    fileActions: 'Import and export',
  },
  tr: {
    appTitle: 'Markdown Düzenleyici',
    langToggle: 'EN',
    langToggleLabel: 'İngilizceye geç',
    reset: 'Sıfırla',
    resetConfirm: 'Tüm belgeler silinip örnek belgeyle yeniden başlansın mı?',
    menu: 'Menü',
    close: 'Kapat',
    documents: 'Belgeler',
    newDoc: 'Yeni belge',
    untitled: 'Adsız',
    rename: 'Yeniden adlandır',
    renamePrompt: 'Belgenin yeni adı',
    delete: 'Sil',
    confirmDelete: '"{title}" silinsin mi? Bu işlem geri alınamaz.',
    import: '.md içe aktar',
    exportMd: '.md indir',
    exportHtml: '.html indir',
    copyHtml: 'HTML kopyala',
    copied: 'HTML panoya kopyalandı',
    copyFailed: 'Kopyalanamadı',
    imported: '"{title}" içe aktarıldı',
    importTooLarge: 'Dosya çok büyük (sınır {limit} karakter).',
    importFailed: 'Dosya okunamadı.',
    tabEdit: 'Düzenle',
    tabPreview: 'Önizleme',
    toc: 'İçindekiler',
    tocEmpty: 'İçindekiler için başlık ekleyin.',
    statusSaved: 'Kaydedildi',
    statusSaving: 'Kaydediliyor…',
    statusError: 'Kaydedilmedi: depolama kullanılamıyor',
    statsWords: '{count} kelime',
    statsWords_one: '{count} kelime',
    statsChars: '{count} karakter',
    statsChars_one: '{count} karakter',
    statsReading: '{count} dk okuma',
    toolbarLabel: 'Biçimlendirme',
    bold: 'Kalın (Ctrl+B)',
    italic: 'İtalik (Ctrl+I)',
    heading: 'Başlık',
    list: 'Madde listesi',
    task: 'Görev listesi',
    link: 'Bağlantı (Ctrl+K)',
    code: 'Kod',
    quote: 'Alıntı',
    table: 'Tablo',
    tableHeader: 'Başlık',
    tableCell: 'Hücre',
    editorLabel: 'Markdown kaynağı',
    previewLabel: 'Önizleme',
    footerLicense: 'MIT',
    footerSource: "Kaynak kod GitHub'da",
    cancel: 'Vazgeç',
    renameDoc: '"{title}" belgesini yeniden adlandır',
    deleteDoc: '"{title}" belgesini sil',
    deleted: '"{title}" silindi',
    downloaded: '{file} indirildi',
    editorPlaceholder: 'Markdown yazmaya başlayın…',
    editorHint: 'Tab iki boşluk ekler. Düzenleyiciden çıkmak için önce Esc, sonra Tab tuşuna basın.',
    previewEmpty: 'Henüz önizlenecek bir şey yok. Düzenleme tarafında yazmaya başlayın.',
    splitter: 'Düzenleyici ve önizleme genişliğini ayarla',
    dropHint: 'İçe aktarmak için bir Markdown dosyası bırakın',
    fileActions: 'İçe ve dışa aktar',
  },
});

/**
 * Normalizes a language value (e.g. "tr-TR", "EN") to a supported language.
 * @param {unknown} value
 * @returns {'en'|'tr'}
 */
export function normalizeLang(value) {
  return /^tr\b/i.test(String(value ?? '')) ? 'tr' : 'en';
}

/**
 * Translates a key. `{name}` placeholders are filled from vars (numbers are
 * formatted for the language); when vars.count is 1 the "_one" form is used.
 * Falls back to English, then to the key itself.
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(lang, key, vars = {}) {
  const code = normalizeLang(lang);
  const table = STRINGS[code];
  const singular = vars.count === 1 ? `${key}_one` : null;
  const template = (singular && (table[singular] ?? STRINGS.en[singular])) ?? table[key] ?? STRINGS.en[key] ?? key;
  const numbers = new Intl.NumberFormat(LOCALES[code]);
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (!Object.hasOwn(vars, name)) return match;
    const value = vars[name];
    return typeof value === 'number' ? numbers.format(value) : String(value);
  });
}

/**
 * Formats a time stamp as a medium date with a short time for the language,
 * e.g. "Jan 15, 2026, 9:30 AM" or "15 Oca 2026 09:30".
 * @param {string} lang
 * @param {number} ms - time since the epoch
 * @param {string} [timeZone] - IANA time zone; the visitor's zone when omitted
 * @returns {string}
 */
export function formatDate(lang, ms, timeZone) {
  const options = { dateStyle: 'medium', timeStyle: 'short' };
  if (timeZone) options.timeZone = timeZone;
  return new Intl.DateTimeFormat(LOCALES[normalizeLang(lang)], options).format(new Date(ms));
}
