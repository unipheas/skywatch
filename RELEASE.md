Skywatch turns BUSY Bar into a standalone nearby-aircraft display.

- Automatic location from your public IP, with a fixed-location option for more accurate overhead detection.
- Callsign, altitude, direction of travel, ground speed, distance, bearing, registration, and aircraft type.
- Amber nearby alerts, wheel browsing, selection hold, and aviation/imperial/metric units.
- Stale-position filtering, network backoff, bounded traffic parsing, and an offline demo.

**Install:** download `app.unipheas.skywatch.tgz` below, leave it compressed, and upload it in your BUSY Bar web interface under **Apps → Add app**. Requires firmware **1.3.1+**, API **27.12.0+**, and Wi-Fi. Start Skywatch; location is automatic by default.

IP location is approximate, not GPS. For planes directly over your house, set a fixed location. Aircraft data is provided by [adsb.fi](https://adsb.fi) for personal, non-commercial use.

**Validation:** type checking, 21 automated core/packaged-runtime tests, a clean dependency audit, and live API checks passed. Physical installation, display rendering, TLS compatibility, and peak memory have not been verified because the development device was unreachable. This is the initial 0.1.0 release.

See the repository README for controls, privacy, limitations, and setup. `SHA256SUMS` verifies the installable archive. GitHub's source-code archives are not BUSY Bar app packages.
