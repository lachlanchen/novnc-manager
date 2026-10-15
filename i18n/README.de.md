[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner — apps and four buddies](https://lazying.art/media/brand/lazyingart-intro.gif)](https://lazying.art)

# noVNC Session Manager

*Eine elegante lokale Schaltzentrale für alle noVNC-Desktops einer Linux-Workstation.*

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Linux](https://img.shields.io/badge/Linux-local--first-FCC624?style=flat-square&logo=linux&logoColor=111)](https://www.kernel.org/)
[![noVNC](https://img.shields.io/badge/noVNC-compatible-6FFBD5?style=flat-square)](https://github.com/novnc/noVNC)
[![License](https://img.shields.io/badge/License-MIT-A58CFF?style=flat-square)](../LICENSE)
[![Sponsor](https://img.shields.io/badge/GitHub-Sponsor-FF7FB3?style=flat-square&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/lachlanchen)

noVNC Session Manager erkennt laufende Beziehungen zwischen `websockify`, VNC,
X11/Xvfb, tmux und systemd dynamisch. Viele isolierte virtuelle Desktops werden
zu einem klaren, durchsuchbaren Dashboard mit Zustandsprüfung, Herkunft,
schreibgeschützter Live-Vorschau und interaktivem Öffnen per Klick.

<!-- support:start -->
[![GitHub Sponsors](https://img.shields.io/badge/GitHub-Sponsors-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/lachlanchen)
[![LazyingArt Support](https://img.shields.io/badge/LazyingArt-Support-0EA5E9?style=for-the-badge)](https://chat.lazying.art/donate)
[![PayPal Support](https://img.shields.io/badge/PayPal-Support-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen)
[![Stripe Support](https://img.shields.io/badge/Stripe-Support-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400)
<!-- support:end -->

![Vivid-Grid der erkannten noVNC-Sitzungen](../assets/dashboard-vivid.png)

<details>
<summary><strong>Von Compiz und Vista inspiriertes 3D-Karussell</strong></summary>

![3D-Karussellansicht](../assets/dashboard-carousel.png)

</details>

## Funktionen

- **Dynamische Erkennung** — neue noVNC-Listener erscheinen ohne statische Liste.
- **Drei gezielte Ansichten** — Grid für Dichte, Carousel mit Live-Vorschau und Informationen, Focus für große Vorschau.
- **Drei dauerhafte Themes** — standardmäßig Vivid, dazu das helle Bright und das ruhige Calm.
- **Sichere Vorschau** — jeweils nur eine verzögert geladene VNC-Verbindung im Lesemodus.
- **Herkunftsdetails** — Web/VNC-Ports, X display, Auflösung, PID, Laufzeit,
  tmux pane, systemd unit, Starter und Projektpfad.
- **Zweistufige Prüfung** — noVNC-HTTP-Frontend und VNC-TCP-Backend werden getrennt getestet.
- **Local first** — Bindung nur an `127.0.0.1`, ohne erkannte Desktops zu verändern.
- **Desktop-Integration** — Anwendungsstarter und vor dem Login verfügbarer Benutzerdienst.

## Funktionsweise

```mermaid
flowchart LR
    A[websockify-Listener] --> D[Schreibgeschützte Erkennung]
    B[x11vnc / Xvfb] --> D
    C[tmux / systemd / proc] --> D
    D --> E[JSON-Inventar-API]
    E --> F[Grid]
    E --> G[3D Carousel]
    E --> H[Focus + Lesevorschau]
    H --> I[Interaktiver noVNC-Tab]
```

Das Backend benötigt nur die Python-Standardbibliothek und übliche
Linux-Befehle. Es gruppiert geforkte `websockify`-Worker, verfolgt Proxys bis
zum VNC-Backend und X display und ergänzt tmux-, systemd- und Prozessdaten.
[`config.json`](../config.json) liefert optionale Namen und Beschreibungen;
unbekannte Endpunkte werden weiterhin angezeigt.

## Schnellstart

```bash
git clone https://github.com/lachlanchen/novnc-manager.git
cd novnc-manager
python3 server.py --host 127.0.0.1 --port 7080
```

Öffne <http://127.0.0.1:7080>.

GUI und boot-persistenten Benutzerdienst installieren:

```bash
chmod +x scripts/*.sh
./scripts/install-user-service.sh
```

Danach im Anwendungsmenü nach **noVNC Session Manager** suchen. Der Installer
verwendet auch in RDP/XRDP den kanonischen systemd-Benutzerbus. Falls lingering
deaktiviert ist, zeigt er diesen Befehl für den Start vor dem Login:

```bash
sudo loginctl enable-linger "$USER"
```

Der GUI-Starter bevorzugt Google Chrome im app mode mit Software-Rendering für
stabile Remote-Komposition und fällt andernfalls auf `xdg-open` zurück.

## Oberflächenmodi

| Modus | Geeignet für | Bedienung |
| --- | --- | --- |
| **Grid** | Viele Sitzungen gleichzeitig | Kompakte Karten über die ganze Breite |
| **Carousel** | Navigation wie Vista Flip 3D / Compiz | Mausrad, Klick oder ← / → |
| **Focus** | Einen Desktop untersuchen | Große verzögert geladene Lesevorschau |

**Open ↗** öffnet einen vollständig interaktiven noVNC-Tab. Theme und Ansicht
werden im Browser gespeichert und lassen sich auch per URL wählen:

```text
http://127.0.0.1:7080/?view=carousel&theme=vivid
```

## Konfiguration und API

In [`config.json`](../config.json) können bekannte Ports Namen, Beschreibungen,
Projektpfade und Prioritäten erhalten. Die Erkennung bleibt auch ohne alle
Überschreibungen dynamisch.

| Endpunkt | Zweck |
| --- | --- |
| `GET /healthz` | Leichte Zustandsprüfung des Managers |
| `GET /api/instances` | Aktuelles Inventar und zweistufiger Zustand |

## Projektübersicht

| Pfad | Rolle |
| --- | --- |
| [`server.py`](../server.py) | Erkennungsengine und lokaler HTTP-Server |
| [`static/`](../static/) | Responsives Dashboard, Themes und Ansichten |
| [`config.json`](../config.json) | Optionale lesbare Sitzungsmetadaten |
| [`scripts/install-user-service.sh`](../scripts/install-user-service.sh) | Idempotenter Benutzerinstaller |
| [`scripts/open-manager.sh`](../scripts/open-manager.sh) | Robuster Desktop-GUI-Starter |
| [`packaging/`](../packaging/) | Portable systemd- und desktop-entry-Vorlagen |

## Validierung

```bash
bash -n scripts/*.sh
python3 -m py_compile server.py
python3 -m json.tool config.json >/dev/null
node --check static/app.js
curl --fail http://127.0.0.1:7080/healthz
curl --fail http://127.0.0.1:7080/api/instances | python3 -m json.tool
```

Der Manager bleibt absichtlich beobachtend. Lebenszyklusaktionen werden nicht
aus beliebigen Prozessen erraten, da ein falscher Neustart eines tmux pane oder
detached Proxy Anwendungszustand zerstören könnte.

## Zitation

Wenn noVNC Session Manager in Forschung verwendet wird, bitte dieses Repository
zitieren. GitHub liest [`CITATION.cff`](../CITATION.cff) und zeigt
**Cite this repository** an.

```bibtex
@software{chen_novnc_manager_2026,
  author = {Chen, Lachlan},
  title = {noVNC Session Manager: A local control plane for virtual desktops},
  year = {2026},
  url = {https://github.com/lachlanchen/novnc-manager}
}
```

## Status und Umfang

Getestet mit `websockify`, noVNC, `x11vnc`, Xvfb, tmux,
systemd-Benutzerdiensten, Chrome app mode, XRDP und VNC. Das Projekt ersetzt
weder Authentifizierung noch Zugriffskontrolle. Manager und unauthentifizierte
noVNC-Endpunkte sollten ohne sicheren Tunnel oder authentifizierten Reverse
Proxy ausschließlich auf localhost bleiben.

Veröffentlicht unter der [MIT-Lizenz](../LICENSE) als Teil des
[LazyingArt](https://lazying.art)-Open-Source-Ökosystems.
