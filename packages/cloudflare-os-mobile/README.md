# Cloudflare OS Expo app

This package is the native iPhone entry point for the private Cloudflare OS deployment. It keeps
the selected command-center UI native while opening the existing Workshop inside a persistent
`react-native-webview` for Cloudflare Access, Cap'n Web RPC, OAuth, gadget iframes, and the code
editor.

The package currently targets Expo SDK 54 so it can open in the iOS App Store version of Expo Go.

## Run on an iPhone with Expo Go

From the repository root:

```sh
pnpm --filter @gadgets/cloudflare-os-mobile start
```

Scan the QR code with Expo Go. `react-native-webview` is included in Expo Go, so the Workshop can
be tested before creating a development build.

## Deep links and installed builds

The configured scheme is `cloudflareos`. Installed development and release builds accept routes
such as `cloudflareos://open?path=/outputs`. Expo Go uses temporary `exp://` URLs, so the stable
custom scheme requires a development or release build.

## Known verification boundary

Expo Go launch and navigation have been verified on a physical iPhone. Signing, stable-scheme deep
links, persistent cookie relaunch, and popup OAuth still require an installed development/release
build and device verification; Expo Go cannot prove those native boundaries.
