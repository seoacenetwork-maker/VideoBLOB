# Polityka prywatności VideoBLOB by d3vski

Ostatnia aktualizacja 24 listopada 2026 r.

[English version](#privacy-policy)

VideoBLOB umożliwia zapis na urządzeniu własnych materiałów wideo i materiałów, które masz prawo pobrać. Rozszerzenie przetwarza dane potrzebne do tej funkcji w przeglądarce.

## Dane używane przez rozszerzenie

- Gdy uruchamiasz skan aktywnej karty, VideoBLOB przetwarza udostępnione przez stronę adresy źródeł, metadane odtwarzacza i wykryte informacje o formacie. Służą one do wyświetlenia listy i zapisania wybranego materiału.
- Gdy wklejasz adres `blob:` w rozszerzeniu, Chrome sprawdza jego dostępność w aktywnej karcie. Rozszerzenie używa adresu lokalnie do sprawdzenia typu i zapisania wybranego pliku.
- Jeśli włączysz obserwację żądań, Chrome prosi o dodatkową zgodę. Rozszerzenie wykorzystuje adresy żądań dotyczących mediów z wybranej karty i dozwolonych hostów. Obserwacja kończy się po 10 minutach, po zamknięciu karty albo po przejściu na inną witrynę. Tymczasowe wyniki obserwacji i dane zlecenia są przechowywane lokalnie w sesji rozszerzenia.
- Przy pobraniu pliku i strumienia przeglądarka komunikuje się z serwerami udostępniającymi wybrane media. Rozszerzenie pobiera segmenty HLS i DASH bez poświadczeń. Przy bezpośrednim pobraniu HTTP(S) mechanizm Chrome może wysłać do serwera pliku ciasteczka ustawione przez tę domenę. [Dokumentacja Chrome](https://developer.chrome.com/docs/extensions/reference/api/downloads#method-download)
- Jeśli uruchomisz nagrywanie, rozszerzenie przetwarza obraz i dźwięk udostępniany przez wybrany odtwarzacz na karcie. Próbka pozostaje w pamięci przeglądarki do czasu zapisu, odrzucenia lub upływu limitu przechowywania. Pliki i wpisy na liście pobrań podlegają ustawieniom i funkcjom zarządzania danymi Chrome.

Rozszerzenie działa bez konta. Wydawca nie otrzymuje filmów, adresów z aktywnej karty, kopii nagrań ani historii przeglądania. Rozszerzenie nie zawiera analityki ani reklam. Korzystanie z informacji otrzymanych za pośrednictwem interfejsów Chrome jest zgodne z zasadami dotyczącymi danych użytkowników Chrome Web Store, w tym z wymaganiami ograniczonego wykorzystania (Limited Use).

## Strona testowa i wsparcie

Strona laboratoryjna VideoBLOB udostępnia próbki do uruchomienia testów. Platforma hostingowa obsługuje ruch potrzebny do wyświetlenia strony, a jej własna polityka określa sposób przetwarzania danych. GitHub stosuje własne zasady do ruchu na stronach repozytorium i dobrowolnych zgłoszeń. [Polityka prywatności GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)

W sprawach związanych z rozszerzeniem i prywatnością skorzystaj z kanału wsparcia projektu. Jeśli zgłaszasz problem techniczny, wystarczy opis testu na próbce projektu i nazwa używanej wersji. [Zgłoszenia i wsparcie VideoBLOB](https://github.com/seoacenetwork-maker/VideoBLOB/issues)

## Privacy policy

Last updated November 24, 2026.

VideoBLOB by d3vski lets you save your own videos and videos you have permission to download on your device. The extension processes the data necessary to provide this feature in your browser.

- When you scan the active tab, VideoBLOB reads available media source URLs, player metadata, and format information to display detected sources and save the selected file.
- When you paste a `blob:` URL into the extension, Chrome checks its availability in the active tab. The extension uses it locally to identify the type and save the selected file.
- Chrome asks for additional permission when you enable network observation. The extension reads media request URLs for the selected tab and authorized hosts. Monitoring ends after 10 minutes, when you close the tab, or when you navigate to a different site. Temporary results and job details remain local to the extension session.
- When you download a file or stream, your browser contacts the selected media hosts. The extension requests HLS and DASH segments without credentials. For direct HTTP(S) downloads, Chrome's download mechanism can send the cookies set for the media hostname to that host. [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads#method-download)
- When you start recording, the extension processes the video and audio exposed by the selected player on the tab. The recording stays in browser memory until it is saved, discarded, or expires. Downloaded files and entries in your download list are managed through your Chrome settings and controls.

The extension works without an account. The publisher does not receive videos, active-tab URLs, recordings, or browsing history. The extension contains no analytics or advertisements. Its use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

The test site serves sample media for testing. The hosting platform handles the traffic needed to serve those files under its own policy. GitHub applies its policy to repository traffic and feedback you choose to submit. For questions about the extension or this policy, use the project support channel. [VideoBLOB issue tracker](https://github.com/seoacenetwork-maker/VideoBLOB/issues) · [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
