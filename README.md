# VideoBLOB by d3vski

Rozszerzenie Chrome Manifest V3 do wykrywania i zapisywania materiałów, do których masz prawa. Przetwarzanie plików i nagrań odbywa się w przeglądarce.

## Instalacja testowa

1. Pobierz i rozpakuj [pakiet ZIP](https://github.com/seoacenetwork-maker/VideoBLOB/releases).
2. W Chrome przejdź do `chrome://extensions` i włącz **Tryb dewelopera**.
3. Wybierz **Załaduj rozpakowane** i wskaż katalog z plikiem `manifest.json`. Przy pracy z repozytorium jest to `extension/`.
4. Otwórz [laboratorium GitHub Pages](https://seoacenetwork-maker.github.io/VideoBLOB/) lub [laboratorium Sites](https://videoblob-d3vski-lab.longjellyfish.chatgpt.site). Wybierz próbkę i kliknij **Wczytaj próbkę**.
5. Otwórz VideoBLOB, wybierz **Scan this tab**, a potem **Save**, **Open stream** lub **Save audio**. Przy strumieniu wybierz **Open playlist** i potwierdź dostęp do wskazanego hosta. Po wybraniu jakości zaznacz zgodę i zapisz plik.

Prywatne laboratorium Sites służy do podglądu próbek z konta właściciela. Do pełnego eksportu strumieni bez sesyjnych ciasteczek użyj GitHub Pages albo uruchom tę samą aplikację lokalnie.

## Funkcje

| Format lub operacja | Zachowanie |
| --- | --- |
| MP4, WebM i inne rozpoznane pliki wideo lub audio | Wykrywanie w bieżącej karcie, podgląd wybranych formatów w Chrome, nazwa pliku i pobranie w Chrome. |
| VTT i SRT | Zapis wykrytych napisów jako osobnego pliku. |
| `blob:` | Zapis dostępnego obiektu z karty źródłowej. W wybranych odtwarzaczach alternatywą jest nagrywanie obrazu i dźwięku podczas odtwarzania. |
| HLS VOD i live bez szyfrowania | Wybór jakości z playlisty głównej, postęp, zatrzymanie przechwytywania live. HLS fMP4 zapisuje się jako MP4. MPEG-TS jest przepakowywany do MP4 dla zgodnych ścieżek i może zostać zapisany jako TS. |
| DASH VOD bez szyfrowania | Jednookresowe manifesty fMP4 z obsługiwanymi wariantami SegmentTemplate lub SegmentList. Aplikacja łączy zgodne ścieżki obrazu i dźwięku w MP4 albo zapisuje je osobno. |
| Audio z MP4 lub WebM | Zapis M4A. Gdy potrzebne jest kodowanie AAC, dostępność zależy od kodeków Chrome. |
| Network watch | Opcjonalna, czasowa obserwacja wskazanej karty i hostów, pomocna przy dynamicznych adresach multimediów. |

Obsługiwane są źródła udostępnione do pobrania przez właściciela treści. DRM, zaszyfrowane playlisty, YouTube, przekierowania w zadaniach strumieniowych oraz odczyt za paywallem są poza zakresem. Niektóre odtwarzacze nie udostępniają strumienia możliwego do nagrania. Duże zadania mogą osiągnąć limit pamięci widoczny w interfejsie.

## Uruchomienie lokalne

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory test-site/dist
```

Otwórz `http://127.0.0.1:8000/`. Próbki zawierają syntetyczny obraz i ton. W repozytorium jest [generator próbek](test-site/generate-fixtures.py).

## Testy w prawdziwym Chrome

Testy wymagają Node.js i Chrome for Testing z obsługą protokołu Extensions. Zainstaluj `playwright-core` i ustaw `VIDEOBLOB_CHROME` na pełną ścieżkę do programu Chrome for Testing. Opcjonalna zmienna `VIDEOBLOB_PLAYWRIGHT` może wskazywać istniejący moduł `playwright-core/index.mjs`.

```powershell
node tests/popup.mjs
node tests/popup.mjs --watch-pregranted
node tests/chrome.mjs
```

Skrypt sprawdza właściwy manifest i w osobnym profilu wykonuje testy zapisywania z lokalnym serwerem próbek. Wyłącznie manifest kopii testowej otrzymuje dostęp do `127.0.0.1`, aby uruchomić testy bez natywnego okna zgody. Testy analizują wynikowe pliki i ścieżki.
Ustaw `VIDEOBLOB_FIXTURE_SITE` na adres publicznego laboratorium, aby wykonać te same testy na wdrożeniu. Kopia testowa otrzyma wówczas dostęp do hosta laboratorium.

## Zbudowanie ZIP

```powershell
python scripts/package.py
```

Polecenie tworzy pakiet Chrome Web Store w katalogu `dist/`.

## Materiały do publikacji

- [Opis, uprawnienia i instrukcja testów dla Chrome Web Store](docs/CHROME-WEB-STORE.md)
- [Polityka prywatności](docs/PRIVACY.md)
- [Zrzuty ekranu do Chrome Web Store](store-assets/)
- [Informacja o wbudowanej bibliotece Mediabunny](extension/vendor/README.md)
