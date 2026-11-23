# VideoBLOB by d3vski — laboratorium wideo

Strona testowa do wykrywania i pobierania syntetycznego wideo przez rozszerzenie VideoBLOB. Działa jako statyczny serwis w katalogu `dist`.

## Uruchomienie lokalne

W tym katalogu uruchom:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Otwórz `http://127.0.0.1:8765` w Chrome. Przy każdym teście wybierz próbkę, wczytaj ją i uruchom skan rozszerzenia. Ten wariant działa z anonimowymi żądaniami sieciowymi. Na prywatnym wdrożeniu Sites odtwarzacz działa w sesji zalogowanego właściciela.

| Test | Zasób | Oczekiwany wynik |
| --- | --- | --- |
| MP4 | `/media/sample.mp4` | Bezpośredni klip H.264/AAC i osobna ścieżka napisów VTT. |
| WebM | `/media/sample.webm` | Bezpośredni klip VP9/Opus. |
| Blob | Próbka tworzy adres `blob:` w otwartej karcie | Pobranie lokalnego Blob. Po unieważnieniu i nowym skanie adres nie jest dostępny. Można wybrać własny plik. |
| HLS fMP4 | `/media/hls/master.m3u8` | Manifest z wariantami 360p i 180p z segmentami fMP4. |
| HLS MPEG-TS | `/media/hls/ts/index.m3u8` | Zapis czterech segmentów MPEG-TS. Gdy odtwarzacz nie obsługuje TS, strona pobiera segmenty, żeby scenariusz pozostał dostępny do skanowania. |
| HLS live (symulacja) | `/media/hls/live/index.m3u8` | Uruchomienie zapisu i zatrzymanie przez użytkownika. Playlista nie ma `EXT-X-ENDLIST` i wskazuje na stały zestaw segmentów. |
| DASH | `/media/dash/av/manifest.mpd` i `/media/dash/video/manifest.mpd` | Statyczne segmenty z osią czasu. Pierwsza próbka ma ścieżki wideo i audio, druga wyłącznie wideo. |

## Odtworzenie próbek

Zainstaluj FFmpeg 7.1 z kodekami libx264, libvpx i libopus. Uruchom `python generate-fixtures.py` albo podaj ścieżkę do FFmpeg jako argument. Filtry `testsrc2` i `sine` tworzą syntetyczny obraz i dźwięk. Możesz używać wygenerowanych próbek do testowania rozszerzenia.
