# VideoBLOB by d3vski — Chrome Web Store

## Store listing

**Nazwa** — VideoBLOB by d3vski

**Kategoria** — Tools (Narzędzia).

**Język interfejsu** — Angielski. Polski opis oferty można dodać jako tłumaczenie.

**Wersja pakietu** — 0.1.1, Chrome 116 lub nowszy.

**Pojedynczy cel** — Umożliwia użytkownikowi zapisanie na urządzeniu własnych lub autoryzowanych materiałów wideo wykrytych w aktywnej karcie Chrome.

**Single purpose** — Lets the user save their own or authorized videos detected on the active Chrome tab to their device.

**Krótki opis** — Zapisuj własne lub autoryzowane filmy z aktywnej karty Chrome bezpośrednio na urządzeniu.

**Short description** — Save your own or authorized videos from the active Chrome tab directly to your device.

**Opis pełny**

VideoBLOB by d3vski pomaga zapisać własne materiały wideo oraz filmy, które masz prawo pobrać. Otwórz stronę z filmem, kliknij ikonę rozszerzenia i wybierz wykryte źródło. Pobieranie i przetwarzanie odbywają się w Twojej przeglądarce.

- Zapisuj bezpośrednie pliki MP4 i WebM, dostępne pliki z adresów Blob oraz zewnętrzne napisy WebVTT.
- Wklej ręcznie adres `blob:` dostępny w aktywnej karcie i zapisz powiązany plik.
- Pobieraj zgodne, niezaszyfrowane strumienie HLS na żądanie i na żywo oraz DASH na żądanie. Wybierz dostępną jakość, podejrzyj HLS i zapisz zgodne ścieżki audio i wideo jako MP4. Przy HLS live możesz zatrzymać pobieranie i zapisać przechwycony fragment.
- Eksportuj ścieżkę M4A ze zgodnego źródła lub nagraj obraz i dźwięk udostępniane przez odtwarzacz HTML5. Nagranie zapisze się jako MP4 lub WebM zależnie od możliwości Chrome.

