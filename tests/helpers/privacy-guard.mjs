// Prosty strażnik prywatności dla testów: strukturalne reguły wykrywania prywatnych ścieżek i adresów wewnętrznych
// (kontekst ścieżki profilu, folderu OneDrive lub hosta Notion — nie pospolite słowa).
// Moduł jest czysty: nie zależy od konta systemowego, katalogu domowego, nazwy komputera ani zmiennych środowiska.

export const SCANNED_PUBLIC_FILES = ['README.md', 'GITHUB_UPLOAD.md', '.gitignore', 'app.mjs', 'index.html', 'server.mjs', 'package.json',
  'styles.css', 'src/basket.mjs', 'src/billing-policy.mjs', 'src/calculator.mjs', 'src/examples.mjs',
  'src/invoice-plan.mjs', 'src/summary.mjs'];

// Separator ścieżki: / lub \ (także wielokrotny, co obejmuje escapowanie JSON/JS: \\ i \\\\ oraz \/).
const SEP = '[\\\\/]+';
// Znaki kończące nazwę segmentu ścieżki.
const SEGMENT = '[^\\\\/\\s"\'`]+';

export const PRIVATE_PATH_RULES = [
  {
    // Profil Windows: litera dysku (osobne słowo, więc nie „https:”) + Users + dowolny login. Profile współdzielone pomijamy.
    id: 'windows-profile',
    pattern: new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:${SEP}Users${SEP}(?!(?:Public|Default|All Users)(?![\\w-]))${SEGMENT}`, 'i'),
  },
  {
    // Profil macOS/Linux, także w adresach file:/// i z escapowanymi ukośnikami; segment musi zaczynać ścieżkę (nie „src/home/…”)
    // i nie może być częścią ścieżki z literą dysku (ta należy do reguły windows-profile).
    id: 'unix-profile',
    pattern: new RegExp(`(?<![\\w.-])(?<!(?<![A-Za-z0-9])[A-Za-z]:[\\\\/]*)${SEP}(?:Users|home)${SEP}${SEGMENT}`),
  },
  {
    // Folder OneDrive: (a) ścieżka z literą dysku, (b) folder firmowy „OneDrive - Organizacja”, (c) ~/OneDrive.
    // Nazwy pakietów i publiczne adresy (onedrive-client, github.com/OneDrive/…) nie spełniają żadnego z warunków.
    id: 'onedrive',
    pattern: new RegExp([
      `(?<![A-Za-z0-9])[A-Za-z]:${SEP}(?:[^\\\\/\\r\\n"'\`<>|:]+${SEP})*OneDrive(?: - [^\\\\/\\r\\n"'\`]+)?(?=[\\\\/]|$)`,
      `(?<![\\w@.-])OneDrive - [^\\\\/\\r\\n"'\`]+[\\\\/]`,
      `~${SEP}OneDrive(?=[\\\\/])`,
    ].join('|'), 'i'),
  },
  {
    // Hosty Notion: *.notion.so, *.notion.site (całe słowo, więc nie „notion.sort(…)”) oraz app.notion.com.
    id: 'notion',
    pattern: /(?<![\w.@-])(?:(?:[a-z0-9-]+\.)*notion\.(?:so|site)|app\.notion\.com)(?![\w-])/i,
  },
];

/** Zwraca identyfikatory reguł, które pasują do tekstu (pusta lista = brak podejrzanych treści). */
export function findPrivateCategories(text) {
  return PRIVATE_PATH_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.id);
}
