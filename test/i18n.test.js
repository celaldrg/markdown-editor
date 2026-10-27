import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, LANG_STORAGE_KEY, LANGS, normalizeLang, STRINGS, t } from '../src/i18n.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('string tables', () => {
  test('English and Turkish have the same keys', () => {
    assert.deepEqual(LANGS, ['en', 'tr']);
    assert.deepEqual(Object.keys(STRINGS).sort(), [...LANGS].sort());
    assert.deepEqual(Object.keys(STRINGS.tr).sort(), Object.keys(STRINGS.en).sort());
  });

  test('every string is non-empty and uses the same placeholders in both languages', () => {
    for (const key of Object.keys(STRINGS.en)) {
      for (const lang of LANGS) {
        assert.equal(typeof STRINGS[lang][key], 'string', `${lang}.${key}`);
        assert.notEqual(STRINGS[lang][key].trim(), '', `${lang}.${key}`);
      }
      assert.deepEqual(placeholders(STRINGS.tr[key]), placeholders(STRINGS.en[key]), key);
    }
  });

  test('every singular form has a plural partner', () => {
    for (const key of Object.keys(STRINGS.en).filter((k) => k.endsWith('_one'))) {
      assert.ok(Object.hasOwn(STRINGS.en, key.slice(0, -4)), key);
    }
  });

  test('the tables cannot be changed', () => {
    assert.ok(Object.isFrozen(STRINGS));
    assert.ok(Object.isFrozen(LANGS));
    assert.equal(LANG_STORAGE_KEY, 'markdown-editor:lang');
  });
});

describe('t', () => {
  test('translates keys', () => {
    assert.equal(t('en', 'appTitle'), 'Markdown Editor');
    assert.equal(t('tr', 'appTitle'), 'Markdown D\u{fc}zenleyici');
  });

  test('fills placeholders and leaves unknown ones', () => {
    assert.equal(t('en', 'confirmDelete', { title: 'Plan' }), 'Delete "Plan"? This cannot be undone.');
    assert.equal(t('tr', 'imported', { title: 'Notlar' }), '"Notlar" i\u{e7}e aktar\u{131}ld\u{131}');
    assert.equal(t('en', 'confirmDelete'), 'Delete "{title}"? This cannot be undone.');
  });

  test('chooses the singular form for a count of one', () => {
    assert.equal(t('en', 'statsWords', { count: 1 }), '1 word');
    assert.equal(t('en', 'statsWords', { count: 0 }), '0 words');
    assert.equal(t('en', 'statsWords', { count: 2 }), '2 words');
    assert.equal(t('en', 'statsReading', { count: 1 }), '1 min read');
  });

  test('formats numbers for the language', () => {
    assert.equal(t('en', 'statsWords', { count: 1234 }), '1,234 words');
    assert.equal(t('tr', 'statsWords', { count: 1234 }), '1.234 kelime');
    assert.equal(t('tr', 'importTooLarge', { limit: 500000 }), 'Dosya \u{e7}ok b\u{fc}y\u{fc}k (s\u{131}n\u{131}r 500.000 karakter).');
  });

  test('falls back to English, then to the key', () => {
    assert.equal(t('de', 'newDoc'), 'New document');
    assert.equal(t(undefined, 'newDoc'), 'New document');
    assert.equal(t('tr', 'no.such.key'), 'no.such.key');
  });
});

describe('normalizeLang', () => {
  const cases = [['tr', 'tr'], ['tr-TR', 'tr'], ['TR', 'tr'], ['en', 'en'], ['en-GB', 'en'], ['de', 'en'], ['', 'en'], [null, 'en'], ['trx', 'en']];
  for (const [value, lang] of cases) {
    test(String(value), () => assert.equal(normalizeLang(value), lang));
  }
});

describe('formatDate', () => {
  const time = Date.UTC(2026, 0, 15, 9, 30);
  // ICU may put a narrow no-break space before AM/PM; compare with plain spaces.
  const plainSpaces = (text) => text.replace(/\s/g, ' ');

  test('formats a date and time for each language', () => {
    assert.equal(plainSpaces(formatDate('en', time, 'UTC')), 'Jan 15, 2026, 9:30 AM');
    assert.equal(plainSpaces(formatDate('tr', time, 'UTC')), '15 Oca 2026 09:30');
  });

  test('uses the time zone it is given', () => {
    assert.equal(plainSpaces(formatDate('tr', time, 'Europe/Istanbul')), '15 Oca 2026 12:30');
  });

  test('falls back to English for other languages', () => {
    assert.equal(formatDate('de', time, 'UTC'), formatDate('en', time, 'UTC'));
  });
});
