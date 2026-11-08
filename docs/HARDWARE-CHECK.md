# First run on a BUSY Bar

These checks remain unverified on physical hardware for 0.1.0.

1. Install the release `.tgz` on firmware 1.3.1+ / API 27.12.0+.
2. Enable Demo mode in Setup and launch. Confirm the `D SKY123` callsign and rotating pages fit the 72×16 screen. Turn the wheel, press OK, and toggle Start/Pause. Hold OK for information. Back must exit.
3. Disable Demo, connect Wi-Fi, and relaunch. Confirm an automatic city appears when holding OK. Auto distances must have `~`; near-radius status must say `~NEAR IP LOC`.
4. Set a fixed location in the web UI and relaunch. Confirm the correct nearby aircraft against a live map; the `~` marker should be absent. Compare callsign, altitude, and direction.
5. Observe one overhead LED pulse and no repeated pulse for the same aircraft within ten minutes. Disable alerts and repeat with a new aircraft.
6. Disconnect Wi-Fi. Verify `CONNECT WIFI`, no misleading persistent aircraft, and recovery after reconnecting and the retry delay.
7. Test in a busy area for at least 30 minutes. Confirm no memory-related exits, inspect the effective radius, and check that the bar's controls remain responsive.
8. Press Back during a remote request. There must be no further display updates; the app exits once firmware finishes or times out that request. Holding Back is the firmware's force-quit shortcut.

Please include firmware/API versions, symptoms, and approximate traffic density in an issue. Do not post private coordinates or raw settings.
