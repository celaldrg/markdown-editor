/**
 * The sample documents shown on the first visit and after a reset, in
 * English and Turkish. Each uses every feature the parser supports, so it
 * doubles as a quick reference.
 */

/** Title of the English sample document. */
export const SAMPLE_TITLE = 'Welcome';

/** Heading that the ?demo state scrolls to (a table followed by a code block). */
export const DEMO_ANCHOR = '## Tables and code';

/** Markdown source of the English sample document (also used by ?demo). */
export const SAMPLE_MARKDOWN = `Welcome to Markdown Editor
==========================

Write Markdown and the preview updates as you type. Documents are saved
**in this browser** automatically; nothing is uploaded anywhere.

## Text styles

Make text **bold**, _italic_, ***both at once*** or ~~struck through~~, and
mark \`inline code\` with backticks. A backslash shows syntax characters as
they are: \\*not italic\\*, \\\`not code\\\`, \\[not a link\\].

End a line with a backslash\\
to force a line break.

## Links and images

- An [inline link](https://github.com/celaldrg/markdown-editor "Source code on GitHub") with a title
- An autolink: <https://celaldrg.github.io/markdown-editor/>
- A bare address is linked as well: www.example.com
- A [reference link][spec] keeps long addresses out of the text
- An email address: <hello@example.com>

[spec]: https://spec.commonmark.org/ "CommonMark specification"

![Sketch of the editor: Markdown source and its live preview](assets/sample.svg "Split view: editor and preview")

## Lists

1. Ordered lists count for you
2. Items can hold nested lists
   - Bullets use \`-\`, \`*\` or \`+\`
   - Lists nest as deep as you like
     1. Even ordered inside unordered
3. Back to the first level

- A blank line between items

- makes a *loose* list with more space

### Task list

- [x] Write the parser
- [x] Escape every piece of text
- [ ] Share the editor with a friend

## Quotes

> A quote can hold any Markdown: **bold**, \`code\`, even lists:
>
> - an item inside the quote
> - and one more
>
> > Quotes nest, too,
> and a lazy line continues the paragraph.

${DEMO_ANCHOR}

| Feature | Shortcut | Syntax        |
| :------ | :------: | ------------: |
| Bold    | Ctrl+B   | \`**text**\`    |
| Italic  | Ctrl+I   | \`_text_\`      |
| Link    | Ctrl+K   | \`[text](url)\` |
| Pipe    |          | \`a \\| b\`      |

\`\`\`js
// Count the words in a piece of text.
function countWords(text) {
  const words = text.trim().split(/\\s+/);
  return words[0] === '' ? 0 : words.length;
}

countWords('Hello, Markdown!'); // 2
\`\`\`

---

Happy writing! Use the toolbar or the shortcuts, and export your work as
\`.md\` or as a standalone \`.html\` page.
`;

const SAMPLE_MARKDOWN_TR = `Markdown Düzenleyici'ye hoş geldiniz
====================================

Markdown yazın; önizleme siz yazdıkça güncellenir. Belgeleriniz
**bu tarayıcıda** kendiliğinden kaydedilir, hiçbir yere yüklenmez.

## Metin biçimleri

Metni **kalın**, _italik_, ***ikisi birden*** ya da ~~üstü çizili~~ yapın;
\`satır içi kodu\` ters tırnakla işaretleyin. Ters eğik çizgi, söz dizimi
karakterlerini olduğu gibi gösterir: \\*italik değil\\*, \\\`kod değil\\\`, \\[bağlantı değil\\].

Satırı ters eğik çizgiyle bitirirseniz\\
alt satıra geçilir.

## Bağlantılar ve görseller

- Başlıklı bir [satır içi bağlantı](https://github.com/celaldrg/markdown-editor "GitHub'daki kaynak kod")
- Otomatik bağlantı: <https://celaldrg.github.io/markdown-editor/>
- Çıplak bir adres de bağlantıya dönüşür: www.example.com
- [Başvuru bağlantısı][spec] uzun adresleri metnin dışında tutar
- E-posta adresi: <hello@example.com>

[spec]: https://spec.commonmark.org/ "CommonMark belirtimi"

![Düzenleyicinin taslağı: Markdown kaynağı ve canlı önizlemesi](assets/sample.svg "Bölünmüş görünüm: düzenleyici ve önizleme")

## Listeler

1. Numaralı listeler sizin yerinize sayar
2. Maddeler iç içe listeler taşıyabilir
   - Madde işareti olarak \`-\`, \`*\` ya da \`+\` kullanılır
   - Listeler istediğiniz kadar iç içe geçer
     1. Madde listesinin içinde numaralı liste bile olur
3. Yeniden birinci düzeye dönülür

- Maddeler arasındaki boş satır

- listeyi *gevşek*, yani daha ferah yapar

### Görev listesi

- [x] Ayrıştırıcıyı yaz
- [x] Her metni güvenli biçimde göster
- [ ] Düzenleyiciyi bir arkadaşınla paylaş

## Alıntılar

> Alıntıda her türlü Markdown kullanılabilir: **kalın**, \`kod\`, hatta listeler:
>
> - alıntının içinde bir madde
> - ve bir madde daha
>
> > Alıntılar iç içe de geçer,
> tembel bir satır da paragrafı sürdürür.

## Tablolar ve kod

| Özellik     | Kısayol | Söz dizimi     |
| :---------- | :-----: | -------------: |
| Kalın       | Ctrl+B  | \`**metin**\`    |
| İtalik      | Ctrl+I  | \`_metin_\`      |
| Bağlantı    | Ctrl+K  | \`[metin](url)\` |
| Dikey çizgi |         | \`a \\| b\`       |

\`\`\`js
// Bir metindeki kelimeleri sayar.
function countWords(text) {
  const words = text.trim().split(/\\s+/);
  return words[0] === '' ? 0 : words.length;
}

countWords('Merhaba, Markdown!'); // 2
\`\`\`

---

İyi yazmalar! Araç çubuğunu ya da kısayolları kullanın; çalışmanızı \`.md\`
ya da tek başına açılan bir \`.html\` sayfası olarak dışa aktarın.
`;

/** The sample document of each interface language, as {title, content}. */
export const SAMPLES = Object.freeze({
  en: Object.freeze({ title: SAMPLE_TITLE, content: SAMPLE_MARKDOWN }),
  tr: Object.freeze({ title: 'Hoş geldiniz', content: SAMPLE_MARKDOWN_TR }),
});
