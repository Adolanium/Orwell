# Emoji data: origin

Downloaded once, on 2026-11-12. `scripts/gerar-emojis.mjs` reads these files and never uses the network.
All files except `nomes-manuais.txt` are Unicode data under the Unicode License v3 (`UNICODE-LICENSE.txt`).

| File | Origin |
| --- | --- |
| `emoji-test-15.0.txt` | https://unicode.org/Public/emoji/15.0/emoji-test.txt |
| `cldr-42.0.0-annotations-{pt,pt-PT,en}.json` | https://github.com/unicode-org/cldr-json/tree/42.0.0/cldr-json/cldr-annotations-full/annotations/ |
| `cldr-42.0.0-annotations-derived-{pt,pt-PT,en}.json` | https://github.com/unicode-org/cldr-json/tree/42.0.0/cldr-json/cldr-annotations-derived-full/annotationsDerived/ |
| `UNICODE-LICENSE.txt` | https://www.unicode.org/license.txt |
| `nomes-manuais.txt` | Ours. Portuguese names and synonyms; they win over CLDR. |

Why Emoji 15.0 and not 15.1: 15.1 adds no new single emoji, only 118 new sequences (head shaking, phoenix, lime,
broken chain, family directions). A device without 15.1 draws a sequence as two or three separate glyphs. 15.0
is drawn whole by Safari 16.4+, Chrome 110+ and Windows 11 22H2+. CLDR 42 is the release that matches Emoji 15.0.

Checks made at download: `emoji-test.txt` downloaded twice with the same checksum; each CLDR file has the same
git blob SHA as the file in the `42.0.0` tag of unicode-org/cldr-json (GitHub API).

SHA-256:

```
e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96  UNICODE-LICENSE.txt
88a72611b4ea41c791d54a39719d4d31faefc2bb528385518cb2e6ad057a1349  cldr-42.0.0-annotations-derived-en.json
0a80e04a036670bd03231872ff627934bde35e1cbf56ff7d0c590d552a4be72d  cldr-42.0.0-annotations-derived-pt-PT.json
b47778344d0d6e078bd182f3cc29907894681d7d4ddb4eacda437d6c8d99ad97  cldr-42.0.0-annotations-derived-pt.json
7d01f4ee177ab92b1cbb006aa0f2cb9449897b95542c52e6e4b9ee54efd01555  cldr-42.0.0-annotations-en.json
b3187de1060362de6518cfa8532e7d6489218869e9f7f8d51ea89716a26d11bd  cldr-42.0.0-annotations-pt-PT.json
4e5fc61e709c68621106d731e6cedd629b48329e0cbd7527549f3b630cf919c7  cldr-42.0.0-annotations-pt.json
8445f23ac8388e096be19d0262e14fceff856ff52093f2356dc89485f1a853db  emoji-test-15.0.txt
```