Wykrywanie zależy od sposobu udostępnienia filmu przez stronę. YouTube i materiały zabezpieczone DRM są wyłączone z obsługi. [Zgłoszenia i wsparcie](https://github.com/seoacenetwork-maker/VideoBLOB/issues)

**Full description**

VideoBLOB by d3vski helps you save your own videos and videos you have permission to download. Open a page with the video, click the extension icon, and choose a detected source. Downloads and processing take place in your browser.

- Save direct MP4 and WebM files, readable file-backed Blob URLs, and external WebVTT subtitles.
- Paste a file-backed `blob:` URL available from your active tab and save the file.
- Download compatible unencrypted on-demand and live HLS streams and on-demand DASH streams. Choose an available quality, preview HLS, and save compatible audio and video tracks as MP4. On live HLS, stop and save the portion you captured.
- Export an M4A track from a compatible source or record video and audio exposed by an HTML5 player. Your browser's capabilities determine whether the recording is saved as MP4 or WebM.

Detection depends on how the website provides the video. YouTube and DRM-protected media are excluded. [Support and issue tracker](https://github.com/seoacenetwork-maker/VideoBLOB/issues)

## Privacy practices

Do pola **Privacy policy URL** wklej publiczny adres polityki w repozytorium. Dostęp w trybie incognito pozwala szybko sprawdzić, czy recenzent i użytkownicy otworzą stronę bez logowania. [Polityka prywatności VideoBLOB](https://github.com/seoacenetwork-maker/VideoBLOB/blob/main/docs/PRIVACY.md)

W polu **Remote code** wybierz odpowiedź „No”, jeśli po sprawdzeniu ZIP cały wykonywalny kod rozszerzenia pochodzi z paczki. Plik filmu i tekst playlisty są danymi potrzebnymi do funkcji zapisu.

### Uzasadnienia uprawnień

| Uprawnienie | Uzasadnienie dla recenzenta |
| --- | --- |
| `activeTab` | Umożliwia odczyt danych o filmie na aktywnej karcie po kliknięciu ikony rozszerzenia. Dostęp jest związany z wybraną kartą. |
| `scripting` | Uruchamia detekcję źródeł i zapis obiektu Blob na wybranej karcie. Po wybraniu nagrywania uruchamia rejestrację obrazu i dźwięku z odtwarzacza. |
| `downloads` | Przekazuje wybrane pliki do mechanizmu pobierania Chrome. |
| `storage` | Przechowuje lokalnie tymczasowy stan obserwacji i dane zlecenia potrzebne do przekazania go do karty zadania. |
| `webRequest` (opcjonalne) | Pozwala odczytać adresy żądań potrzebne do znalezienia źródła na karcie, dla której użytkownik uruchomił obserwację i udzielił dostępu. |
| Opcjonalny dostęp HTTP(S) do hostów | Użytkownik nadaje dostęp do pochodzenia konkretnej strony lub źródła multimediów, gdy jest to potrzebne do zapisania strumienia lub obserwacji żądań. |

Zweryfikuj tabelę z manifestem wydania, w tym opcjonalne uprawnienia. W deklaracji danych uwzględnij lokalny odczyt adresów źródłowych, informacji o stronie i żądań dotyczących mediów oraz ewentualne przetwarzanie obrazu i dźwięku przy nagrywaniu. Deklaracja ma precyzyjnie opisywać miejscowe przetwarzanie. Przed odczytem danych użytkownik ma zobaczyć informację o zakresie i celu odczytu oraz wykonać działanie potwierdzające zgodę. [FAQ Google dotyczące danych użytkownika](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

## Materiały zgłoszenia

- ZIP wydania. `manifest.json` musi znajdować się na głównym poziomie ZIP. Zweryfikuj, że wersja w manifeście i wersja paczki się zgadzają.
- Dołączone materiały to ikona PNG 128 × 128 z przezroczystym obramowaniem oraz zrzut 1280 × 800 przedstawiający podgląd strumienia HLS w rozszerzeniu. [Ikona VideoBLOB](../extension/icons/icon128.png) · [Zrzut rozszerzenia](../store-assets/01-hls-preview.png)
- Publiczny URL polityki prywatności, adres wsparcia oraz uzasadnienia uprawnień zadeklarowanych w manifeście. [Zgłoszenia i wsparcie](https://github.com/seoacenetwork-maker/VideoBLOB/issues)
- Publiczna kopia laboratorium udostępnia kontrolowane próbki bez logowania. [Laboratorium na GitHub Pages](https://seoacenetwork-maker.github.io/VideoBLOB/)

## Instrukcja dla recenzenta

1. Otwórz laboratorium VideoBLOB. Wybierz zakładkę **MP4**, kliknij **Wczytaj próbkę** i uruchom odtwarzanie. [Laboratorium na GitHub Pages](https://seoacenetwork-maker.github.io/VideoBLOB/)
2. Kliknij ikonę VideoBLOB, wykonaj skan i wybierz wykryty plik MP4. Zapisz plik i sprawdź, czy odtwarza się lokalnie.
3. Powtórz procedurę na zakładce **WebM** i **Blob**. W laboratorium **Blob** wczytaj próbkę lub utwórz Blob z bezpośredniego adresu pliku wideo. Skopiuj nowy adres `blob:`, wklej go w formularzu rozszerzenia na tej samej karcie i zapisz plik.
4. W przypadku **HLS** i **DASH** wczytaj próbkę i wykonaj skan na tej samej karcie. Wybierz autoryzowane źródło z listy. Jeśli Chrome pyta o dostęp do hosta mediów, zgoda umożliwi pobranie segmentów. Oczekiwany wynik to MP4 z obrazem i dźwiękiem dla HLS fMP4, HLS MPEG-TS i próbki DASH z oddzielnymi ścieżkami. Jeśli wybierzesz dźwięk DASH, oczekiwany wynik to plik M4A. W symulacji HLS live użyj **Save captured** po pobraniu segmentów.

Jeśli recenzent uruchamia źródła lokalnie, z katalogu projektu może podać laboratorium przez HTTP.

```sh
python -m http.server 8080 --bind 127.0.0.1 --directory test-site/dist
```

Publiczny adres laboratorium, gdy jest dostępny, upraszcza test weryfikacji. Lokalny adres to `http://127.0.0.1:8080/`.

## Przesłanie do weryfikacji

Użyj zarejestrowanego konta wydawcy z potwierdzonym adresem kontaktowym i włączoną weryfikacją dwuetapową. Konto wydawcy w Chrome Web Store wymaga zadeklarowania statusu Trader albo Non-Trader. Google może wymagać weryfikacji danych wydawcy zależnie od wybranego statusu.

Otwórz Chrome Web Store Developer Dashboard, dodaj ZIP jako nowy element, uzupełnij Store listing, Privacy practices i Distribution, a następnie wyślij zgłoszenie do weryfikacji. Google rozpatruje zgłoszenie zgodnie z zasadami sklepu.

[Rejestracja konta wydawcy](https://developer.chrome.com/docs/webstore/register) · [Weryfikacja dwuetapowa](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification) · [Status Trader](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq) · [Publikowanie](https://developer.chrome.com/docs/webstore/publish) · [Materiały oferty](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) · [Pola prywatności](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [Zasady programu](https://developer.chrome.com/docs/webstore/program-policies/policies)
