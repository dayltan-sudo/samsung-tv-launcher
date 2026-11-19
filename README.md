# My Home for Samsung Tizen TVs

A TizenBrew module that replaces the chore of hunting through Samsung's Smart Hub with a six tile grid of the apps you actually use. Tiles open the **native** apps, so DRM, playback quality and account state are untouched.

Built for a UA50AU7000KXXS (2021, Tizen 6.0, platform `21_KANTSU2E_UHD_BASIC`).

## Install

In TizenBrew on the TV: **Module Manager** (box icon) -> **Add GitHub Module** -> enter

```
dayltan-sudo/samsung-tv-launcher@v0.1.0
```

Then open **My Home** from TizenBrew's home screen.

## How it works

TizenBrew modules are web pages served from a runtime, so they have no `tizen` global and cannot call the TV's API directly (no CORS). The module ships a small Node service, `service/service.js`, that runs on the TV and proxies to `127.0.0.1:8001`:

| Route | Purpose |
|---|---|
| `GET /resolve` | For each app, the first candidate app ID the TV reports as installed |
| `POST /launch/<appId>` | Open that app |
| `GET /installed` | Raw output of the TV's own app list endpoint, for debugging |
| `GET /debug` | The candidate table |

The grid calls `/resolve` on load and marks any tile it could not match.

## Changing the apps

`service/service.js`, the `APPS` array. Each entry is a list of candidate IDs because Samsung changed IDs around 2020 and they differ by store region. The first ID the TV answers `200` for wins. Colours and tile order live in `app/main.js`.

## Why not a standalone `.wgt` launcher

Samsung only installs packages signed with a certificate issued for that specific TV, which needs Tizen Studio or Apps2Samsung on an x86 machine. A TizenBrew module needs no certificate.

## Why not a web-based launcher

A web wrapper around netflix.com gets you a DRM error. This TV reports `DMP_DRM_WIDEVINE: false` to its own API. Only native app launching works for Netflix, Prime Video and Disney+.

## Licence

MIT
